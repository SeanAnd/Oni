package expo.modules.jobs

import android.content.ContentValues
import android.content.Context
import android.database.sqlite.SQLiteDatabase
import org.json.JSONArray
import org.json.JSONObject
import java.time.Instant
import java.util.UUID

data class JobRow(
  val id: String,
  val projectId: String,
  val type: String,
  val capabilityId: String,
  val providerId: String,
  val status: String,
  val parametersJson: String,
  val commandJson: String?,
  val timeoutMs: Long?,
  val operationId: String?,
  val exitCode: Int?,
  val errorKey: String?,
  val errorDetail: String?,
  val artifactIdsJson: String,
  val progress: Double?,
  val observationsPending: Boolean,
  val startedAt: String?,
  val finishedAt: String?,
  val createdAt: String,
  val updatedAt: String,
  val cancelRequested: Boolean,
  val resultIngested: Boolean,
)

class JobLedgerStore(context: Context) {
  var onUpdate: ((String) -> Unit)? = null
  private val openHelper = JobLedgerDatabase(context.applicationContext)

  private fun writable(): SQLiteDatabase = openHelper.writableDatabase

  private fun readable(): SQLiteDatabase = openHelper.readableDatabase

  fun nowIso(): String = Instant.now().toString()

  /** Adopt an already-running fixed CLI job atomically; never dispatch it again. */
  @Synchronized fun adoptMsfdbJob(id: String, operationId: String): JobRow = transaction {
    require(Regex("msfdb-[a-f0-9]{32}").matches(id))
    require(Regex("[A-Za-z0-9._-]{1,96}").matches(operationId))
    getJob(id)?.let {
      require(it.operationId == operationId && it.type == "metasploit.msfdb")
      return@transaction it
    }
    insertQueuedJob(id, "system-onboarding", "metasploit.msfdb", "metasploit.database",
      "provider.termux.postgresql", "{}", null, 180_000L)
    setOperationId(id, operationId)
    transitionStatus(id, "starting")
    transitionStatus(id, "running")
  }

  @Synchronized fun insertQueuedJob(
    id: String,
    projectId: String,
    type: String,
    capabilityId: String,
    providerId: String,
    parametersJson: String,
    commandJson: String?,
    timeoutMs: Long?,
  ): JobRow = transaction {
    val ts = nowIso()
    val values =
      ContentValues().apply {
        put("id", id)
        put("project_id", projectId)
        put("type", type)
        put("capability_id", capabilityId)
        put("provider_id", providerId)
        put("status", "queued")
        put("parameters_json", parametersJson)
        put("command_json", commandJson)
        put("timeout_ms", timeoutMs)
        put("artifact_ids_json", "[]")
        put("observations_pending", 0)
        put("created_at", ts)
        put("updated_at", ts)
        put("cancel_requested", 0)
        put("result_ingested", 0)
      }
    writable().insertOrThrow("jobs", null, values)
    appendEventIdempotent(id, "job.queued", JSONObject(), "${id}:queued")
    appendAudit("job.enqueued", id, "jobId=$id type=$type")
    return@transaction requireJob(id)
  }

  fun requireJob(jobId: String): JobRow =
    getJob(jobId) ?: throw NoSuchElementException("Job $jobId not found")

  fun getJob(jobId: String): JobRow? {
    readable().query("jobs", null, "id = ?", arrayOf(jobId), null, null, null).use { cursor ->
      if (!cursor.moveToFirst()) {
        return null
      }
      return rowFromCursor(cursor)
    }
  }

  fun listJobs(projectId: String?, limit: Int): List<JobRow> {
    val args: Array<String>?
    val where: String?
    if (projectId.isNullOrBlank()) {
      where = null
      args = null
    } else {
      where = "project_id = ?"
      args = arrayOf(projectId)
    }
    val rows = mutableListOf<JobRow>()
    readable()
      .query("jobs", null, where, args, null, null, "created_at DESC", limit.toString())
      .use { cursor ->
        while (cursor.moveToNext()) {
          rows.add(rowFromCursor(cursor))
        }
      }
    return rows
  }

  fun listActiveJobs(): List<JobRow> {
    val rows = mutableListOf<JobRow>()
    readable()
      .query(
        "jobs",
        null,
        "status NOT IN ('completed','failed','cancelled')",
        null,
        null,
        null,
        "created_at ASC",
      )
      .use { cursor ->
        while (cursor.moveToNext()) {
          rows.add(rowFromCursor(cursor))
        }
      }
    return rows
  }

  @Synchronized fun transitionStatus(jobId: String, to: String, eventPayload: JSONObject = JSONObject()): JobRow = transaction {
    val job = requireJob(jobId)
    JobTransitions.assertTransition(job.status, to)
    if (job.status == to) {
      return@transaction job
    }
    val ts = nowIso()
    val values =
      ContentValues().apply {
        put("status", to)
        put("updated_at", ts)
        if (to == "running" && job.startedAt == null) {
          put("started_at", ts)
        }
        if (JobTransitions.isTerminal(to)) {
          put("finished_at", ts)
        }
      }
    writable().update("jobs", values, "id = ?", arrayOf(jobId))
    val payload =
      JSONObject()
        .put("from", job.status)
        .put("to", to)
        .put("detail", eventPayload)
    appendEventIdempotent(jobId, "job.status_changed", payload, "${jobId}:status:${job.status}->$to")
    when (to) {
      "completed" -> appendEventIdempotent(jobId, "job.completed", eventPayload, "${jobId}:completed")
      "failed" -> appendEventIdempotent(jobId, "job.failed", eventPayload, "${jobId}:failed")
      "cancelled" -> appendEventIdempotent(jobId, "job.cancelled", eventPayload, "${jobId}:cancelled")
      "running" -> appendEventIdempotent(jobId, "job.started", eventPayload, "${jobId}:started")
    }
    onUpdate?.invoke(jobId)
    return@transaction requireJob(jobId)
  }

  @Synchronized fun setOperationId(jobId: String, operationId: String) = transaction {
    val values =
      ContentValues().apply {
        put("operation_id", operationId)
        put("updated_at", nowIso())
      }
    writable().update("jobs", values, "id = ?", arrayOf(jobId))
    appendEventIdempotent(
      jobId,
      "job.started",
      JSONObject().put("backendExecutionId", operationId),
      "${jobId}:operation:$operationId",
    )
  }

  @Synchronized fun updateProgress(jobId: String, progress: Double, message: String?) = transaction {
    val payload =
      JSONObject().put("progress", progress).put("message", message ?: JSONObject.NULL)
    appendEventIdempotent(jobId, "job.progress", payload, "${jobId}:progress:${progress}")
    val values =
      ContentValues().apply {
        put("progress", progress)
        put("updated_at", nowIso())
      }
    writable().update("jobs", values, "id = ?", arrayOf(jobId))
  }

  @Synchronized fun completeJob(
    jobId: String,
    exitCode: Int,
    artifactIds: List<String>,
    observationsPending: Boolean,
  ): JobRow = transaction {
    val job = requireJob(jobId)
    if (JobTransitions.isTerminal(job.status)) {
      return@transaction job
    }
    JobTransitions.assertTransition(job.status, "completed")
    val ts = nowIso()
    val values =
      ContentValues().apply {
        put("status", "completed")
        put("exit_code", exitCode)
        put("artifact_ids_json", JSONArray(artifactIds).toString())
        put("observations_pending", if (observationsPending) 1 else 0)
        put("updated_at", ts)
        put("finished_at", ts)
        if (job.startedAt == null) {
          put("started_at", ts)
        }
      }
    writable().update("jobs", values, "id = ?", arrayOf(jobId))
    val payload =
      JSONObject().put("exitCode", exitCode).put("artifactIds", JSONArray(artifactIds))
    appendEventIdempotent(jobId, "job.completed", payload, "${jobId}:completed")
    appendAudit("job.completed", jobId, "exitCode=$exitCode artifacts=${artifactIds.size}")
    onUpdate?.invoke(jobId)
    return@transaction requireJob(jobId)
  }

  @Synchronized fun failJob(jobId: String, errorKey: String, detail: String?, exitCode: Int?): JobRow = transaction {
    val job = requireJob(jobId)
    if (JobTransitions.isTerminal(job.status)) {
      return@transaction job
    }
    JobTransitions.assertTransition(job.status, "failed")
    val ts = nowIso()
    val values =
      ContentValues().apply {
        put("status", "failed")
        put("error_key", errorKey)
        put("error_detail", detail?.let { redactSecrets(it).take(1024) })
        put("exit_code", exitCode)
        put("updated_at", ts)
        put("finished_at", ts)
      }
    writable().update("jobs", values, "id = ?", arrayOf(jobId))
    val payload =
      JSONObject()
        .put("errorKey", errorKey)
        .put("detail", detail ?: JSONObject.NULL)
        .put("exitCode", exitCode ?: JSONObject.NULL)
    appendEventIdempotent(jobId, "job.failed", payload, "${jobId}:failed")
    appendAudit("job.failed", jobId, "errorKey=$errorKey")
    onUpdate?.invoke(jobId)
    return@transaction requireJob(jobId)
  }

  @Synchronized fun cancelJob(jobId: String, reason: String?): JobRow = transaction {
    val job = requireJob(jobId)
    if (JobTransitions.isTerminal(job.status)) {
      return@transaction job
    }
    markCancelRequested(jobId)
    if (!JobTransitions.canTransition(job.status, "cancelled")) {
      return@transaction job
    }
    val ts = nowIso()
    val values =
      ContentValues().apply {
        put("status", "cancelled")
        put("updated_at", ts)
        put("finished_at", ts)
      }
    writable().update("jobs", values, "id = ?", arrayOf(jobId))
    val payload = JSONObject().put("reason", reason ?: JSONObject.NULL)
    appendEventIdempotent(jobId, "job.cancelled", payload, "${jobId}:cancelled")
    appendAudit("job.cancelled", jobId, reason ?: "user_cancel")
    onUpdate?.invoke(jobId)
    return@transaction requireJob(jobId)
  }

  @Synchronized fun markCancelRequested(jobId: String) = transaction {
    val values =
      ContentValues().apply {
        put("cancel_requested", 1)
        put("updated_at", nowIso())
      }
    writable().update("jobs", values, "id = ?", arrayOf(jobId))
  }

  fun isCancelRequested(jobId: String): Boolean = requireJob(jobId).cancelRequested

  @Synchronized fun markResultIngested(jobId: String, marker: String): Boolean = transaction {
    val job = requireJob(jobId)
    require(JobTransitions.isTerminal(job.status))
    require(marker == "observations:$jobId" || marker.startsWith("artifact:") && jsonArrayToList(JSONArray(job.artifactIdsJson)).contains(marker.removePrefix("artifact:")))
    val ts = nowIso()
    val values =
      ContentValues().apply {
        put("job_id", jobId)
        put("marker", marker)
        put("created_at", ts)
      }
    val rowId = writable().insertWithOnConflict("job_ingestion_markers", null, values, SQLiteDatabase.CONFLICT_IGNORE)
    if (rowId == -1L) {
      return@transaction false
    }
    val jobValues =
      ContentValues().apply {
        if (marker == "observations:$jobId") {
          put("result_ingested", 1)
          put("observations_pending", 0)
        }
        put("updated_at", ts)
      }
    writable().update("jobs", jobValues, "id = ?", arrayOf(jobId))
    return@transaction true
  }

  @Synchronized fun appendEventIdempotent(
    jobId: String,
    eventType: String,
    payload: JSONObject,
    idempotencyKey: String,
  ): Boolean = transaction {
    val sequence = nextSequence(jobId)
    val values =
      ContentValues().apply {
        put("job_id", jobId)
        put("sequence", sequence)
        put("event_type", eventType)
        put("payload_json", payload.toString())
        put("emitted_at", nowIso())
        put("idempotency_key", idempotencyKey)
      }
    val rowId =
      writable().insertWithOnConflict("job_events", null, values, SQLiteDatabase.CONFLICT_IGNORE)
    return@transaction rowId != -1L
  }

  fun nextSequence(jobId: String): Int {
    readable()
      .rawQuery("SELECT COALESCE(MAX(sequence), 0) + 1 FROM job_events WHERE job_id = ?", arrayOf(jobId))
      .use { cursor ->
        cursor.moveToFirst()
        return cursor.getInt(0)
      }
  }

  @Synchronized fun appendDiagnostic(jobId: String, line: String) = transaction {
    val redacted = redactSecrets(line)
    val values =
      ContentValues().apply {
        put("job_id", jobId)
        put("line", redacted)
        put("recorded_at", nowIso())
      }
    val db = writable()
    db.insert("job_diagnostics", null, values)
    db.execSQL(
      """
      DELETE FROM job_diagnostics
      WHERE job_id = ?
        AND id NOT IN (
          SELECT id FROM job_diagnostics
          WHERE job_id = ?
          ORDER BY id DESC
          LIMIT ?
        )
      """.trimIndent(),
      arrayOf<Any>(jobId, jobId, JobLedgerDatabase.MAX_DIAGNOSTIC_LINES_PER_JOB),
    )
  }

  @Synchronized fun appendAudit(action: String, jobId: String?, detailRedacted: String) = transaction {
    val values =
      ContentValues().apply {
        put("action", action)
        put("job_id", jobId)
        put("detail_redacted", redactSecrets(detailRedacted))
        put("recorded_at", nowIso())
      }
    writable().insert("job_audit", null, values)
  }

  @Synchronized fun updateSetup(jobId: String, setup: JSONObject) {
    val serialized = setup.toString()
    require(serialized.length <= 4096)
    writable().update("jobs", ContentValues().apply { put("setup_json", serialized) }, "id = ?", arrayOf(jobId))
    onUpdate?.invoke(jobId)
  }

  private fun setupSummary(jobId: String): Map<String, Any?>? = readable().rawQuery("SELECT setup_json FROM jobs WHERE id = ?", arrayOf(jobId)).use { cursor ->
    if (!cursor.moveToFirst() || cursor.isNull(0)) null else {
      val value = JSONObject(cursor.getString(0))
      value.keys().asSequence().associateWith { key -> value.opt(key).takeUnless { it == JSONObject.NULL } }
    }
  }

  fun toSummaryMap(job: JobRow): Map<String, Any?> {
    val artifactIds = jsonArrayToList(JSONArray(job.artifactIdsJson))
    return mapOf(
      "id" to job.id,
      "projectId" to job.projectId,
      "type" to job.type,
      "capabilityId" to job.capabilityId,
      "providerId" to job.providerId,
      "status" to job.status,
      "progress" to job.progress,
      "setup" to setupSummary(job.id),
      "errorDetail" to job.errorDetail,
      "startedAt" to job.startedAt,
      "finishedAt" to job.finishedAt,
      "exitCode" to job.exitCode,
      "errorKey" to job.errorKey,
      "artifactIds" to artifactIds,
      "observationsPending" to job.observationsPending,
      "operationId" to job.operationId,
    )
  }

  private fun rowFromCursor(cursor: android.database.Cursor): JobRow {
    fun col(name: String): Int = cursor.getColumnIndexOrThrow(name)
    return JobRow(
      id = cursor.getString(col("id")),
      projectId = cursor.getString(col("project_id")),
      type = cursor.getString(col("type")),
      capabilityId = cursor.getString(col("capability_id")),
      providerId = cursor.getString(col("provider_id")),
      status = cursor.getString(col("status")),
      parametersJson = cursor.getString(col("parameters_json")),
      commandJson = cursor.getString(col("command_json")),
      timeoutMs = if (cursor.isNull(col("timeout_ms"))) null else cursor.getLong(col("timeout_ms")),
      operationId = cursor.getString(col("operation_id")),
      exitCode = if (cursor.isNull(col("exit_code"))) null else cursor.getInt(col("exit_code")),
      errorKey = cursor.getString(col("error_key")),
      errorDetail = cursor.getString(col("error_detail")),
      artifactIdsJson = cursor.getString(col("artifact_ids_json")),
      progress = if (cursor.isNull(col("progress"))) null else cursor.getDouble(col("progress")),
      observationsPending = cursor.getInt(col("observations_pending")) == 1,
      startedAt = cursor.getString(col("started_at")),
      finishedAt = cursor.getString(col("finished_at")),
      createdAt = cursor.getString(col("created_at")),
      updatedAt = cursor.getString(col("updated_at")),
      cancelRequested = cursor.getInt(col("cancel_requested")) == 1,
      resultIngested = cursor.getInt(col("result_ingested")) == 1,
    )
  }

  @Synchronized fun setArtifacts(jobId: String, ids: List<String>) {
    if (JobTransitions.isTerminal(requireJob(jobId).status)) return
    writable().update("jobs", ContentValues().apply { put("artifact_ids_json", JSONArray(ids).toString()) }, "id = ?", arrayOf(jobId))
  }

  private fun <T> transaction(block: () -> T): T {
    val db = writable()
    db.beginTransaction()
    try {
      val value = block()
      db.setTransactionSuccessful()
      return value
    } finally { db.endTransaction() }
  }

  companion object {
    const val KALI_HEALTH_JOB_TYPE = "workstation.kali_health"

    fun newOperationId(): String = UUID.randomUUID().toString()

    fun redactSecrets(input: String): String {
      return input
        .replace(Regex("(?i)Bearer\\s+[A-Za-z0-9._-]+"), "Bearer [REDACTED]")
        .replace(Regex("(?i)(token|password|secret)=[^\\s&]+"), "$1=[REDACTED]")
    }

    fun jsonArrayToList(array: JSONArray?): List<String> {
      if (array == null) return emptyList()
      return buildList {
        for (index in 0 until array.length()) {
          add(array.optString(index))
        }
      }
    }
  }
}

package expo.modules.jobs

import android.content.Context
import expo.modules.termux.TermuxConstants
import expo.modules.termux.TermuxHelperHttpClient
import expo.modules.termux.TermuxResultParser
import expo.modules.termux.TermuxRunCommandClient
import org.json.JSONObject

/** Owns transport/recovery only; bounded tool policy is enforced again by the backend. */
class JobExecutionRunner(
  private val context: Context,
  private val store: JobLedgerStore,
  private val helperTokenProvider: () -> String?,
) {
  private val helper = TermuxHelperHttpClient()

  fun importMsfdbJobs(): List<String> {
    val token = helperTokenProvider() ?: return emptyList()
    val response = helper.post("/v1/workstation/msfdb/jobs", token, JSONObject())
    if (!response.ok) return emptyList()
    val rows = response.payload?.optJSONArray("jobs") ?: return emptyList()
    if (rows.length() > 50) return emptyList()
    val active = mutableListOf<String>()
    for (index in 0 until rows.length()) {
      try {
        val item = rows.getJSONObject(index)
        val job = store.adoptMsfdbJob(item.getString("jobId"), item.getString("operationId"))
        if (!JobTransitions.isTerminal(job.status)) {
          if (item.getString("status") in listOf("completed", "failed", "cancelled")) reconcile(job.id)
          else active.add(job.id)
        }
      } catch (_: Exception) { /* Reject one malformed row without blocking other jobs. */ }
    }
    return active
  }

  fun execute(jobId: String) {
    var job = store.requireJob(jobId)
    if (JobTransitions.isTerminal(job.status)) return
    if (retireHostJob(job)) return
    if (job.type == "setup.python") { executeBootstrap(jobId); return }
    try {
      if (job.status == "queued") {
        if (job.cancelRequested) { store.cancelJob(jobId, "cancel_before_run"); return }
        job = store.transitionStatus(jobId, "starting")
      }
      // An operation id is persisted BEFORE dispatch. Recovery must poll, never resubmit.
      if (job.operationId != null) { poll(job); return }
      if (helperTokenProvider() == null) {
        store.failJob(jobId, "PERMISSION_DENIED", "Pair the Termux helper before starting a scan.", null)
        return
      }
      store.setOperationId(jobId, JobLedgerStore.newOperationId())
      job = store.transitionStatus(jobId, "running")
      val home = "/data/data/com.termux/files/home/${TermuxConstants.WORKSTATION_HOME}"
      val client = TermuxRunCommandClient(context)
      val request = JSONObject().put("jobId", job.id).put("projectId", job.projectId)
        .put("operationId", job.operationId).put("timeoutMs", job.timeoutMs ?: 120_000L)
      when {
        job.type == JobLedgerStore.KALI_HEALTH_JOB_TYPE -> request.put("task", JSONObject().put("type", "kali.health"))
        job.type == "setup.nethunter" -> request.put("task", JSONObject(job.parametersJson).put("type", "setup.nethunter"))
        job.type == "metasploit.prepare" -> request.put("task", JSONObject(job.parametersJson).put("type", "metasploit.prepare"))
        job.type.startsWith("database.") -> request.put("task", JSONObject(job.parametersJson).put("type", "database"))
        else -> request.put("command", JSONObject(job.commandJson ?: "{}"))
      }
      // Termux owns execution after dispatch. Observe long setup through its ledger
      // immediately so progress and cooperative cancellation remain responsive.
      val dispatchWait = if (job.type == "setup.nethunter") 1000L else (job.timeoutMs ?: 120_000L) + 10_000L
      val result = client.runCommand("$home/${TermuxConstants.RUN_SCRIPT}", arrayOf("--request-json", request.toString()), home, dispatchWait)
      if (result.errorKey != null && result.errorKey != "JOB_TIMEOUT") {
        if (job.type == "setup.nethunter" && result.errorKey !in setOf("TERMUX_NOT_INSTALLED", "TERMUX_PERMISSION_DENIED", "INVALID_PAYLOAD")) {
          store.transitionStatus(jobId, "waiting_for_device")
          return
        }
        store.failJob(jobId, result.errorKey ?: "JOB_FAILED", "Termux dispatch failed.", result.exitCode)
        return
      }
      if (result.stdout.isNotBlank()) {
        val payload = try { JSONObject(result.stdout) } catch (_: Exception) { null }
        if (payload != null && applyResult(jobId, payload)) return
        if (payload?.optString("errorKey") == "INVALID_PAYLOAD") {
          store.failJob(jobId, "INVALID_PAYLOAD", "Backend rejected the request.", result.exitCode)
          return
        }
      }
      poll(store.requireJob(jobId))
    } catch (_: Exception) {
      val current = store.requireJob(jobId)
      if (!JobTransitions.isTerminal(current.status)) store.failJob(jobId, "JOB_FAILED", "Native job execution failed.", null)
    }
  }

  private fun executeBootstrap(jobId: String) {
    try {
      var job = store.requireJob(jobId)
      if (job.status == "queued") {
        if (job.cancelRequested) { store.cancelJob(jobId, "cancel_before_run"); return }
        job = store.transitionStatus(jobId, "starting")
      }
      val bootstrap = expo.modules.termux.WorkstationPrerequisites(context)
      if (job.operationId == null) { store.setOperationId(jobId, JobLedgerStore.newOperationId()); job = store.requireJob(jobId) }
      if (job.status != "running") job = store.transitionStatus(jobId, "running")
      val operation = job.operationId!!
      var result = bootstrap.call("status", operation)
      // Only a confirmed absent operation can be dispatched, including lost-ack recovery.
      if (result.optString("errorKey") == "JOB_NOT_FOUND") result = bootstrap.call("start", operation)
      val remaining = ((job.timeoutMs ?: 7_200_000L) - (System.currentTimeMillis() - java.time.Instant.parse(job.createdAt).toEpochMilli())).coerceAtLeast(15000L)
      val until = android.os.SystemClock.elapsedRealtime() + remaining
      while (true) {
        result.put("jobId", jobId)
        if (applyResult(jobId, result)) return
        if (!result.optBoolean("ok") && !result.has("status")) {
          store.transitionStatus(jobId, "waiting_for_device"); return
        }
        if (store.isCancelRequested(jobId)) bootstrap.call("cancel", operation)
        if (android.os.SystemClock.elapsedRealtime() >= until) { store.transitionStatus(jobId, "waiting_for_device"); return }
        Thread.sleep(2000)
        result = bootstrap.call("status", operation)
      }
    } catch (_: Exception) {
      val job = store.requireJob(jobId)
      if (!JobTransitions.isTerminal(job.status)) store.transitionStatus(jobId, "waiting_for_device")
    }
  }

  private fun retireHostJob(job: JobRow): Boolean {
    if (job.type != "metasploit.prepare" && !job.type.startsWith("database.")) return false
    val profile = try { JSONObject(job.parametersJson).optString("profileId", "") } catch (_: Exception) { "" }
    if (profile == "termux-local") return false
    if (store.requireJob(job.id).status == "queued") store.transitionStatus(job.id, "starting")
    store.failJob(job.id, "DATABASE_PROFILE_RETIRED", "Host database work is unavailable. Its original result is unknown; no device operation was dispatched.", null)
    return true
  }

  private fun poll(job: JobRow) {
    val deadline = android.os.SystemClock.elapsedRealtime() + (job.timeoutMs ?: 120_000L) + 15_000L
    do {
      if (reconcile(job.id)) return
      if (store.isCancelRequested(job.id)) requestCancel(job.id)
      if (JobTransitions.isTerminal(store.requireJob(job.id).status)) return
      Thread.sleep(1_000)
    } while (android.os.SystemClock.elapsedRealtime() < deadline)
    val current = store.requireJob(job.id)
    if (current.status == "running" || current.status == "starting") {
      store.transitionStatus(job.id, "waiting_for_device")
    }
    // Keep the uncertain result recoverable. Backend independently enforces its deadline.
  }

  fun reconcile(jobId: String): Boolean {
    val job = store.getJob(jobId) ?: return false
    if (JobTransitions.isTerminal(job.status)) return true
    if (retireHostJob(job)) return true
    if (job.type == "setup.python") {
      val operation = job.operationId ?: return false
      val result = expo.modules.termux.WorkstationPrerequisites(context).call("status", operation).put("jobId", job.id)
      return applyResult(job.id, result)
    }
    val token = helperTokenProvider() ?: return false
    val operation = job.operationId ?: return false
    val response = helper.getJobStatus(token, jobId, operation)
    return response.ok && response.payload?.let { applyResult(jobId, it) } == true
  }

  internal fun applyResult(jobId: String, payload: JSONObject): Boolean {
    val job = store.requireJob(jobId)
    if (payload.optString("jobId") != job.id || payload.optString("operationId") != job.operationId) return false
    if (job.type.startsWith("setup.")) store.updateSetup(jobId, payload.optJSONObject("setup") ?: JSONObject().put("phase", payload.optString("phase", "checking_status")).put("cancelDeferred", payload.optString("phase") == "installing_python"))
    val status = payload.optString("status")
    if (status !in JobTransitions.TERMINAL) return false
    if (JobTransitions.isTerminal(job.status)) return true
    if (retireHostJob(job)) return true
    val artifacts = JobLedgerStore.jsonArrayToList(payload.optJSONArray("artifactIds"))
    if (artifacts.any { expo.modules.termux.TermuxResultParser.validateId(it, 128, "artifactId") != null }) return false
    if (job.status == "starting" || job.status == "waiting_for_device") store.transitionStatus(jobId, "running")
    store.setArtifacts(jobId, artifacts)
    when (status) {
      "completed" -> {
        if (payload.isNull("exitCode") || payload.optInt("exitCode", -1) != 0) return false
        store.completeJob(jobId, 0, artifacts, job.type == "nmap.scan")
      }
      "failed" -> store.failJob(jobId, payload.optString("errorKey", "JOB_FAILED").takeUnless { it == "null" } ?: "JOB_FAILED", if (job.type.startsWith("setup.")) payload.optString("detail", "Setup needs checking.").take(512) else "Backend job failed.", if (payload.isNull("exitCode")) null else payload.getInt("exitCode"))
      "cancelled" -> store.cancelJob(jobId, "backend_acknowledged")
    }
    return true
  }

  fun requestCancel(jobId: String) {
    val job = store.getJob(jobId) ?: return
    if (JobTransitions.isTerminal(job.status)) return
    if (retireHostJob(job)) return
    store.markCancelRequested(jobId)
    if (job.operationId == null) { store.cancelJob(jobId, "cancel_before_dispatch"); return }
    if (job.type == "setup.python") {
      val result = expo.modules.termux.WorkstationPrerequisites(context).call("cancel", job.operationId!!).put("jobId", job.id)
      applyResult(jobId, result)
      return
    }
    val token = helperTokenProvider() ?: return
    val response = helper.cancelJob(token, jobId, job.operationId)
    if (response.ok) response.payload?.let { applyResult(jobId, it) }
  }
}

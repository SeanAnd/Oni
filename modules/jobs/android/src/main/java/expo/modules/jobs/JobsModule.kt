package expo.modules.jobs

import android.content.Context
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONObject
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicReference

class JobsModule : Module() {
  private lateinit var jobsRuntime: JobsRuntime
  private lateinit var store: JobLedgerStore
  private lateinit var runner: JobExecutionRunner
  private val executor = Executors.newSingleThreadExecutor()

  override fun definition() = ModuleDefinition {
    Name("SkidJobs")

    Events("onJobUpdated")

    OnCreate {
      val context = appContext.reactContext ?: return@OnCreate
      initRuntime(context)
      jobsRuntime.onUpdate = { emitJobUpdate(it) }
    }

    OnDestroy {
      if (::jobsRuntime.isInitialized) jobsRuntime.onUpdate = null
      executor.shutdown()
    }

    AsyncFunction("configureTermuxHelperToken") { token: String? ->
      val context = appContext.reactContext ?: return@AsyncFunction mapOf("ok" to false)
      initRuntime(context)
      jobsRuntime.configureToken(token)
      mapOf("ok" to true)
    }

    AsyncFunction("enqueueJob") { specJson: String ->
      val context = appContext.reactContext
      if (context == null) {
        return@AsyncFunction mapOf("ok" to false, "errorKey" to "CAPABILITY_UNAVAILABLE", "detail" to "React context unavailable.")
      }
      initRuntime(context)
      try {
        val spec = JSONObject(specJson)
        JobSpecPolicy.validate(spec)
        val jobId = spec.getString("id")
        val row =
          store.insertQueuedJob(
            id = jobId,
            projectId = spec.getString("projectId"),
            type = spec.getString("type"),
            capabilityId = spec.getString("capabilityId"),
            providerId = spec.getString("providerId"),
            parametersJson = spec.optJSONObject("parameters")?.toString() ?: "{}",
            commandJson = spec.optJSONObject("command")?.toString(),
            timeoutMs = if (spec.has("timeoutMs")) spec.getLong("timeoutMs") else null,
          )
        emitJobUpdate(row.id)
        try {
          JobForegroundService.startJob(context, jobId)
        } catch (_: Exception) {
          store.transitionStatus(jobId, "starting")
          store.failJob(jobId, "PERMISSION_DENIED", "Foreground execution could not start.", null)
          return@AsyncFunction mapOf("ok" to false, "jobId" to jobId, "errorKey" to "PERMISSION_DENIED")
        }
        mapOf("ok" to true, "jobId" to jobId)
      } catch (error: Exception) {
        mapOf("ok" to false, "errorKey" to "INVALID_PAYLOAD", "detail" to (error.message ?: "Invalid job spec."))
      }
    }

    AsyncFunction("cancelJob") { jobId: String ->
      val context = appContext.reactContext
      if (context == null) {
        return@AsyncFunction mapOf("ok" to false, "errorKey" to "CAPABILITY_UNAVAILABLE")
      }
      initRuntime(context)
      executor.execute {
        runner.requestCancel(jobId)
        emitJobUpdate(jobId)
      }
      mapOf("ok" to true, "jobId" to jobId)
    }

    AsyncFunction("getJob") { jobId: String ->
      val context = appContext.reactContext ?: return@AsyncFunction null
      initRuntime(context)
      val job = store.getJob(jobId) ?: return@AsyncFunction null
      store.toSummaryMap(job)
    }

    AsyncFunction("listJobs") { projectId: String?, limit: Int ->
      val context = appContext.reactContext ?: return@AsyncFunction emptyList<Map<String, Any?>>()
      initRuntime(context)
      store.listJobs(projectId, limit.coerceIn(1, 500)).map { store.toSummaryMap(it) }
    }

    AsyncFunction("reconcile") {
      val context = appContext.reactContext
      if (context == null) {
        return@AsyncFunction mapOf("ok" to false, "reconciledCount" to 0)
      }
      initRuntime(context)
      val count = reconcileInternal(context)
      mapOf("ok" to true, "reconciledCount" to count)
    }

    AsyncFunction("markResultIngested") { jobId: String, marker: String ->
      val context = appContext.reactContext
      if (context == null) {
        return@AsyncFunction mapOf("ok" to false, "inserted" to false)
      }
      initRuntime(context)
      val inserted = store.markResultIngested(jobId, marker)
      mapOf("ok" to true, "inserted" to inserted)
    }
  }

  private fun initRuntime(context: Context) {
    if (!::store.isInitialized) {
      jobsRuntime = JobsRuntime.get(context)
      store = jobsRuntime.store
      runner = jobsRuntime.runner
    }
  }

  private fun emitJobUpdate(jobId: String) {
    val job = store.getJob(jobId) ?: return
    sendEvent(
      "onJobUpdated",
      mapOf("summary" to store.toSummaryMap(job)),
    )
  }

  private fun reconcileInternal(context: Context): Int {
    executor.execute {
      for (id in runner.importMsfdbJobs()) JobForegroundService.startJob(context, id)
    }
    val jobs = store.listActiveJobs()
    for (job in jobs) JobForegroundService.startJob(context, job.id)
    return jobs.size
  }
}

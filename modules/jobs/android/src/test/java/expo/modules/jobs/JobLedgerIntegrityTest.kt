package expo.modules.jobs

import android.content.Context
import androidx.test.core.app.ApplicationProvider
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith
import org.robolectric.RobolectricTestRunner
import org.robolectric.annotation.Config
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit

@RunWith(RobolectricTestRunner::class)
@Config(sdk = [28], manifest = Config.NONE)
class JobLedgerIntegrityTest {
  private lateinit var context: Context
  private lateinit var store: JobLedgerStore
  @Before fun setup() {
    context = ApplicationProvider.getApplicationContext()
    context.deleteDatabase(JobLedgerDatabase.DATABASE_NAME)
    store = JobLedgerStore(context)
  }
  private fun queue() = store.insertQueuedJob("job", "project", "nmap.scan", "network.service_detection", "provider.kali.nmap", "{}", "{}", 15000)
  @Test fun cliAdoptionPersistsOperationBeforeRecoveryAndIsIdempotent() {
    val id = "msfdb-" + "a".repeat(32)
    store.adoptMsfdbJob(id, "cli-operation")
    val reopened = JobLedgerStore(context)
    val row = reopened.adoptMsfdbJob(id, "cli-operation")
    assertEquals("running", row.status)
    assertEquals("cli-operation", row.operationId)
    assertEquals("system-onboarding", row.projectId)
    assertEquals(1, reopened.listJobs(null, 50).size)
    try { reopened.adoptMsfdbJob(id, "other"); fail("operation changed") } catch (_: IllegalArgumentException) {}
    assertEquals("cli-operation", reopened.requireJob(id).operationId)
  }
  private fun running() {
    queue(); store.transitionStatus("job", "starting"); store.setOperationId("job", "operation"); store.transitionStatus("job", "running")
  }
  @Test fun duplicateIdCannotReplaceExistingJob() {
    queue()
    try { queue(); fail("duplicate accepted") } catch (_: android.database.sqlite.SQLiteConstraintException) {}
    assertEquals(1, store.listJobs(null, 50).size)
  }
  @Test fun concurrentTerminalResultsAreSerialized() {
    running()
    val executor = Executors.newFixedThreadPool(2)
    val first = executor.submit { store.completeJob("job", 0, listOf("artifact"), true) }
    val second = executor.submit { store.failJob("job", "JOB_FAILED", null, 1) }
    first.get(5, TimeUnit.SECONDS); second.get(5, TimeUnit.SECONDS)
    executor.shutdown()
    val terminal = store.requireJob("job").status
    assertTrue(JobTransitions.isTerminal(terminal))
    store.cancelJob("job", "late")
    assertEquals(terminal, store.requireJob("job").status)
  }
  @Test fun recoveryUsesPersistedLedgerAndIngestionMarkersAreIndependent() {
    running(); store.completeJob("job", 0, listOf("artifact"), true)
    val reopened = JobLedgerStore(context)
    assertEquals("operation", reopened.requireJob("job").operationId)
    assertTrue(reopened.markResultIngested("job", "artifact:artifact"))
    assertTrue(reopened.requireJob("job").observationsPending)
    assertTrue(reopened.markResultIngested("job", "observations:job"))
    assertFalse(reopened.requireJob("job").observationsPending)
    assertFalse(reopened.markResultIngested("job", "observations:job"))
  }
  @Test fun invalidMarkerDoesNotAcknowledgeAnotherArtifact() {
    running(); store.completeJob("job", 0, listOf("artifact"), true)
    try { store.markResultIngested("job", "artifact:foreign"); fail("foreign marker accepted") } catch (_: IllegalArgumentException) {}
    assertTrue(store.requireJob("job").observationsPending)
  }
  @Test fun resultMustMatchOperationAndCarryAnActualExitCode() {
    running()
    val runner = JobExecutionRunner(context, store) { null }
    val payload = JSONObject().put("jobId", "job").put("operationId", "wrong").put("status", "completed").put("exitCode", 0)
    assertFalse(runner.applyResult("job", payload))
    payload.put("operationId", "operation").remove("exitCode")
    assertFalse(runner.applyResult("job", payload))
    assertEquals("running", store.requireJob("job").status)
  }
  @Test fun offlineCancelRemainsPendingUntilBackendAcknowledges() {
    running()
    JobExecutionRunner(context, store) { null }.requestCancel("job")
    assertTrue(store.requireJob("job").cancelRequested)
    assertEquals("running", store.requireJob("job").status)
  }
  @Test fun setupProgressSurvivesReopeningAndOnlyMatchingOperationCanUpdateIt() {
    store.insertQueuedJob("setup", "system-onboarding", "setup.python", "workstation.setup", "provider.termux.setup", "{}", null, 7200000)
    store.transitionStatus("setup", "starting"); store.setOperationId("setup", "operation"); store.transitionStatus("setup", "running")
    val runner = JobExecutionRunner(context, store) { null }
    val payload = JSONObject().put("jobId", "setup").put("operationId", "operation").put("status", "running").put("phase", "installing_python")
    assertFalse(runner.applyResult("setup", payload))
    val reopened = JobLedgerStore(context)
    val progress = reopened.toSummaryMap(reopened.requireJob("setup"))["setup"] as Map<*, *>
    assertEquals("installing_python", progress["phase"])
    assertEquals(true, progress["cancelDeferred"])
    payload.put("operationId", "foreign").put("phase", "ready")
    assertFalse(runner.applyResult("setup", payload))
    assertEquals(progress, reopened.toSummaryMap(reopened.requireJob("setup"))["setup"])
  }
  @Test fun queuedCancelNeverStartsWork() {
    queue()
    val runner = JobExecutionRunner(context, store) { null }
    runner.requestCancel("job"); runner.execute("job")
    assertEquals("cancelled", store.requireJob("job").status)
    assertNull(store.requireJob("job").operationId)
  }
  @Test fun retiresQueuedHostDatabaseWorkWithoutTransportOrChangingParameters() {
    val parameters = """{"profileId":"retired-profile"}"""
    store.insertQueuedJob("legacy", "project", "metasploit.prepare", "metasploit.database", "provider.kali.metasploit", parameters, null, 15000)
    val runner = JobExecutionRunner(context, store) { throw AssertionError("Retired work must not access transport") }
    runner.execute("legacy")
    val result = store.requireJob("legacy")
    assertEquals("failed", result.status)
    assertEquals("DATABASE_PROFILE_RETIRED", result.errorKey)
    assertEquals(parameters, result.parametersJson)
    assertNull(result.operationId)
  }
  @Test fun retiresUncertainHostRecoveryWithoutPollingOrResubmittingAgainstDevice() {
    store.insertQueuedJob("legacy", "project", "database.start", "metasploit.database", "provider.retired.postgresql", "{}", null, 15000)
    store.transitionStatus("legacy", "starting");store.setOperationId("legacy", "original-host-operation");store.transitionStatus("legacy", "running")
    val runner = JobExecutionRunner(context, store) { throw AssertionError("Retired recovery must not poll") }
    assertTrue(runner.reconcile("legacy"))
    assertEquals("DATABASE_PROFILE_RETIRED", store.requireJob("legacy").errorKey)
    assertEquals("original-host-operation", store.requireJob("legacy").operationId)
  }
  @Test fun eventsHaveUniqueMonotonicSequencesUnderConcurrency() {
    queue()
    val executor = Executors.newFixedThreadPool(4)
    val tasks = (1..30).map { index -> executor.submit { store.appendEventIdempotent("job", "test", JSONObject(), "key-$index") } }
    tasks.forEach { it.get(5, TimeUnit.SECONDS) }; executor.shutdown()
    assertEquals(32, store.nextSequence("job"))
  }
}

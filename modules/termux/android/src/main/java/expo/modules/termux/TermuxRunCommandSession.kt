package expo.modules.termux

import android.content.Intent
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit
import java.util.concurrent.atomic.AtomicReference

internal data class PendingRunSession(
  val latch: CountDownLatch,
  val resultRef: AtomicReference<TermuxResultParser.RunCompletion?>,
)

internal object TermuxRunCommandSession {

  private val sessions = ConcurrentHashMap<String, PendingRunSession>()

  fun remove(requestId: String) { sessions.remove(requestId) }

  fun register(requestId: String): PendingRunSession {
    val session = PendingRunSession(CountDownLatch(1), AtomicReference(null))
    sessions[requestId] = session
    return session
  }

  fun consumePending(resultIntent: Intent): PendingRunSession? {
    val requestId = resultIntent.getStringExtra(EXTRA_REQUEST_ID) ?: return null
    return sessions.remove(requestId)
  }

  fun complete(session: PendingRunSession, completion: TermuxResultParser.RunCompletion) {
    session.resultRef.set(completion)
    session.latch.countDown()
  }

  fun completeSession(requestId: String, completion: TermuxResultParser.RunCompletion) {
    sessions.remove(requestId)?.let { session -> complete(session, completion) }
  }

  fun await(session: PendingRunSession, timeoutMs: Long): TermuxResultParser.RunCompletion {
    val completed = session.latch.await(timeoutMs, TimeUnit.MILLISECONDS)
    if (!completed) {
      return TermuxResultParser.RunCompletion(
        null,
        "",
        "",
        "JOB_TIMEOUT",
        "Termux RUN_COMMAND timed out.",
      )
    }
    return session.resultRef.get()
      ?: TermuxResultParser.RunCompletion(
        null,
        "",
        "",
        "PARSER_FAILED",
        "Termux RUN_COMMAND returned no result.",
      )
  }

  const val EXTRA_REQUEST_ID = "com.skid.termux.RUN_COMMAND_REQUEST_ID"
}

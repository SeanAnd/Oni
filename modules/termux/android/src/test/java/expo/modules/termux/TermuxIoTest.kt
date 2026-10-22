package expo.modules.termux

import java.util.concurrent.CountDownLatch
import java.util.concurrent.Executors
import java.util.concurrent.TimeUnit
import kotlinx.coroutines.async
import kotlinx.coroutines.asCoroutineDispatcher
import kotlinx.coroutines.runBlocking
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class TermuxIoTest {
  @Test fun slowProbeDoesNotBlockSharedModuleQueueOrIndependentIo() {
    val entered = CountDownLatch(1)
    val release = CountDownLatch(1)
    Executors.newSingleThreadExecutor().asCoroutineDispatcher().use { moduleQueue ->
      runBlocking {
        val slow = async(moduleQueue) {
          TermuxIo.run {
            entered.countDown()
            check(release.await(5, TimeUnit.SECONDS))
            "probe done"
          }
        }
        try {
          assertTrue(entered.await(2, TimeUnit.SECONDS))
          val responsive = CountDownLatch(1)
          val controls = async(moduleQueue) {
            val result = TermuxIo.run { "cancel acknowledged" }
            responsive.countDown()
            result
          }
          assertTrue("Job controls were blocked behind the probe", responsive.await(2, TimeUnit.SECONDS))
          assertEquals("cancel acknowledged", controls.await())
        } finally {
          release.countDown()
        }
        assertEquals("probe done", slow.await())
      }
    }
  }

  @Test fun propagatesTransportFailuresToTheCaller() = runBlocking {
    val failure = IllegalStateException("transport unavailable")
    try {
      TermuxIo.run { throw failure }
      throw AssertionError("Expected transport failure")
    } catch (error: IllegalStateException) {
      assertEquals(failure.message, error.message)
    }
  }
}

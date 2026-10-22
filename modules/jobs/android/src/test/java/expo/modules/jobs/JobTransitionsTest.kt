package expo.modules.jobs

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class JobTransitionsTest {
  @Test
  fun allowsDocumentedLifecycle() {
    assertTrue(JobTransitions.canTransition("queued", "starting"))
    assertTrue(JobTransitions.canTransition("running", "completed"))
    assertTrue(JobTransitions.canTransition("waiting_for_device", "running"))
  }

  @Test
  fun rejectsTerminalOverwrites() {
    assertFalse(JobTransitions.canTransition("completed", "running"))
    assertFalse(JobTransitions.canTransition("failed", "queued"))
  }

  @Test
  fun assertTransitionThrowsForIllegalMove() {
    try {
      JobTransitions.assertTransition("completed", "running")
      throw AssertionError("expected exception")
    } catch (error: IllegalJobTransitionException) {
      assertTrue(error.message!!.contains("completed"))
    }
  }
}

package expo.modules.jobs

/** Mirrors `src/core/jobs/transitions.ts` — legal status moves only. */
object JobTransitions {
  val TERMINAL = setOf("completed", "failed", "cancelled")

  private val LEGAL: Map<String, List<String>> =
    mapOf(
      "queued" to listOf("starting", "cancelled"),
      "starting" to listOf("running", "waiting_for_device", "failed", "cancelled"),
      "running" to listOf("completed", "failed", "cancelled", "waiting_for_device"),
      "waiting_for_device" to listOf("running", "failed", "cancelled"),
      "completed" to emptyList(),
      "failed" to emptyList(),
      "cancelled" to emptyList(),
    )

  fun isTerminal(status: String): Boolean = status in TERMINAL

  fun canTransition(from: String, to: String): Boolean {
    if (from == to) {
      return true
    }
    if (isTerminal(from)) {
      return false
    }
    return LEGAL[from]?.contains(to) == true
  }

  fun assertTransition(from: String, to: String) {
    if (!canTransition(from, to)) {
      throw IllegalJobTransitionException(from, to)
    }
  }
}

class IllegalJobTransitionException(val from: String, val to: String) :
  Exception("Illegal job transition from $from to $to")

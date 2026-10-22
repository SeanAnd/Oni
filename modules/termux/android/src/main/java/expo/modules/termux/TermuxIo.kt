package expo.modules.termux

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext

/** Blocking IPC/HTTP must yield Expo's shared module queue, including to job controls. */
internal object TermuxIo {
  private val dispatcher = Dispatchers.IO.limitedParallelism(4)

  suspend fun <T> run(block: () -> T): T = withContext(dispatcher) { block() }
}

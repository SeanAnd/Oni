package expo.modules.termux

import android.content.Context
import org.json.JSONObject

/** Narrow pre-helper transport shared by detection and the durable native job runner. */
class WorkstationPrerequisites(private val context: Context) {
  fun call(action: String, operationId: String): JSONObject {
    val result = TermuxRunCommandClient(context).runBootstrap(action, operationId)
    if (result.errorKey != null) return JSONObject().put("ok", false).put("errorKey", result.errorKey)
    return try {
      require(result.exitCode == 0)
      JSONObject(result.stdout)
    } catch (_: Exception) {
      JSONObject().put("ok", false).put("errorKey", "SETUP_BOOTSTRAP_UNAVAILABLE")
    }
  }
}

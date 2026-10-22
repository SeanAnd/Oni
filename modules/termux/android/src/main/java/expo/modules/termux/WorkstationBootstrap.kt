package expo.modules.termux

import android.content.Context
import android.util.Base64
import org.json.JSONObject
import java.security.MessageDigest

/** APK-owned source, bounded stdin chunks; no host transport or request-supplied code. */
internal class WorkstationBootstrap(private val context: Context?) {
  fun install(token: String): Map<String, Any?> {
    if (context == null) return mapOf("ok" to false, "errorKey" to "CAPABILITY_UNAVAILABLE")
    if (!token.matches(Regex("^[A-Za-z0-9_-]{32,128}$"))) return mapOf("ok" to false, "errorKey" to "INVALID_PAYLOAD")
    val prerequisites = WorkstationPrerequisites(context).call("probe", "probe")
    if (!prerequisites.optBoolean("ok")) return mapOf("ok" to false, "errorKey" to prerequisites.optString("errorKey", "SETUP_BOOTSTRAP_UNAVAILABLE"))
    if (!prerequisites.optBoolean("pythonReady")) return mapOf("ok" to false, "errorKey" to "SETUP_PYTHON_UNAVAILABLE", "detail" to "Install the missing runtime through setup first.")
    val bytes = context.assets.open("skid-backend.zip").use { it.readBytes() }
    require(bytes.size <= 2 * 1024 * 1024)
    val receiver = context.assets.open("skid-receive-bundle.py").bufferedReader().use { it.readText() }
    val digest = MessageDigest.getInstance("SHA-256").digest(bytes).joinToString("") { "%02x".format(it) }
    val client = TermuxRunCommandClient(context)
    fun call(request: JSONObject): Map<String, Any?> {
      val result = client.runCommand("/data/data/com.termux/files/usr/bin/python3", arrayOf("-c", receiver), "/data/data/com.termux/files/home", 30_000L, request.toString())
      if (result.errorKey != null) return mapOf("ok" to false, "errorKey" to result.errorKey, "detail" to "Termux could not receive the helper. Check its permissions and retry the saved setup.")
      return TermuxResultParser.parseScriptStdout(result.stdout, result.exitCode)
    }
    for (offset in bytes.indices step 32768) {
      val chunk = bytes.copyOfRange(offset, minOf(offset + 32768, bytes.size))
      val result = call(JSONObject().put("action", "chunk").put("sha256", digest).put("offset", offset).put("data", Base64.encodeToString(chunk, Base64.NO_WRAP)))
      if (result["ok"] != true) return result
    }
    return call(JSONObject().put("action", "activate").put("sha256", digest).put("token", token))
  }
}

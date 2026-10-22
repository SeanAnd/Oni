package expo.modules.termux

import org.json.JSONObject

/** Pure parsing helpers for Termux RUN_COMMAND completion envelopes and health JSON. */
object TermuxResultParser {
  data class RunCompletion(
    val exitCode: Int?,
    val stdout: String,
    val stderr: String,
    val errorKey: String?,
    val detail: String?,
  )

  data class HealthPayload(
    val ok: Boolean,
    val arch: String?,
    val kaliRelease: String?,
    val nhPath: String?,
    val helperVersion: String?,
    val errorKey: String?,
    val detail: String?,
  )

  fun mapRunFailure(message: String): RunCompletion {
    val normalized = message.lowercase()
    val errorKey =
      when {
        normalized.contains("permission") -> "TERMUX_PERMISSION_DENIED"
        normalized.contains("allow-external-apps") || normalized.contains("external apps") ->
          "TERMUX_PERMISSION_DENIED"
        normalized.contains("not installed") || normalized.contains("unable to resolve") ->
          "TERMUX_NOT_INSTALLED"
        normalized.contains("timeout") -> "JOB_TIMEOUT"
        else -> "CAPABILITY_UNAVAILABLE"
      }
    return RunCompletion(null, "", "", errorKey, "Termux command could not complete; check app permissions and workstation setup.")
  }

  fun parseHealthStdout(stdout: String): HealthPayload {
    val trimmed = stdout.trim()
    if (trimmed.isEmpty()) {
      return HealthPayload(
        ok = false,
        arch = null,
        kaliRelease = null,
        nhPath = null,
        helperVersion = null,
        errorKey = "PARSER_FAILED",
        detail = "Health probe returned empty output.",
      )
    }
    return try {
      val json = JSONObject(trimmed)
      val ok = json.optBoolean("ok", false)
      HealthPayload(
        ok = ok,
        arch = nullableField(json, "arch"),
        kaliRelease = nullableField(json, "kaliRelease"),
        nhPath = nullableField(json, "nhPath"),
        helperVersion = nullableField(json, "helperVersion"),
        errorKey = if (ok) null else nullableField(json, "errorKey") ?: "NETHUNTER_NOT_FOUND",
        detail = if (ok) null else nullableField(json, "detail") ?: "NetHunter health check failed.",
      )
    } catch (error: Exception) {
      HealthPayload(
        ok = false,
        arch = null,
        kaliRelease = null,
        nhPath = null,
        helperVersion = null,
        errorKey = "PARSER_FAILED",
        detail = "Health probe returned malformed JSON.",
      )
    }
  }

  fun validateId(value: String, maxLength: Int, fieldName: String): String? {
    if (value.isBlank() || value == "." || value == "..") {
      return "$fieldName must be non-empty"
    }
    if (value.length > maxLength) {
      return "$fieldName exceeds maximum length"
    }
    if (!value.matches(ID_PATTERN)) {
      return "$fieldName contains invalid characters"
    }
    return null
  }

  fun parseScriptStdout(stdout: String, exitCode: Int?): Map<String, Any?> {
    return try {
      val json = JSONObject(stdout.trim())
      val ok = exitCode == 0 && json.optBoolean("ok", false)
      mapOf(
        "ok" to ok,
        "errorKey" to if (ok) null else nullableField(json, "errorKey") ?: "METASPLOIT_UNAVAILABLE",
        "detail" to nullableField(json, "detail"),
        "connected" to (ok && json.optBoolean("connected", false)),
        "schemaReady" to (ok && json.optBoolean("schemaReady", false)),
        "launchAcknowledged" to (ok && json.optBoolean("launchAcknowledged", false)),
        "configured" to (ok && json.optBoolean("configured", false)),
      )
    } catch (_: Exception) {
      mapOf("ok" to false, "errorKey" to "PARSER_FAILED", "detail" to "Workstation script returned malformed JSON.",
        "connected" to false, "schemaReady" to false, "launchAcknowledged" to false, "configured" to false)
    }
  }

  private val ID_PATTERN = Regex("^[A-Za-z0-9._-]+$")

  // optString coerces JSONObject.NULL into the literal string "null" on Android.
  fun nullableField(json: JSONObject, key: String): String? =
    (json.opt(key) as? String)?.takeIf { it.isNotBlank() }
}

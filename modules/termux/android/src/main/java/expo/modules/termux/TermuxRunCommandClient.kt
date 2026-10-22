package expo.modules.termux

import android.app.PendingIntent
import android.content.Context
import android.content.Intent
import android.content.pm.PackageManager
import android.os.Build
import android.net.Uri
import java.util.UUID

class TermuxRunCommandClient(private val context: Context) {
  fun isTermuxInstalled(): Boolean {
    return try {
      context.packageManager.getPackageInfo(TermuxConstants.TERMUX_PACKAGE, 0)
      true
    } catch (_: PackageManager.NameNotFoundException) {
      false
    }
  }

  fun hasRunCommandPermission(): Boolean {
    val result = context.checkCallingOrSelfPermission("com.termux.permission.RUN_COMMAND")
    return result == PackageManager.PERMISSION_GRANTED
  }

  /**
   * Runs an executable inside Termux via RUN_COMMAND and waits for the PendingIntent result.
   * [commandPath] must be an absolute path inside Termux; [arguments] are passed verbatim.
   */
  fun runCommand(
    commandPath: String,
    arguments: Array<String>,
    workdir: String?,
    timeoutMs: Long,
    stdin: String? = null,
  ): TermuxResultParser.RunCompletion {
    return runTransport("/data/data/com.termux/files/usr/bin/python3",
      if (commandPath == "/data/data/com.termux/files/usr/bin/python3") arguments else arrayOf(commandPath, *arguments), workdir, timeoutMs, stdin)
  }

  /** Internal APK-owned bootstrap only. No caller-provided code or binary. */
  internal fun runBootstrap(action: String, operationId: String): TermuxResultParser.RunCompletion {
    require(action in setOf("probe", "start", "status", "cancel"))
    require(TermuxResultParser.validateId(operationId, 128, "operationId") == null)
    val source = context.assets.open("oni-ensure-python.sh").use { it.readBytes() }
    val digest = java.security.MessageDigest.getInstance("SHA-256").digest(source).joinToString("") { "%02x".format(it) }
    val receiver = """
umask 077
unset BASH_ENV ENV
root="${'$'}HOME/.rootless-workstation/bootstrap-assets"
mkdir -p "${'$'}root" || exit 1
file="${'$'}root/${'$'}1.sh"
temporary="${'$'}(mktemp "${'$'}root/delivery.XXXXXX")" || exit 1
base64 -d > "${'$'}temporary"
actual="${'$'}(sha256sum "${'$'}temporary")"
[ "${'$'}{actual%% *}" = "${'$'}1" ] || { rm -f "${'$'}temporary"; exit 1; }
mv "${'$'}temporary" "${'$'}file" || exit 1
exec /data/data/com.termux/files/usr/bin/bash --noprofile --norc "${'$'}file" "${'$'}2" "${'$'}3"
""".trimIndent()
    return runTransport("/data/data/com.termux/files/usr/bin/bash", arrayOf("--noprofile", "--norc", "-p", "-c", receiver, "oni-bootstrap", digest, action, operationId), "/data/data/com.termux/files/home", 15000, android.util.Base64.encodeToString(source, android.util.Base64.NO_WRAP))
  }

  private fun runTransport(commandPath: String, arguments: Array<String>, workdir: String?, timeoutMs: Long, stdin: String?): TermuxResultParser.RunCompletion {
    if (!isTermuxInstalled()) {
      return TermuxResultParser.mapRunFailure("Termux is not installed.")
    }
    if (!hasRunCommandPermission()) {
      return TermuxResultParser.RunCompletion(
        null,
        "",
        "",
        "TERMUX_PERMISSION_DENIED",
        "RUN_COMMAND permission was not granted.",
      )
    }

    val requestId = UUID.randomUUID().toString()
    val session = TermuxRunCommandSession.register(requestId)

    val pendingIntentFlags =
      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
        PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_MUTABLE
      } else {
        PendingIntent.FLAG_UPDATE_CURRENT
      }

    val callbackIntent =
      Intent(context, TermuxRunCommandResultReceiver::class.java).apply {
        data = Uri.parse("skid-termux://result/$requestId")
        putExtra(TermuxRunCommandSession.EXTRA_REQUEST_ID, requestId)
      }

    val pendingIntent =
      PendingIntent.getBroadcast(
        context,
        requestId.hashCode(),
        callbackIntent,
        pendingIntentFlags,
      )

    val intent =
      Intent().apply {
        setClassName(TermuxConstants.TERMUX_PACKAGE, TermuxConstants.RUN_COMMAND_SERVICE)
        action = TermuxConstants.ACTION_RUN_COMMAND
        putExtra(TermuxConstants.EXTRA_COMMAND_PATH, commandPath)
        putExtra(TermuxConstants.EXTRA_COMMAND_ARGUMENTS, arguments)
        putExtra(TermuxConstants.EXTRA_COMMAND_BACKGROUND, true)
        // Termux may otherwise include stdin (Framework credentials) in debug logs.
        putExtra(TermuxConstants.EXTRA_COMMAND_BACKGROUND_CUSTOM_LOG_LEVEL, "0")
        if (stdin != null) putExtra("com.termux.RUN_COMMAND_STDIN", stdin)
        putExtra(TermuxConstants.EXTRA_COMMAND_SESSION_ACTION, "0")
        putExtra(TermuxConstants.EXTRA_COMMAND_PENDING_INTENT, pendingIntent)
        if (!workdir.isNullOrBlank()) {
          putExtra(TermuxConstants.EXTRA_COMMAND_WORKDIR, workdir)
        }
      }

    return try {
      context.startService(intent)
      TermuxRunCommandSession.await(session, timeoutMs.coerceIn(1_000L, 240_000L))
    } catch (error: Exception) {
      TermuxRunCommandSession.completeSession(
        requestId,
        TermuxResultParser.mapRunFailure(error.message ?: "Termux RUN_COMMAND failed."),
      )
      TermuxResultParser.mapRunFailure(error.message ?: "Termux RUN_COMMAND failed.")
    } finally {
      TermuxRunCommandSession.remove(requestId)
      pendingIntent.cancel()
    }
  }

  internal fun parseResultIntent(data: Intent): TermuxResultParser.RunCompletion {
    val bundle = data.getBundleExtra(TermuxConstants.EXTRA_RESULT)
      ?: return TermuxResultParser.RunCompletion(null, "", "", "PARSER_FAILED", "Termux result bundle is missing.")
    if (bundle.getInt("err", -1) != -1) {
      return TermuxResultParser.mapRunFailure(bundle.getString("errmsg") ?: "Termux command failed.")
    }
    if (!bundle.containsKey("exitCode")) {
      return TermuxResultParser.RunCompletion(null, "", "", "PARSER_FAILED", "Termux exit code is missing.")
    }
    val stdout = bundle.getString("stdout") ?: ""
    val stderr = bundle.getString("stderr") ?: ""
    for ((key, value) in listOf("stdout" to stdout, "stderr" to stderr)) {
      val original = bundle.getString("${key}_original_length")?.toLongOrNull()
      if (original != null && original > value.length) {
        return TermuxResultParser.RunCompletion(null, "", "", "PARSER_FAILED", "Termux response was truncated.")
      }
    }
    return TermuxResultParser.RunCompletion(bundle.getInt("exitCode"), stdout, stderr, null, null)
  }
}

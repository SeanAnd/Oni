package expo.modules.termux

import android.content.Intent
import android.net.Uri
import android.provider.Settings
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.functions.Coroutine
import expo.modules.kotlin.modules.ModuleDefinition
import expo.modules.kotlin.records.Field
import expo.modules.kotlin.records.Record
import org.json.JSONArray
import org.json.JSONObject

class StructuredCommandRecord : Record {
  @Field var binary: String = ""
  @Field var args: List<String> = emptyList()
  @Field var cwd: String? = null
}

class RunStructuredJobOptions : Record {
  @Field var jobId: String = ""
  @Field var projectId: String = ""
  @Field var timeoutMs: Long = TermuxConstants.DEFAULT_TIMEOUT_MS
  @Field var command: StructuredCommandRecord = StructuredCommandRecord()
}

class TermuxModule : Module() {
  private val helperClient by lazy { TermuxHelperHttpClient() }

  override fun definition() = ModuleDefinition {
    Name("SkidTermux")

    AsyncFunction("getTermuxStatus") {
      val context = appContext.reactContext
      if (context == null) {
        return@AsyncFunction statusMap(
          installed = false,
          permissionGranted = false,
          "CAPABILITY_UNAVAILABLE",
          "React context unavailable.",
        )
      }
      val client = TermuxRunCommandClient(context)
      val installed = client.isTermuxInstalled()
      val permissionGranted = installed && client.hasRunCommandPermission()
      val errorKey =
        when {
          !installed -> "TERMUX_NOT_INSTALLED"
          !permissionGranted -> "TERMUX_PERMISSION_DENIED"
          else -> null
        }
      val detail =
        when {
          !installed -> "Install Termux and enable allow-external-apps before pairing."
          !permissionGranted -> "Grant RUN_COMMAND in Oni's Android app permissions."
          else -> null
        }
      statusMap(installed, permissionGranted, errorKey, detail)
    }

    AsyncFunction("openTermuxAppSettings") {
      val context = appContext.reactContext ?: return@AsyncFunction false
      if (!TermuxRunCommandClient(context).isTermuxInstalled()) {
        return@AsyncFunction false
      }
      val intent =
        Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS).apply {
          data = Uri.parse("package:${context.packageName}")
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
      context.startActivity(intent)
      true
    }

    AsyncFunction("probeKaliSetup") Coroutine { ->
      TermuxIo.run {
        val context = appContext.reactContext
        if (context == null) "{\"ok\":false,\"errorKey\":\"CAPABILITY_UNAVAILABLE\"}"
        else {
          val result = TermuxRunCommandClient(context).runCommand("/data/data/com.termux/files/home/.rootless-workstation/bin/workstation-setup-probe", emptyArray(), "/data/data/com.termux/files/home", 40000)
          if (result.errorKey != null) JSONObject().put("ok", false).put("errorKey", result.errorKey).toString() else result.stdout
        }
      }
    }

    AsyncFunction("probeSetup") Coroutine { ->
      TermuxIo.run {
        val context = appContext.reactContext
        if (context == null) "{\"ok\":false,\"errorKey\":\"CAPABILITY_UNAVAILABLE\"}"
        else WorkstationPrerequisites(context).call("probe", "probe").toString()
      }
    }

    AsyncFunction("openTermux") {
      val context = appContext.reactContext ?: return@AsyncFunction false
      val intent = context.packageManager.getLaunchIntentForPackage("com.termux") ?: return@AsyncFunction false
      context.startActivity(intent.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK))
      true
    }

    AsyncFunction("runKaliHealth") Coroutine { timeoutMs: Long? ->
      TermuxIo.run {
        val context = appContext.reactContext
        if (context == null) {
          return@run healthMap(
            TermuxResultParser.HealthPayload(
              false,
              null,
              null,
              null,
              null,
              "CAPABILITY_UNAVAILABLE",
              "React context unavailable.",
            ),
          )
        }
        val client = TermuxRunCommandClient(context)
        val home = "/data/data/com.termux/files/home"
        val scriptPath = "$home/${TermuxConstants.WORKSTATION_HOME}/${TermuxConstants.HEALTH_SCRIPT}"
        val completion =
          client.runCommand(
            scriptPath,
            arrayOf("--json"),
            "$home/${TermuxConstants.WORKSTATION_HOME}",
            timeoutMs ?: TermuxConstants.DEFAULT_TIMEOUT_MS,
          )
        if (completion.errorKey != null) {
          return@run healthMap(
            TermuxResultParser.HealthPayload(
              false,
              null,
              null,
              null,
              null,
              completion.errorKey,
              completion.detail,
            ),
          )
        }
        if (completion.exitCode != 0) {
          return@run healthMap(
            TermuxResultParser.HealthPayload(
              false,
              null,
              null,
              null,
              null,
              "NETHUNTER_NOT_FOUND",
              completion.stderr.ifBlank { "workstation-health exited with code ${completion.exitCode}" },
            ),
          )
        }
        healthMap(TermuxResultParser.parseHealthStdout(completion.stdout))
      }
    }

    AsyncFunction("runStructuredJob") Coroutine { options: RunStructuredJobOptions ->
      TermuxIo.run {
        val context = appContext.reactContext
        if (context == null) {
          return@run jobEnvelope(
            options.jobId,
            false,
            null,
            "CAPABILITY_UNAVAILABLE",
            "React context unavailable.",
          )
        }
        val idError =
          TermuxResultParser.validateId(options.jobId, TermuxConstants.MAX_JOB_ID_LENGTH, "jobId")
            ?: TermuxResultParser.validateId(options.projectId, TermuxConstants.MAX_JOB_ID_LENGTH, "projectId")
        if (idError != null) {
          return@run jobEnvelope(options.jobId, false, null, "INVALID_PAYLOAD", idError)
        }
        if (options.command.binary.isBlank() || options.command.args.any { it.contains('\u0000') }) {
          return@run jobEnvelope(
            options.jobId,
            false,
            null,
            "INVALID_PAYLOAD",
            "Structured command is invalid.",
          )
        }

        val home = "/data/data/com.termux/files/home"
        val runScript = "$home/${TermuxConstants.WORKSTATION_HOME}/${TermuxConstants.RUN_SCRIPT}"
        val request =
          JSONObject()
            .put("jobId", options.jobId)
            .put("projectId", options.projectId)
            .put("operationId", options.jobId)
            .put("timeoutMs", options.timeoutMs)
            .put(
              "command",
              JSONObject()
                .put("binary", options.command.binary)
                .put("args", JSONArray(options.command.args))
                .put("cwd", options.command.cwd ?: JSONObject.NULL),
            )
        val client = TermuxRunCommandClient(context)
        val completion =
          client.runCommand(
            runScript,
            arrayOf("--request-json", request.toString()),
            "$home/${TermuxConstants.WORKSTATION_HOME}",
            options.timeoutMs + 10_000L,
          )
        if (completion.errorKey != null) {
          return@run jobEnvelope(options.jobId, false, null, completion.errorKey, completion.detail)
        }
        if (completion.exitCode != 0) {
          return@run jobEnvelope(
            options.jobId,
            false,
            completion.exitCode,
            "KALI_COMMAND_NOT_FOUND",
            completion.stderr.ifBlank { "workstation-run failed." },
          )
        }
        parseJobStdout(options.jobId, completion.stdout, completion.exitCode)
      }
    }

    AsyncFunction("getHelperJobStatus") Coroutine { jobId: String, operationId: String, helperToken: String ->
      TermuxIo.run {
        helperMap(helperClient.getJobStatus(helperToken, jobId, operationId))
      }
    }

    AsyncFunction("cancelHelperJob") Coroutine { jobId: String, operationId: String, helperToken: String ->
      TermuxIo.run {
        helperMap(helperClient.cancelJob(helperToken, jobId, operationId))
      }
    }

    AsyncFunction("readHelperArtifactChunk") Coroutine {
      artifactId: String,
      offset: Double,
      limit: Int,
      operationId: String,
      helperToken: String ->
      TermuxIo.run {
        helperMap(
          helperClient.readArtifactChunk(
            helperToken,
            artifactId,
            offset.toLong(),
            limit,
            operationId,
          ),
        )
      }
    }

    AsyncFunction("getBootstrapInstallCommand") {
      mapOf(
        "command" to BOOTSTRAP_INSTALL_COMMAND,
        "manifestVersion" to "1.3.1",
        "workstationHome" to "~/${TermuxConstants.WORKSTATION_HOME}",
      )
    }

    AsyncFunction("checkProfileSwitch") Coroutine { ->
      TermuxIo.run { runWorkstationScript("bin/workstation-profile-check", emptyArray(), 15_000L) }
    }
    AsyncFunction("databaseOperation") Coroutine { requestJson: String ->
      TermuxIo.run { runWorkstationScript("bin/workstation-db", arrayOf("--request-stdin"), 190_000L, requestJson) }
    }
    AsyncFunction("prepareDatabaseCredential") Coroutine { requestJson: String ->
      TermuxIo.run { runWorkstationScript("bin/workstation-credentials", emptyArray(), 15_000L, requestJson) }
    }
    AsyncFunction("installWorkstationBundle") Coroutine { helperToken: String ->
      TermuxIo.run { WorkstationBootstrap(appContext.reactContext).install(helperToken) }
    }
    AsyncFunction("startWorkstationHelper") Coroutine { helperToken: String ->
      TermuxIo.run { runWorkstationScript("bin/workstation-helper-start", emptyArray(), 20_000L, JSONObject().put("token", helperToken).toString()) }
    }

    AsyncFunction("configureMetasploitDatabase") Coroutine { requestJson: String ->
      require(JSONObject(requestJson).optString("profileId", "termux-local") == "termux-local")
      TermuxIo.run {
        runWorkstationScript(
          TermuxConstants.MSF_CONFIG_SCRIPT,
          arrayOf("--request-stdin"),
          TermuxConstants.DEFAULT_TIMEOUT_MS,
          requestJson,
        )
      }
    }

    AsyncFunction("verifyMetasploitDatabase") Coroutine { profileId: String ->
      require(profileId == "termux-local")
      TermuxIo.run {
        runWorkstationScript(
          TermuxConstants.MSF_VERIFY_SCRIPT,
          arrayOf("--json", "--profile", profileId),
          TermuxConstants.DEFAULT_TIMEOUT_MS,
        )
      }
    }

    AsyncFunction("launchMetasploitConsole") { profileId: String ->
      require(profileId == "termux-local")
      val context = appContext.reactContext ?: return@AsyncFunction scriptEnvelope(false, "CAPABILITY_UNAVAILABLE", null)
      val client = TermuxRunCommandClient(context)
      if (!client.isTermuxInstalled() || !client.hasRunCommandPermission()) return@AsyncFunction scriptEnvelope(false, "TERMUX_PERMISSION_DENIED", null)
      try {
        val intent = Intent().apply {
          setClassName(TermuxConstants.TERMUX_PACKAGE, TermuxConstants.RUN_COMMAND_SERVICE)
          action = TermuxConstants.ACTION_RUN_COMMAND
          putExtra(TermuxConstants.EXTRA_COMMAND_PATH, "/data/data/com.termux/files/usr/bin/python3")
          putExtra(TermuxConstants.EXTRA_COMMAND_ARGUMENTS, arrayOf("/data/data/com.termux/files/home/${TermuxConstants.WORKSTATION_HOME}/${TermuxConstants.MSF_CONSOLE_LAUNCH_SCRIPT}", "--profile", profileId))
          putExtra(TermuxConstants.EXTRA_COMMAND_BACKGROUND, false)
          putExtra(TermuxConstants.EXTRA_COMMAND_SESSION_ACTION, "0")
        }
        context.startService(intent)
        // Android can suppress the service's background activity launch even
        // though Oni's user-initiated foreground action may open Termux itself.
        context.packageManager.getLaunchIntentForPackage(TermuxConstants.TERMUX_PACKAGE)?.let { launch ->
          launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
          context.startActivity(launch)
        }
        mapOf("ok" to true, "launchAcknowledged" to true, "detail" to "Foreground Termux session requested. Check Termux for startup errors.")
      } catch (_: Exception) { scriptEnvelope(false, "METASPLOIT_UNAVAILABLE", "Unable to request foreground console.") }
    }
  }

  private fun runWorkstationScript(
    relativeScript: String,
    arguments: Array<String>,
    timeoutMs: Long,
    stdin: String? = null,
  ): Map<String, Any?> {
    val context = appContext.reactContext
    if (context == null) {
      return scriptEnvelope(false, "CAPABILITY_UNAVAILABLE", "React context unavailable.")
    }
    val home = "/data/data/com.termux/files/home"
    val scriptPath = "$home/${TermuxConstants.WORKSTATION_HOME}/$relativeScript"
    val client = TermuxRunCommandClient(context)
    val completion =
      client.runCommand(
        scriptPath,
        arguments,
        "$home/${TermuxConstants.WORKSTATION_HOME}",
        timeoutMs,
        stdin,
      )
    if (completion.errorKey != null) {
      return scriptEnvelope(false, completion.errorKey, completion.detail)
    }
    // A nonzero exit still carries the backend's structured remediation envelope.
    return TermuxResultParser.parseScriptStdout(completion.stdout, completion.exitCode) + mapOf("payload" to completion.stdout.trim())
  }

  private fun scriptEnvelope(ok: Boolean, errorKey: String?, detail: String?): Map<String, Any?> =
    mapOf(
      "ok" to ok,
      "errorKey" to errorKey,
      "detail" to detail,
      "connected" to false,
      "schemaReady" to false,
      "launchAcknowledged" to false,
    )

  private fun statusMap(
    installed: Boolean,
    permissionGranted: Boolean,
    errorKey: String?,
    detail: String?,
  ): Map<String, Any?> =
    mapOf(
      "installed" to installed,
      "permissionGranted" to permissionGranted,
      "errorKey" to errorKey,
      "detail" to detail,
    )

  private fun healthMap(payload: TermuxResultParser.HealthPayload): Map<String, Any?> =
    mapOf(
      "ok" to payload.ok,
      "arch" to payload.arch,
      "kaliRelease" to payload.kaliRelease,
      "nhPath" to payload.nhPath,
      "helperVersion" to payload.helperVersion,
      "errorKey" to payload.errorKey,
      "detail" to payload.detail,
    )

  private fun jobEnvelope(
    jobId: String,
    ok: Boolean,
    exitCode: Int?,
    errorKey: String?,
    detail: String?,
  ): Map<String, Any?> =
    mapOf(
      "jobId" to jobId,
      "ok" to ok,
      "exitCode" to exitCode,
      "artifactIds" to emptyList<String>(),
      "observationsPending" to false,
      "errorKey" to errorKey,
      "detail" to detail,
    )

  private fun parseJobStdout(jobId: String, stdout: String, fallbackExit: Int?): Map<String, Any?> {
    return try {
      val json = JSONObject(stdout.trim())
      mapOf(
        "jobId" to jobId,
        "ok" to json.optBoolean("ok", false),
        "exitCode" to if (json.has("exitCode")) json.getInt("exitCode") else fallbackExit,
        "artifactIds" to jsonArrayToList(json.optJSONArray("artifactIds")),
        "observationsPending" to json.optBoolean("observationsPending", false),
        "errorKey" to TermuxResultParser.nullableField(json, "errorKey"),
        "detail" to TermuxResultParser.nullableField(json, "detail"),
      )
    } catch (_: Exception) {
      jobEnvelope(jobId, false, fallbackExit, "PARSER_FAILED", "workstation-run returned malformed JSON.")
    }
  }

  private fun helperMap(response: TermuxHelperHttpClient.HelperResponse): Map<String, Any?> =
    mapOf(
      "ok" to response.ok,
      "errorKey" to response.errorKey,
      "detail" to response.detail,
      "payload" to response.payload?.toString(),
    )

  private fun jsonArrayToList(array: JSONArray?): List<String> {
    if (array == null) {
      return emptyList()
    }
    return buildList {
      for (index in 0 until array.length()) {
        add(array.optString(index))
      }
    }
  }

  companion object {
    /** User-run once in Termux after copying `software/backend/bootstrap/` onto the device. */
    const val BOOTSTRAP_INSTALL_COMMAND =
      "bash ~/skid-backend/bootstrap/install-termux.sh"
  }
}

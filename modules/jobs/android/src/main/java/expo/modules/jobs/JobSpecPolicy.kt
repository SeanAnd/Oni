package expo.modules.jobs

import expo.modules.termux.TermuxResultParser
import org.json.JSONObject

/** Reject unsupported native entry points even if the JS caller bypasses its resolver. */
internal object JobSpecPolicy {
  fun validate(spec: JSONObject) {
    for (field in listOf("id", "projectId")) require(TermuxResultParser.validateId(spec.getString(field), 128, field) == null)
    val type = spec.getString("type")
    val provider = spec.getString("providerId")
    val capability = spec.getString("capabilityId")
    val timeout = spec.optLong("timeoutMs", 120_000)
    require(timeout in 15_000..(if (type.startsWith("setup.")) 7_200_000 else 180_000))
    when (type) {
      "setup.python", "setup.nethunter" -> {
        require(provider == "provider.termux.setup" && capability == "workstation.setup")
        require(spec.isNull("command"))
        val parameters = spec.getJSONObject("parameters")
        require(parameters.keys().asSequence().toSet() == setOf("catalogId"))
        require(parameters.getString("catalogId") == "kali-2026.2-minimal-arm64-v1")
      }
      "nmap.scan" -> {
        require(provider == "provider.kali.nmap" && capability == "network.service_detection")
        val command = spec.getJSONObject("command")
        require(command.getString("binary") == "nmap" && command.isNull("cwd"))
        require(command.getJSONArray("args").length() in 9..10)
      }
      JobLedgerStore.KALI_HEALTH_JOB_TYPE -> require(provider == "provider.kali.health" && capability == "workstation.health")
      "metasploit.prepare" -> {
        require(provider == "provider.kali.metasploit" && capability == "metasploit.database")
        val parameters = spec.getJSONObject("parameters")
        require(parameters.keys().asSequence().toSet() == setOf("profileId"))
        require(parameters.getString("profileId") == "termux-local")
        require(spec.isNull("command"))
      }
      "database.install", "database.initialize", "database.start", "database.stop", "database.backup", "database.restore", "database.rollback" -> {
        require(provider == "provider.termux.postgresql" && capability == "metasploit.database")
        require(spec.isNull("command"))
        val parameters = spec.getJSONObject("parameters")
        require(parameters.keys().asSequence().toSet().all { it in setOf("operation", "profileId", "backupId", "confirmReplace", "rollbackId", "databaseOperationId") })
        require(parameters.getString("profileId") == "termux-local")
        if (parameters.has("databaseOperationId")) require(TermuxResultParser.validateId(parameters.getString("databaseOperationId"), 128, "databaseOperationId") == null)
        require(type == "database." + parameters.getString("operation"))
        if (type == "database.rollback") {
          require(parameters.optBoolean("confirmReplace", false))
          require(Regex("[a-f0-9]{16}").matches(parameters.getString("rollbackId")))
        }
        if (type == "database.restore") {
          require(parameters.optBoolean("confirmReplace", false))
          require(TermuxResultParser.validateId(parameters.getString("backupId"), 128, "backupId") == null)
        }
      }
      else -> error("Unsupported job type")
    }
  }
}

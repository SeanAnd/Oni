package expo.modules.termux

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import org.json.JSONObject

class TermuxResultParserTest {
  @Test fun scriptFailurePreservesBackendRemediationOnNonzeroExit() {
    val result = TermuxResultParser.parseScriptStdout("""{"ok":false,"errorKey":"DATABASE_UNAVAILABLE","detail":"Start the device database and check its saved credential."}""", 1)
    assertEquals(false, result["ok"])
    assertEquals("DATABASE_UNAVAILABLE", result["errorKey"])
    assertEquals("Start the device database and check its saved credential.", result["detail"])
    assertEquals(false, result["connected"])
  }

  @Test fun nonzeroExitCannotClaimScriptSuccessOrReadiness() {
    val result = TermuxResultParser.parseScriptStdout("""{"ok":true,"connected":true,"schemaReady":true,"configured":true,"errorKey":null}""", 1)
    assertEquals(false, result["ok"])
    assertEquals(false, result["connected"])
    assertEquals(false, result["schemaReady"])
    assertEquals(false, result["configured"])
    assertEquals("METASPLOIT_UNAVAILABLE", result["errorKey"])
  }

  @Test fun successfulScriptPreservesReadinessAndNullErrors() {
    val result = TermuxResultParser.parseScriptStdout("""{"ok":true,"connected":true,"schemaReady":true,"errorKey":null}""", 0)
    assertEquals(true, result["ok"])
    assertEquals(true, result["connected"])
    assertEquals(true, result["schemaReady"])
    assertNull(result["errorKey"])
  }

  @Test fun malformedScriptOutputIsNotExposedToTheUi() {
    val result = TermuxResultParser.parseScriptStdout("private diagnostic fixture", 1)
    assertEquals("PARSER_FAILED", result["errorKey"])
    assertFalse(result.toString().contains("private diagnostic fixture"))
  }

  @Test
  fun nullableFields_doNotCoerceJsonNullOrOtherTypesIntoErrors() {
    val payload = JSONObject("""{"errorKey":null,"detail":"","count":3,"flag":false,"object":{}}""")
    for (key in listOf("errorKey", "detail", "missing", "count", "flag", "object")) {
      assertNull(TermuxResultParser.nullableField(payload, key))
    }
    assertEquals("JOB_FAILED", TermuxResultParser.nullableField(JSONObject("""{"errorKey":"JOB_FAILED"}"""), "errorKey"))
  }

  @Test
  fun parseHealthStdout_nullFailureFieldsUseStableDefaults() {
    val payload = TermuxResultParser.parseHealthStdout("""{"ok":false,"errorKey":null,"detail":null,"arch":null}""")
    assertNull(payload.arch)
    assertEquals("NETHUNTER_NOT_FOUND", payload.errorKey)
    assertEquals("NetHunter health check failed.", payload.detail)
  }

  @Test
  fun mapRunFailure_permissionUsesStableKey() {
    val result = TermuxResultParser.mapRunFailure("RUN_COMMAND permission denied")
    assertEquals("TERMUX_PERMISSION_DENIED", result.errorKey)
  }

  @Test
  fun mapRunFailure_missingTermuxUsesStableKey() {
    val result = TermuxResultParser.mapRunFailure("Termux is not installed")
    assertEquals("TERMUX_NOT_INSTALLED", result.errorKey)
  }

  @Test
  fun parseHealthStdout_successEnvelope() {
    val payload =
      TermuxResultParser.parseHealthStdout(
        "{\"ok\":true,\"arch\":\"aarch64\",\"helperVersion\":\"1.0.0\"}",
      )
    assertTrue(payload.ok)
    assertEquals("aarch64", payload.arch)
    assertEquals("1.0.0", payload.helperVersion)
    assertNull(payload.errorKey)
  }

  @Test
  fun parseHealthStdout_malformedJson() {
    val payload = TermuxResultParser.parseHealthStdout("not-json")
    assertFalse(payload.ok)
    assertEquals("PARSER_FAILED", payload.errorKey)
  }

  @Test
  fun validateId_rejectsInvalidCharacters() {
    val issue = TermuxResultParser.validateId("../etc/passwd", 128, "jobId")
    assertTrue(issue?.contains("invalid") == true)
  }
}

package expo.modules.termux

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Before
import org.junit.Test
import org.junit.runner.RunWith

/** Requires real Termux + Python + the reviewed backend bundle on the target. */
@RunWith(AndroidJUnit4::class)
class TermuxDeviceAcceptanceTest {
  private val context = InstrumentationRegistry.getInstrumentation().targetContext
  private val client = TermuxRunCommandClient(context)
  private val home = "/data/data/com.termux/files/home"
  private val fixture = "$home/skid-backend/tests/fixtures/termux_ipc_probe.py"

  @Before fun prerequisites() {
    assertTrue("Install and initialize the official Termux APK first", client.isTermuxInstalled())
    assertTrue("Grant RUN_COMMAND to the instrumentation target", client.hasRunCommandPermission())
  }

  @Test fun actualPendingIntentPreservesArgumentsAndStdin() {
    val argument = "quotes \" spaces ; literal dollar \$"
    val input = "IPC fixture input\nsecond line"
    val result = client.runCommand(fixture, arrayOf("echo", argument), home, 15_000, input)
    assertNull(result.detail, result.errorKey)
    assertEquals(0, result.exitCode)
    val payload = JSONObject(result.stdout)
    assertEquals(argument, payload.getString("argument"))
    // Termux 0.118.3 appends a newline to EXTRA_STDIN. Production requests are
    // JSON envelopes so this transport whitespace cannot alter a credential.
    assertEquals("$input\n", payload.getString("stdin"))
  }

  @Test fun actualPendingIntentPreservesNonzeroExitAndSeparateStreams() {
    val result = client.runCommand(fixture, arrayOf("failure"), home, 15_000)
    assertNull(result.detail, result.errorKey)
    assertEquals(7, result.exitCode)
    assertEquals("fixture stdout", result.stdout.trim())
    assertEquals("fixture stderr", result.stderr.trim())
  }

  @Test fun lateCallbackCannotCompleteTheNextRequest() {
    assertEquals("JOB_TIMEOUT", client.runCommand(fixture, arrayOf("delay"), home, 1_000).errorKey)
    val result = client.runCommand(fixture, arrayOf("echo", "next-request"), home, 15_000, "next-input")
    assertNull(result.detail, result.errorKey)
    assertEquals("next-request", JSONObject(result.stdout).getString("argument"))
  }

  @Test fun installedBackendReturnsAnHonestKaliHealthEnvelope() {
    val result = client.runCommand("$home/.rootless-workstation/bin/workstation-health", arrayOf("--json"), home, 70_000)
    assertNull(result.detail, result.errorKey)
    val health = TermuxResultParser.parseHealthStdout(result.stdout)
    if (health.ok) {
      assertEquals(0, result.exitCode)
      assertNotNull(health.kaliRelease)
    } else {
      assertEquals(1, result.exitCode)
      assertEquals("NETHUNTER_NOT_FOUND", health.errorKey)
    }
  }
}

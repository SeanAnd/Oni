package expo.modules.termux

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class MsfdbDeviceAcceptanceTest {
  private val instrumentation = InstrumentationRegistry.getInstrumentation()
  private val client = TermuxRunCommandClient(instrumentation.targetContext)
  private fun run(mode: String, timeout: Long = 180000) {
    val source = instrumentation.context.assets.open("msfdb_device_acceptance.py").bufferedReader().use { it.readText() }
    val result = client.runCommand("/data/data/com.termux/files/usr/bin/python3", arrayOf("-c", source, mode), "/data/data/com.termux/files/home", timeout)
    assertNull("Termux transport failed", result.errorKey)
    assertEquals("Acceptance failed: " + result.stdout.take(2000), 0, result.exitCode)
    val response = JSONObject(result.stdout)
    assertTrue(response.toString(), response.getBoolean("ok"))
    android.util.Log.i("OniMsfdbAcceptance", response.toString())
  }
  @Test fun configureManagedDefaultAndVerifyIdentity() = run("configure")
  @Test fun stockFrameworkDatabaseParity() = run("parity")
  @Test fun kaliLifecycleCommandsUseManagedTermuxDatabase() = run("cli", 180000)

  @Test fun isolatedResetAndFileRestore() = runIsolated("maintenance")
  @Test fun isolatedFrameworkUpgradeAndRestore() = runIsolated("upgrade")

  private fun runIsolated(mode: String) {
    val source = instrumentation.context.assets.open("msfdb_isolated_device.py").bufferedReader().use { it.readText() }
    val identity = java.util.UUID.randomUUID().toString().replace("-", "")
    val launcher = """
import json,pathlib,subprocess,sys,os
root=pathlib.Path.home()/'.rootless-workstation/acceptance'
root.mkdir(mode=0o700,exist_ok=True)
name=sys.argv[1]
request=json.load(sys.stdin)
assert request['mode'] in ['maintenance','upgrade']
source=root/(name+'.py');source.write_text(request['source']);source.chmod(0o600)
with (root/(name+'.json')).open('w') as output:
 subprocess.Popen([sys.executable,str(source)],stdout=output,stderr=subprocess.DEVNULL,start_new_session=True,env={**os.environ,'ONI_ISOLATED_MODE':request['mode']})
print(json.dumps({'ok':True}))
""".trimIndent()
    val started = client.runCommand("/data/data/com.termux/files/usr/bin/python3", arrayOf("-c", launcher, identity), "/data/data/com.termux/files/home", 15000, JSONObject().put("source", source).put("mode", mode).toString())
    assertEquals("Unable to start isolated acceptance", 0, started.exitCode)
    val reader = """
import json,pathlib,sys
p=pathlib.Path.home()/'.rootless-workstation/acceptance'/(sys.argv[1]+'.json')
try: print(json.dumps(json.loads(p.read_text())))
except ValueError: print(json.dumps({'pending':True}))
""".trimIndent()
    val deadline = android.os.SystemClock.elapsedRealtime() + 620000
    while (android.os.SystemClock.elapsedRealtime() < deadline) {
      Thread.sleep(2000)
      val polled = client.runCommand("/data/data/com.termux/files/usr/bin/python3", arrayOf("-c", reader, identity), "/data/data/com.termux/files/home", 15000)
      assertEquals("Unable to read isolated acceptance", 0, polled.exitCode)
      val result = JSONObject(polled.stdout)
      if (result.optBoolean("pending")) continue
      android.util.Log.i("OniMsfdbAcceptance", result.toString())
      assertTrue(result.toString(), result.optBoolean("ok"))
      assertTrue(result.toString(), result.optBoolean("productionUnchanged"))
      assertTrue(result.toString(), result.optBoolean("isolatedStopped"))
      return
    }
    fail("Isolated acceptance timed out; inspect its private result before repeating")
  }
}

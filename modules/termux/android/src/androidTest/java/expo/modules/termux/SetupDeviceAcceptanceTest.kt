package expo.modules.termux

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

/** Existing-device preservation: never removes Python/Kali or resets a database. */
@RunWith(AndroidJUnit4::class)
class SetupDeviceAcceptanceTest {
  private val context = InstrumentationRegistry.getInstrumentation().targetContext
  @Test fun realBashBootstrapReusesInstalledPython() {
    val bootstrap = WorkstationPrerequisites(context)
    val before = bootstrap.call("probe", "probe")
    assertTrue(before.toString(), before.getBoolean("ok"))
    assertTrue("This is the existing-device reuse fixture", before.getBoolean("pythonReady"))
    val id = "acceptance-python-" + java.util.UUID.randomUUID().toString()
    bootstrap.call("start", id)
    var result = JSONObject()
    for (attempt in 0..30) {
      result = bootstrap.call("status", id)
      if (result.optString("status") != "running") break
      Thread.sleep(500)
    }
    assertEquals(result.toString(), "completed", result.optString("status"))
    assertEquals("completed", bootstrap.call("start", id).optString("status"))
    android.util.Log.i("OniSetupAcceptance", "Existing Python bootstrap and replay passed")
  }

  @Test fun isolatedFreshKaliInstallation() {
    val instrumentation = InstrumentationRegistry.getInstrumentation()
    val source = instrumentation.context.assets.open("setup_fresh_kali.py").bufferedReader().use { it.readText() }
    val id = "setup-fresh-" + java.util.UUID.randomUUID().toString()
    val client = TermuxRunCommandClient(context)
    val launcher = """
import pathlib,sys,subprocess,json
root=pathlib.Path.home()/'.rootless-workstation/acceptance'
root.mkdir(mode=0o700,exist_ok=True)
p=root/(sys.argv[1]+'.py');p.write_text(sys.stdin.read());p.chmod(0o600)
with (root/(sys.argv[1]+'.json')).open('w') as result:
 subprocess.Popen([sys.executable,str(p)],stdout=result,stderr=subprocess.DEVNULL,start_new_session=True)
print(json.dumps({'ok':True}))
""".trimIndent()
    val start = client.runCommand("/data/data/com.termux/files/usr/bin/python3", arrayOf("-c", launcher, id), "/data/data/com.termux/files/home", 15000, source)
    assertEquals(0, start.exitCode)
    val reader = """
import json,pathlib,sys
p=pathlib.Path.home()/'.rootless-workstation/acceptance'/(sys.argv[1]+'.json')
try:print(json.dumps(json.loads(p.read_text())))
except ValueError:print(json.dumps({'pending':True}))
""".trimIndent()
    val until = android.os.SystemClock.elapsedRealtime() + 7250000
    while (android.os.SystemClock.elapsedRealtime() < until) {
      Thread.sleep(3000)
      val output = client.runCommand("/data/data/com.termux/files/usr/bin/python3", arrayOf("-c", reader, id), "/data/data/com.termux/files/home", 15000)
      assertEquals(0, output.exitCode)
      val result = JSONObject(output.stdout)
      if (result.optBoolean("pending")) continue
      android.util.Log.i("OniSetupAcceptance", result.toString())
      assertTrue(result.toString(), result.getBoolean("ok"))
      assertTrue(result.getBoolean("productionUnchanged"))
      return
    }
    fail("The isolated installation is still unresolved; inspect its retained fixture before retrying")
  }

  @Test fun kaliSetupReusesExistingInstallationAndDatabase() {
    val script = """
import hashlib,json,sys,uuid
from pathlib import Path
sys.path.insert(0,str(Path.home()/'.rootless-workstation/bin'))
import workstation_common as common
from workstation_database import ManagedDatabase
from workstation_jobs import execute
from workstation_setup import catalog
launcher=common.resolve_nh_path()
assert launcher is not None
before=hashlib.sha256(launcher.read_bytes()).hexdigest()
db=ManagedDatabase()
with db.lock():
 db.start()
 db.verify_identity()
 oid=db.psql("SELECT oid FROM pg_database WHERE datname='msf';",admin=True,database='postgres')
identity='setup-acceptance-'+uuid.uuid4().hex
result=execute(dict(jobId=identity,projectId='system-onboarding',operationId=identity,timeoutMs=180000,task=dict(type='setup.nethunter',catalogId=catalog()['id'])))
assert result['status']=='completed',result.get('errorKey')
assert hashlib.sha256(launcher.read_bytes()).hexdigest()==before
with db.lock():
 db.verify_identity()
 assert db.psql("SELECT oid FROM pg_database WHERE datname='msf';",admin=True,database='postgres')==oid
 assert db.health()['authenticatedQueryOk']
print(json.dumps(dict(ok=True,launcherPreserved=True,databasePreserved=True,helperVersion=common.HELPER_VERSION)))
""".trimIndent()
    val result = TermuxRunCommandClient(context).runCommand("/data/data/com.termux/files/usr/bin/python3", arrayOf("-c", script), "/data/data/com.termux/files/home", 180000)
    assertNull(result.errorKey)
    assertEquals((result.stdout + result.stderr).take(2000), 0, result.exitCode)
    assertTrue(JSONObject(result.stdout).getBoolean("ok"))
    android.util.Log.i("OniSetupAcceptance", result.stdout)
  }
}

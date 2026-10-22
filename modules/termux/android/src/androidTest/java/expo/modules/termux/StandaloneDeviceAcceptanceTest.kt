package expo.modules.termux

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class StandaloneDeviceAcceptanceTest {
  private val context = InstrumentationRegistry.getInstrumentation().targetContext
  private val client = TermuxRunCommandClient(context)
  private val home = "/data/data/com.termux/files/home"

  @Test fun diagnoseManagedDatabaseConnectionWithoutSecrets() {
    val code = """
import json,pathlib,sys
sys.path.insert(0,str(pathlib.Path.home()/'.rootless-workstation/bin'))
from workstation_database import ManagedDatabase
db=ManagedDatabase()
patterns=['connection refused','password authentication failed','no password supplied','does not exist','not accepting connections','starting up','recovery mode','Permission denied','No such file or directory','Function not implemented','Invalid argument','No space left','could not map','could not open','could not access','shared memory','invalid checkpoint','database system is ready']
with db.lock():
 results=[]
 for role,database,secret in [('msf','msf','msf.secret'),('skid_admin','postgres','admin.secret')]:
  r=db.run('psql',['-X','-w','-h','127.0.0.1','-p','5432','-U',role,'-d',database,'-At'],sql='SELECT 1;',env={'PGPASSWORD':(db.root/secret).read_text().strip()},check=False)
  results.append(dict(role=role,exitCode=r.returncode,categories=[p for p in patterns if p.lower() in r.stderr.lower()]))
 log=(db.root/'postgres.log').read_text(errors='replace')[-12000:]
 settings={k:db.run('postgres',['-D',db.data,'-C',k],check=False).stdout.strip() for k in ['dynamic_shared_memory_type','shared_memory_type']}
 print(json.dumps(dict(running=db.running(),settings=settings,queries=results,recentLogCategories=[p for p in patterns if p.lower() in log.lower()])))
""".trimIndent()
    val result = client.runCommand("/data/data/com.termux/files/usr/bin/python3", arrayOf("-c", code), home, 30000)
    assertNull(result.detail, result.errorKey)
    assertEquals("Read-only database diagnostic failed", 0, result.exitCode)
    android.util.Log.i("SkidDatabaseDiagnostic", result.stdout)
  }

  @Test fun readOnlyDeviceInventoryThroughRunCommand() {
    val code = """
import json,os,pathlib,shutil,subprocess,socket
home=pathlib.Path.home()
def command(args):
 try:
  p=subprocess.run(args,capture_output=True,text=True,timeout=15)
  return p.stdout.strip()[:1500]
 except (OSError,subprocess.TimeoutExpired): return None
print(json.dumps(dict(uid=os.getuid(),prefix=os.environ.get('PREFIX'),arch=command(['uname','-m']),postgres=shutil.which('postgres'),candidate=command(['apt-cache','policy','postgresql']),freeBytes=shutil.disk_usage(home).free,clusters={str(p):p.exists() for p in [home/'.postgres',home/'.rootless-workstation/postgres',pathlib.Path(os.environ.get('PREFIX','/data/data/com.termux/files/usr'))/'var/lib/postgresql']},helperInstalled=(home/'.rootless-workstation/bin/workstation-helper').exists(),paired=(home/'.rootless-workstation/state/helper_token').exists())))
""".trimIndent()
    val result = client.runCommand("/data/data/com.termux/files/usr/bin/python3", arrayOf("-c", code), home, 30_000)
    assertNull(result.detail, result.errorKey)
    assertEquals(result.stderr.take(1000), 0, result.exitCode)
    val payload = JSONObject(result.stdout)
    assertEquals("aarch64", payload.getString("arch"))
    android.util.Log.i("SkidStandaloneInventory", payload.toString())
  }
  @Test fun diagnosePostgresqlPackageDependencies() {
    val code = """
import subprocess,json
p=subprocess.run(['apt-get','-s','install','postgresql'],capture_output=True,text=True,timeout=30)
print(json.dumps(dict(exitCode=p.returncode,diagnostic=(p.stdout+p.stderr)[-6000:])))
""".trimIndent()
    val result = client.runCommand("/data/data/com.termux/files/usr/bin/python3", arrayOf("-c", code), home, 40000)
    assertNull(result.detail, result.errorKey)
    assertEquals(result.stderr.take(1000), 0, result.exitCode)
    android.util.Log.i("SkidStandalonePackage", result.stdout)
  }

  @Test fun installPostgresqlPackageDiagnostic() {
    val code = """
import subprocess,json,os,signal
p=subprocess.Popen(['pkg','install','-y','postgresql'],stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True,start_new_session=True)
try: output=p.communicate(timeout=150)[0]
except subprocess.TimeoutExpired:
 os.killpg(p.pid,signal.SIGKILL)
 output=p.communicate()[0]
print(json.dumps(dict(exitCode=p.returncode,diagnostic=output[-8000:])))
""".trimIndent()
    val result = client.runCommand("/data/data/com.termux/files/usr/bin/python3", arrayOf("-c", code), home, 165000)
    assertNull(result.detail, result.errorKey)
    assertEquals(result.stderr.take(1000), 0, result.exitCode)
    android.util.Log.i("SkidStandalonePackage", result.stdout)
  }

  @Test fun installAndStartRealHelperThroughRunCommand() {
    val tokenResult = client.runCommand("/data/data/com.termux/files/usr/bin/python3", arrayOf("-c", "import pathlib; print((pathlib.Path.home()/'.rootless-workstation/state/helper_token').read_text().strip())"), home, 15000)
    assertNull(tokenResult.detail, tokenResult.errorKey)
    assertEquals("Existing helper pairing must be preserved", 0, tokenResult.exitCode)
    val token = tokenResult.stdout.trim()
    assertTrue("Expected existing private pairing", token.length >= 32)
    val installed = WorkstationBootstrap(context).install(token)
    assertEquals(installed["detail"]?.toString(), true, installed["ok"])
    val started = client.runCommand("$home/.rootless-workstation/bin/workstation-helper-start", emptyArray(), home, 20000, JSONObject().put("token", token).toString())
    assertNull(started.detail, started.errorKey)
    assertEquals(started.stdout, true, JSONObject(started.stdout).optBoolean("ok"))
    android.util.Log.i("SkidStandaloneAcceptance", "Verified helper installed and started via normal RUN_COMMAND")
  }

  @Test fun startOwnedLoopbackScanTarget() {
    val code = """
import json,pathlib,subprocess,sys,socket,os,time
root=pathlib.Path.home()/'.rootless-workstation/acceptance'
root.mkdir(mode=0o700,exist_ok=True)
program="import http.server,threading; s=http.server.HTTPServer(('127.0.0.1',38080),type('Handler',(http.server.BaseHTTPRequestHandler,),{'do_GET':lambda self:(self.send_response(200),self.end_headers(),self.wfile.write(b'SKID owned acceptance target')),'log_message':lambda *args:None})); threading.Timer(7200,s.shutdown).start(); s.serve_forever(); s.server_close()"
with socket.socket() as probe: probe.bind(('127.0.0.1',38080))
p=subprocess.Popen([sys.executable,'-c',program],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
(root/'target.json').write_text(json.dumps(dict(pid=p.pid,program=program)))
for _ in range(40):
 try:
  with socket.create_connection(('127.0.0.1',38080),timeout=.2): break
 except OSError: time.sleep(.1)
else: raise RuntimeError('Owned target did not start')
print(json.dumps(dict(ok=True,pid=p.pid,endpoint='127.0.0.1:38080')))
""".trimIndent()
    val result = client.runCommand("/data/data/com.termux/files/usr/bin/python3", arrayOf("-c", code), home, 15000)
    assertNull(result.detail, result.errorKey)
    assertEquals(result.stderr.take(1000), 0, result.exitCode)
    android.util.Log.i("SkidStandaloneAcceptance", result.stdout)
  }

  @Test fun managedDatabaseBackupRestoreRollbackAndRestart() {
    val code = """
import json,pathlib,sys,uuid,shutil
sys.path.insert(0,str(pathlib.Path.home()/'.rootless-workstation/bin'))
from workstation_database import ManagedDatabase
db=ManagedDatabase()
def invoke(operation,**kwargs):
 r=db.invoke(dict(profileId='termux-local',operationId='acceptance-'+uuid.uuid4().hex,operation=operation,**kwargs))
 assert r['ok'],r
 return r
with db.lock():
 db.psql('CREATE TABLE skid_acceptance_marker(value integer); INSERT INTO skid_acceptance_marker VALUES(1);')
backup=invoke('backup')
with db.lock(): db.psql('UPDATE skid_acceptance_marker SET value=2;')
restored=invoke('restore',backupId=backup['backupId'],confirmReplace=True)
with db.lock(): assert db.psql('SELECT value FROM skid_acceptance_marker;')=='1'
rolled=invoke('rollback',rollbackId=restored['rollbackId'],confirmReplace=True)
with db.lock(): assert db.psql('SELECT value FROM skid_acceptance_marker;')=='2'
bad='acceptance-corrupt-'+uuid.uuid4().hex
shutil.copy(db.backups/(backup['backupId']+'.json'),db.backups/(bad+'.json'))
(db.backups/(bad+'.dump')).write_bytes(b'corrupt')
try:
 rejected=db.invoke(dict(profileId='termux-local',operationId='acceptance-'+uuid.uuid4().hex,operation='restore',backupId=bad,confirmReplace=True))
 assert rejected['errorKey']=='ARTIFACT_INTEGRITY_FAILED',rejected
finally:
 (db.backups/(bad+'.json')).unlink()
 (db.backups/(bad+'.dump')).unlink()
wrong=db.invoke(dict(profileId='termux-local',operationId='acceptance-'+uuid.uuid4().hex,operation='health',password='x'*64))
assert wrong['errorKey']=='DATABASE_CREDENTIALS_INVALID',wrong
invoke('stop')
invoke('start')
with db.lock():
 assert db.psql('SELECT value FROM skid_acceptance_marker;')=='2'
 db.psql('DROP TABLE skid_acceptance_marker;')
print(json.dumps(dict(ok=True,backup=backup,restored=restored,rolledBack=rolled,corruptionRejected=True,wrongCredentialRejected=True,restartPreservedData=True)))
""".trimIndent()
    val result = client.runCommand("/data/data/com.termux/files/usr/bin/python3", arrayOf("-c", code), home, 230000)
    assertNull(result.detail, result.errorKey)
    assertEquals(result.stderr.take(1500), 0, result.exitCode)
    android.util.Log.i("SkidStandaloneAcceptance", result.stdout)
  }

  @Test fun supervisedHealthCancellationAndWorkerRecovery() {
    val code = """
import json,os,pathlib,subprocess,sys,tempfile,time,signal
scripts=pathlib.Path.home()/'.rootless-workstation/bin'
sys.path.insert(0,str(scripts))
import workstation_common as common,workstation_jobs as jobs
with tempfile.TemporaryDirectory(prefix='skid-health-') as temporary:
 root=pathlib.Path(temporary)
 launcher=root/'nh'
 launcher.write_text('#!/data/data/com.termux/files/usr/bin/sh\nsleep 60\n')
 launcher.chmod(0o700)
 common.rebind_workstation_home(root)
 def run(name):
  request=dict(jobId=name,projectId='system-onboarding',operationId=name+'-op',timeoutMs=15000,task=dict(type='kali.health'))
  process=subprocess.Popen([sys.executable,str(scripts/'workstation-run'),'--request-json',json.dumps(request)],env={**os.environ,'SKID_WORKSTATION_HOME':temporary,'NH_PATH':str(launcher)},stdout=subprocess.PIPE,text=True)
  for _ in range(100):
   state=jobs.read_state(name)
   if state and state.get('processIdentity'): return process,state
   time.sleep(.05)
  raise RuntimeError('Health worker did not start')
 p,state=run('cancel-health')
 result=jobs.cancel_job('cancel-health','cancel-health-op')
 assert result['status']=='cancelled',result
 assert jobs.process_identity(state['processPid']) is None
 p.communicate(timeout=5)
 p,state=run('killed-health')
 p.kill()
 p.communicate(timeout=5)
 result=jobs.load_job('killed-health','killed-health-op')
 assert result['status']=='failed',result
 for _ in range(50):
  if jobs.process_identity(state['processPid']) is None: break
  time.sleep(.1)
 assert jobs.process_identity(state['processPid']) is None
 p,state=run('deadline-health')
 p.communicate(timeout=22)
 result=jobs.load_job('deadline-health','deadline-health-op')
 assert result['status']=='failed' and result['errorKey']=='JOB_TIMEOUT',result
 assert jobs.process_identity(state['processPid']) is None
print(json.dumps(dict(ok=True,cancellation=True,workerRecovery=True,deadlineCleanup=True)))
""".trimIndent()
    val result = client.runCommand("/data/data/com.termux/files/usr/bin/python3", arrayOf("-c", code), home, 45000)
    assertNull(result.detail, result.errorKey)
    assertEquals(result.stderr.take(1500), 0, result.exitCode)
    android.util.Log.i("SkidStandaloneAcceptance", result.stdout)
  }

  @Test fun supervisedDatabaseBackup() {
    val id = "acceptance-backup-" + java.util.UUID.randomUUID().toString()
    val request = JSONObject().put("jobId", id).put("projectId", "system-onboarding").put("operationId", id).put("timeoutMs", 180000).put("task", JSONObject().put("type", "database").put("operation", "backup").put("profileId", "termux-local"))
    val result = client.runCommand("$home/.rootless-workstation/bin/workstation-run", arrayOf("--request-json", request.toString()), home, 190000)
    assertNull(result.detail, result.errorKey)
    assertEquals(result.stderr.take(2000), 0, result.exitCode)
    val payload = JSONObject(result.stdout)
    assertEquals(result.stdout, "completed", payload.getString("status"))
    assertEquals(1, payload.getJSONArray("artifactIds").length())
    android.util.Log.i("SkidStandaloneAcceptance", result.stdout)
  }

  @Test fun ownedDatabaseCrashAndHelperRecovery() {
    val code = """
import json,os,pathlib,signal,subprocess,sys,time
root=pathlib.Path.home()/'.rootless-workstation'
sys.path.insert(0,str(root/'bin'))
from workstation_database import ManagedDatabase,DatabaseError
from workstation_jobs import process_identity
db=ManagedDatabase()
with db.lock():
 assert db.running()
 db.psql('CREATE TABLE skid_crash_acceptance(value integer); INSERT INTO skid_crash_acceptance VALUES(42);')
 pid=int((db.data/'postmaster.pid').read_text().splitlines()[0])
 identity=process_identity(pid)
 assert identity and process_identity(pid)==identity
 os.kill(pid,signal.SIGKILL)
 for _ in range(40):
  if process_identity(pid) is None: break
  time.sleep(.1)
 for _ in range(20):
  try:
   db.start()
   break
  except DatabaseError as error:
   if error.key!='DATABASE_PORT_CONFLICT': raise
   time.sleep(.5)
 else: raise RuntimeError('Managed database could not recover')
 assert db.psql('SELECT value FROM skid_crash_acceptance;')=='42'
 db.psql('DROP TABLE skid_crash_acceptance;')
 assert db.health()['authenticatedQueryOk']
owned=[]
for entry in pathlib.Path('/proc').iterdir():
 if not entry.name.isdecimal(): continue
 try:
  argv=(entry/'cmdline').read_bytes().split(b'\0')
  if entry.stat().st_uid==os.getuid() and str(root/'bin/workstation-helper').encode() in argv:
   helper_pid=int(entry.name)
   identity=process_identity(helper_pid)
   if identity and process_identity(helper_pid)==identity:
    owned.append((helper_pid,identity))
 except (OSError,ValueError): pass
assert len(owned)==1, 'Expected exactly one owned production helper'
for helper_pid,identity in owned:
 assert process_identity(helper_pid)==identity
 os.kill(helper_pid,signal.SIGTERM)
 for _ in range(50):
  if process_identity(helper_pid)!=identity: break
  time.sleep(.1)
 assert process_identity(helper_pid)!=identity
r=subprocess.run([sys.executable,str(root/'bin/workstation-helper-start')],input=json.dumps(dict(token=(root/'state/helper_token').read_text().strip())),text=True,capture_output=True,timeout=20)
assert json.loads(r.stdout)['ok'], 'Authenticated helper restart failed'
print(json.dumps(dict(ok=True,postgresCrashRecovery=True,committedDataPreserved=True,ownedHelperRecovery=True)))
""".trimIndent()
    val result = client.runCommand("/data/data/com.termux/files/usr/bin/python3", arrayOf("-c", code), home, 60000)
    assertNull(result.detail, result.errorKey)
    assertEquals(result.stderr.take(1500), 0, result.exitCode)
    android.util.Log.i("SkidStandaloneAcceptance", result.stdout)
  }

  @Test fun startDeviceLocalIdleTrial() {
    val program = InstrumentationRegistry.getInstrumentation().context.assets.open("standalone_idle_probe.py").bufferedReader().use { it.readText() }
    val code = """
import json,pathlib,subprocess,sys
root=pathlib.Path.home()/'.rootless-workstation/acceptance'
root.mkdir(mode=0o700,exist_ok=True)
script=root/'idle-probe.py'
script.write_text(sys.stdin.read())
script.chmod(0o600)
p=subprocess.Popen([sys.executable,str(script)],stdin=subprocess.DEVNULL,stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,start_new_session=True)
print(json.dumps(dict(ok=True,pid=p.pid,durationSeconds=7200)))
""".trimIndent()
    val result = client.runCommand("/data/data/com.termux/files/usr/bin/python3", arrayOf("-c", code), home, 15000, program)
    assertNull(result.detail, result.errorKey)
    assertEquals(result.stderr.take(1000), 0, result.exitCode)
    android.util.Log.i("SkidStandaloneAcceptance", result.stdout)
  }

  @Test fun readDeviceLocalIdleTrial() {
    val code = """
import json,pathlib
root=pathlib.Path.home()/'.rootless-workstation/acceptance'
samples=[json.loads(line) for line in (root/'idle-trial.jsonl').read_text().splitlines()]
print(json.dumps(dict(samples=len(samples),wallElapsedSeconds=samples[-1]['wallTime']-samples[0]['wallTime'],first=samples[0],last=samples[-1],failures=[s for s in samples if not s.get('databaseOk') or not s.get('helperOk')],milestones=[s for s in samples if s.get('scanHash')],sampleTimes=[dict(elapsed=s['elapsedSeconds'],wall=s['wallTime']) for s in samples])))
""".trimIndent()
    val result = client.runCommand("/data/data/com.termux/files/usr/bin/python3", arrayOf("-c", code), home, 15000)
    assertNull(result.detail, result.errorKey)
    assertEquals(result.stderr.take(1000), 0, result.exitCode)
    android.util.Log.i("SkidStandaloneIdle", result.stdout)
  }

  @Test fun verifyRetainedAcceptanceArtifactHashes() {
    val code = """
import hashlib,json,pathlib
root=pathlib.Path.home()/'.rootless-workstation/artifacts'
results=[]
project_id=json.loads((root/'111e799d-7339-4a2a-b0da-5d70ab7c4edc.json').read_text())['projectId']
artifact_ids={'111e799d-7339-4a2a-b0da-5d70ab7c4edc','49f1c4ce-2806-4639-a86f-4c66cb0c8a34','309d268f-f7a6-484c-ba7e-396aff05a0c1'}
for metadata_path in root.glob('*.json'):
 if json.loads(metadata_path.read_text()).get('projectId')==project_id:
  artifact_ids.add(metadata_path.stem)
for artifact_id in sorted(artifact_ids):
 metadata=json.loads((root/(artifact_id+'.json')).read_text())
 path=root/(artifact_id+'.log')
 with path.open('rb') as stream: digest=hashlib.file_digest(stream,'sha256').hexdigest()
 assert digest==metadata['sha256'] and path.stat().st_size==metadata['size']
 results.append(dict(artifactId=artifact_id,jobId=metadata['jobId'],sha256=digest,size=metadata['size']))
print(json.dumps(results))
""".trimIndent()
    val result = client.runCommand("/data/data/com.termux/files/usr/bin/python3", arrayOf("-c", code), home, 15000)
    assertNull(result.detail, result.errorKey)
    assertEquals(result.stderr.take(1000), 0, result.exitCode)
    android.util.Log.i("SkidStandaloneArtifacts", result.stdout)
  }

  @Test fun stopOwnedAcceptanceTarget() {
    val code = """
import json,os,pathlib,signal,sys
root=pathlib.Path.home()/'.rootless-workstation'
sys.path.insert(0,str(root/'bin'))
from workstation_jobs import process_identity
state=json.loads((root/'acceptance/target.json').read_text())
pid=state['pid']
entry=pathlib.Path('/proc')/str(pid)
if entry.exists():
 argv=(entry/'cmdline').read_bytes().split(b'\0')
 assert entry.stat().st_uid==os.getuid() and state['program'].encode() in argv
 identity=process_identity(pid)
 assert identity and process_identity(pid)==identity
 os.kill(pid,signal.SIGTERM)
print(json.dumps(dict(ok=True,ownedTargetStopped=True)))
""".trimIndent()
    val result = client.runCommand("/data/data/com.termux/files/usr/bin/python3", arrayOf("-c", code), home, 15000)
    assertNull(result.detail, result.errorKey)
    assertEquals(result.stderr.take(1000), 0, result.exitCode)
    android.util.Log.i("SkidStandaloneAcceptance", result.stdout)
  }

  @Test fun verifyManagedLocalDatabaseAndFramework() {
    val code = """
import json,pathlib,sys
sys.path.insert(0,str(pathlib.Path.home()/'.rootless-workstation/bin'))
from workstation_database import ManagedDatabase
with ManagedDatabase().lock():
 db=ManagedDatabase()
 print(json.dumps(dict(health=db.health(),owner=db.owner(),role=db.psql("SELECT rolsuper OR rolcreatedb OR rolcreaterole FROM pg_roles WHERE rolname='msf';"),endpoint=db.psql("SELECT host(inet_server_addr()) || ':' || inet_server_port()::text;"))))
""".trimIndent()
    val checked = client.runCommand("/data/data/com.termux/files/usr/bin/python3", arrayOf("-c", code), home, 30000)
    assertNull(checked.detail, checked.errorKey)
    assertEquals(checked.stderr.take(1000), 0, checked.exitCode)
    val payload = JSONObject(checked.stdout)
    assertTrue(payload.getJSONObject("health").getBoolean("authenticatedQueryOk"))
    assertEquals("127.0.0.1:5432", payload.getString("endpoint"))
    assertEquals("f", payload.getString("role"))
    android.util.Log.i("SkidStandaloneAcceptance", payload.toString())
    val framework = client.runCommand("$home/.rootless-workstation/bin/workstation-msf-verify", arrayOf("--json", "--profile", "termux-local"), home, 130000)
    assertNull(framework.detail, framework.errorKey)
    val verified = JSONObject(framework.stdout)
    assertTrue(framework.stdout, verified.optBoolean("ok") && verified.optBoolean("connected") && verified.optBoolean("schemaReady"))
    android.util.Log.i("SkidStandaloneAcceptance", "Framework APIs verified against termux-local")
  }

}

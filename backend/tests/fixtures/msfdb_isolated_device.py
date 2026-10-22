"""Real Pixel maintenance acceptance on an isolated cluster, config and credentials.

Only copied test scripts have the fixed PostgreSQL port changed to 55432. No
production endpoint/configuration or request contract is changed by this fixture.
Invoke through normal Termux RUN_COMMAND, never Android run-as for lifecycle.
"""
import fcntl
import json
import os
from pathlib import Path
import re
import shutil
import shlex
import subprocess
import sys
import uuid

ORIGINAL = Path.home() / '.rootless-workstation'
sys.path.insert(0, str(ORIGINAL / 'bin'))
import workstation_common as common
from workstation_database import ManagedDatabase

WORKER = r'''
import hashlib,json,os,secrets,sys
from pathlib import Path
sys.path.insert(0,str(Path(os.environ['SKID_WORKSTATION_HOME'])/'bin'))
import workstation_common as common
from workstation_database import ManagedDatabase
from workstation_msfdb import configure,verify
from workstation_msfdb_maintenance import maintenance

def console(body):
 resource="<ruby>\nrequire 'json'\nbegin\n"+body+"\nputs 'ONI_ISOLATED:'+{ok:true,frameworkVersion:Msf::Framework::Version}.to_json\nrescue StandardError => e\nputs 'ONI_ISOLATED:'+{ok:false,category:e.class.name,stage:(e.message =~ /\\A[a-z]+\\z/ ? e.message : 'framework_api')}.to_json\nend\n</ruby>\nexit -y\n"
 options=['--defer-module-loads'] if os.environ.get('ONI_ACCEPTANCE_UPGRADE')=='1' else []
 result=common.run_kali('msfconsole',['-q',*options,'-r','/dev/stdin'],input=resource,timeout=180)
 marker=next((line.split(':',1)[1] for line in result.stdout.splitlines() if line.startswith('ONI_ISOLATED:')),None)
 payload=json.loads(marker) if marker else {'ok':False,'stage':'no_marker'}
 if result.returncode or not payload.get('ok'): raise RuntimeError(json.dumps(payload))
 return payload

db=ManagedDatabase()
stage='initialize'
result={'ok':False}
try:
 response=db.invoke(dict(profileId='termux-local',operation='initialize',operationId='initialize',password=secrets.token_hex(32)))
 assert response['ok'],response.get('errorKey')
 stage='configure'
 configure(db)
 stage='seed'
 console("""
cfg=ApplicationRecord.connection_db_config.configuration_hash
raise 'identity' unless cfg[:port].to_i==55432 && cfg[:database]=='msf'
framework.db.workspace=framework.db.add_workspace('oni_isolated_acceptance')
h=framework.db.report_host(host:'127.0.0.1',name:'retained-before-reset')
framework.db.report_service(host:h,port:28765,proto:'tcp',name:'fixture')
path=File.join(Msf::Config.loot_directory,'oni-fixture.txt')
::FileUtils.mkdir_p(File.dirname(path));File.binwrite(path,'Oni private fixture bytes')
framework.db.report_loot(host:h,type:'oni.fixture',content_type:'text/plain',path:path,name:'fixture')
local=File.join(Msf::Config.local_directory,'oni-local.txt')
::FileUtils.mkdir_p(File.dirname(local));File.binwrite(local,'Oni local fixture bytes')
""")
 if os.environ.get('ONI_ISOLATED_MODE')=='upgrade':
  stage='old_version'
  old=console("raise 'version' unless Msf::Framework::Version.start_with?('6.4.135')")['frameworkVersion']
  with db.lock():backup=db.backup('before-framework-upgrade')
  stage='upgrade'
  os.environ['ONI_ACCEPTANCE_UPGRADE']='1'
  upgraded=console("raise 'version' unless Msf::Framework::Version.start_with?('6.5.3');raise 'records' unless framework.db.hosts(workspace:'oni_isolated_acceptance').first.name=='retained-before-reset'")['frameworkVersion']
  assert verify()['schemaReady']
  stage='restore_pre_upgrade'
  os.environ.pop('ONI_ACCEPTANCE_UPGRADE')
  restored=db.invoke(dict(profileId='termux-local',operation='restore',operationId='restore-pre-upgrade',backupId=backup['backupId'],confirmReplace=True))
  assert restored['ok'],restored.get('errorKey')
  restored_version=console("raise 'version' unless Msf::Framework::Version.start_with?('6.4.135');raise 'records' unless framework.db.hosts(workspace:'oni_isolated_acceptance').first.name=='retained-before-reset'")['frameworkVersion']
  result=dict(ok=True,realTermuxPostgresql=True,frameworkUpgrade=True,oldVersion=old,newVersion=upgraded,restoredVersion=restored_version,preUpgradeBackupRestored=True,port=55432)
 else:
  stage='prepare_reset'
  prepared=maintenance(db,dict(verb='prepare-reinit',operationId='prepare-reset'))
  stage='reset'
  reset=maintenance(db,dict(verb='reinit',operationId='reset',confirmationId=prepared['confirmationId']))
  stage='verify_fresh'
  console("raise 'fresh' if framework.db.find_workspace('oni_isolated_acceptance')")
  stage='rollback_reset'
  response=db.invoke(dict(profileId='termux-local',operation='rollback',operationId='rollback-reset',rollbackId=reset['rollbackId'],confirmReplace=True))
  assert response['ok'],response.get('errorKey')
  stage='verify_retained_and_files'
  console("""
 raise 'retained' unless framework.db.hosts(workspace:'oni_isolated_acceptance').first.name=='retained-before-reset'
 raise 'loot' unless framework.db.loots(workspace:'oni_isolated_acceptance').count==1
 raise 'bytes' unless File.binread(File.join(Msf::Config.loot_directory,'oni-fixture.txt'))=='Oni private fixture bytes'
 """)
  files_program="""import pathlib,json,hashlib,shutil,sys
 root=pathlib.Path.home()/'.msf4'
 backup=root/'oni-managed/file-backups'/sys.argv[1]
 manifest=json.loads((backup/'manifest.json').read_text())
 assert len(manifest)==2
 for entry in manifest:
  source=backup/entry['path'];target=root/entry['path']
  assert hashlib.sha256(source.read_bytes()).hexdigest()==entry['sha256']
  target.write_bytes(b'test corruption')
  shutil.copyfile(source,target)
  assert hashlib.sha256(target.read_bytes()).hexdigest()==entry['sha256']
 print(json.dumps({'ok':True}))
 """
  copied=common.run_kali('python3',['-c',files_program,prepared['confirmationId']],timeout=20)
  assert copied.returncode==0
  stage='prepare_delete'
  prepared_delete=maintenance(db,dict(verb='prepare-delete',operationId='prepare-delete'))
  stage='deactivate'
  deleted=maintenance(db,dict(verb='delete',operationId='delete',confirmationId=prepared_delete['confirmationId']))
  with db.lock():assert db.psql("SELECT count(*) FROM pg_database WHERE datname='msf';",admin=True,database='postgres')=='0'
  stage='rollback_delete'
  response=db.invoke(dict(profileId='termux-local',operation='rollback',operationId='rollback-delete',rollbackId=deleted['rollbackId'],confirmReplace=True))
  assert response['ok'],response.get('errorKey')
  stage='final_framework'
  assert verify()['schemaReady']
  result=dict(ok=True,realTermuxPostgresql=True,realFrameworkStaging=True,reset=True,deactivate=True,rollback=True,fileBackupRestore=True,port=55432)
except Exception as error:
 result=dict(ok=False,stage=stage,category=type(error).__name__,errorKey=getattr(error,'key',None))
 if isinstance(error,RuntimeError):
  try:result['framework']=json.loads(str(error))
  except ValueError:pass
finally:
 try:
  stopped=db.invoke(dict(profileId='termux-local',operation='stop',operationId='stop'))
  result['isolatedStopped']=stopped['ok']
 except Exception:result['isolatedStopped']=False
print(json.dumps(result))
'''


def main():
    # This lock coordinates disposable tests; production lifecycle remains online.
    with (ORIGINAL / 'state/msfdb-acceptance.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        production = ManagedDatabase()
        with production.lock():
            production.verify_identity()
            before = production.psql("SELECT oid FROM pg_database WHERE datname='msf';", admin=True, database='postgres')
        identity = uuid.uuid4().hex[:12]
        root = Path.home() / ('.oni-msfdb-' + identity)
        kali_home = '/tmp/oni-msfdb-' + identity
        root.mkdir(mode=0o700)
        (root / 'bin').mkdir(mode=0o700)
        for source in (ORIGINAL / 'bin').resolve().iterdir():
            if source.is_file():
                data = source.read_bytes()
                # Transport substitution only, restricted to disposable copies.
                if source.name in {'workstation_database.py', 'workstation_msf_config.py', 'workstation-msf-config', 'workstation-msf-verify', 'workstation_common.py'}:
                    data = re.sub(rb'(?<![0-9])5432(?![0-9])', b'55432', data)
                destination = root / 'bin' / source.name
                destination.write_bytes(data)
                destination.chmod(0o700 if data.startswith(b'#!') else 0o600)
        launcher = common.resolve_nh_path()
        setup = common.run_kali('python3', ['-c', 'from pathlib import Path;Path(' + repr(kali_home) + ').mkdir(mode=0o700)'], timeout=15)
        assert setup.returncode == 0
        shim = root / 'nh'
        shim.write_text('#!' + sys.executable + '\nimport os,shlex,sys\nenvironment=' + repr(['HOME='+kali_home,'MSF_CFGROOT_CONFIG='+kali_home+'/.msf4']) + '\nif os.environ.get("ONI_ACCEPTANCE_UPGRADE")=="1":environment.append(' + repr('PATH='+kali_home+'/upgrade-bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin') + ')\nos.execv(' + repr(str(launcher)) + ',[' + repr(str(launcher)) + ',shlex.join(["env",*environment,"bash","-c",sys.argv[1]])])\n')
        if os.environ.get('ONI_ISOLATED_MODE') == 'upgrade':
            framework = '/tmp/oni-msfdb-upgrade/usr/share/metasploit-framework'
            command = shlex.join(['env','BUNDLE_GEMFILE='+framework+'/Gemfile','GEM_PATH='+framework+'/vendor/bundle/ruby/3.3.0:/usr/share/rubygems-integration/all','/usr/bin/ruby',framework+'/msfconsole']) + ' "$@"'
            script = '#!/bin/sh\nexec ' + command + '\n'
            install = 'import pathlib;d=pathlib.Path('+repr(kali_home)+')/"upgrade-bin";d.mkdir(mode=0o700);p=d/"msfconsole";p.write_text('+repr(script)+');p.chmod(0o700)'
            assert common.run_kali('python3',['-c',install],timeout=15).returncode == 0
        shim.chmod(0o700)
        worker = root / 'acceptance.py'
        worker.write_text(WORKER)
        worker.chmod(0o600)
        environment = {**os.environ, 'SKID_WORKSTATION_HOME': str(root), 'NH_PATH': str(shim)}
        try:
            completed = subprocess.run([sys.executable, str(worker)], env=environment, capture_output=True, text=True, timeout=580)
            result = json.loads(completed.stdout) if completed.stdout.strip() else {'ok': False, 'stage': 'worker_no_result'}
        except subprocess.TimeoutExpired:
            result = {'ok': False, 'stage': 'worker_timeout'}
        with production.lock():
            production.verify_identity()
            after = production.psql("SELECT oid FROM pg_database WHERE datname='msf';", admin=True, database='postgres')
            result['productionUnchanged'] = before == after and production.health()['authenticatedQueryOk']
        if result.get('ok') and result.get('isolatedStopped') and result['productionUnchanged']:
            common.run_kali('python3', ['-c', 'import shutil;shutil.rmtree(' + repr(kali_home) + ')'], timeout=20)
            shutil.rmtree(root)
        else:
            result['retainedFixture'] = root.name
        print(json.dumps(result))
        return 0 if result.get('ok') and result.get('isolatedStopped') and result.get('productionUnchanged') else 1


if __name__ == '__main__':
    raise SystemExit(main())

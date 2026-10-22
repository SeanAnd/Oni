"""Supplemental Pixel acceptance in a disposable Framework config directory.

Run as Termux. No user config is rewritten; only synthetic workspaces are removed.
"""
import json
from pathlib import Path
import sys

sys.path.insert(0, str(Path.home() / '.rootless-workstation/bin'))
import workstation_common as common

KALI = r'''
import configparser,json,os,pathlib,shutil,subprocess,tempfile,uuid
root=pathlib.Path(tempfile.mkdtemp(prefix='oni-msfdb-acceptance-'))
name='oni_connection_'+uuid.uuid4().hex
config=pathlib.Path.home()/'.msf4/database.yml'
shutil.copyfile(config,root/'database.yml');(root/'database.yml').chmod(0o600)
environment={**os.environ,'MSF_CFGROOT_CONFIG':str(root)}
def console(body):
 resource="<ruby>\nrequire 'json'\nbegin\n"+body+"\nputs 'ONI_CONNECTION:'+{ok:true}.to_json\nrescue StandardError => e\nputs 'ONI_CONNECTION:'+{ok:false,category:e.class.name,stage:(e.message =~ /\\A[a-z]+\\z/ ? e.message : 'api')}.to_json\nend\n</ruby>\nexit -y\n"
 result=subprocess.run(['msfconsole','-q','-r','/dev/stdin'],input=resource,env=environment,text=True,capture_output=True,timeout=90)
 marker=next((line.split(':',1)[1] for line in result.stdout.splitlines() if line.startswith('ONI_CONNECTION:')),None)
 payload=json.loads(marker) if marker else {'ok':False,'stage':'no_marker'}
 if result.returncode or not payload['ok']: raise RuntimeError(json.dumps(payload))
identity="cfg=ApplicationRecord.connection_db_config.configuration_hash; raise 'identity' unless framework.db.active && cfg[:host]=='127.0.0.1' && cfg[:port].to_i==5432 && cfg[:database]=='msf' && cfg[:username]=='msf'\n"
try:
 console(identity+f"""
framework.db.workspace=framework.db.add_workspace('{name}')
framework.db.report_host(host:'127.0.0.1',name:'synthetic-before')
run_single('db_disconnect')
run_single('db_connect --name oni_acceptance --yaml '+File.join(Msf::Config.config_directory,'database.yml'))
run_single('db_save')
raise 'save' unless Msf::Config.load['framework/database']['default_db']=='oni_acceptance'
""")
 saved=(root/'config').read_bytes()
 namespace={{}}
 exec((pathlib.Path.home()/'.msf4/oni-managed/config.py').read_text(),namespace)
 assert namespace['default_matches'](saved,json.loads(config.read_text())['production'])
 console(identity+f"""
run_single('workspace {name}')
raise 'persistence' unless framework.db.hosts(workspace:'{name}').first.name=='synthetic-before'
framework.db.report_host(host:'127.0.0.1',name:'synthetic-after')
run_single('workspace -r {name} {name}_renamed')
raise 'rename' unless framework.db.find_workspace('{name}_renamed')
run_single('db_stats');run_single('certs');run_single('klist')
run_single('db_remove oni_acceptance')
raise 'remove' if Msf::Config.load['framework/database/oni_acceptance']
""")
 console(identity+f"""
raise 'update' unless framework.db.hosts(workspace:'{name}_renamed').first.name=='synthetic-after'
framework.db.workspace=framework.db.default_workspace
framework.db.delete_workspaces(ids:[framework.db.find_workspace('{name}_renamed').id])
raise 'delete' if framework.db.find_workspace('{name}_renamed')
""")
 print(json.dumps(dict(ok=True,savedDefault=True,savedDefaultGuard=True,consoleRestartPersistence=True,workspaceRename=True,recordUpdate=True,removeConnection=True,installedExtraCommands=['db_stats','certs','klist'])))
finally:
 shutil.rmtree(root)
'''.replace('namespace={{}}', 'namespace={}')

result = common.run_kali('python3', ['-c', KALI], timeout=280)
# Only the fixture's structured summary is allowed out of the transport.
if result.returncode:
    print(json.dumps({'ok': False, 'stage': 'supplemental', 'detail': result.stderr[-600:]}))
    raise SystemExit(1)
print(result.stdout.strip())

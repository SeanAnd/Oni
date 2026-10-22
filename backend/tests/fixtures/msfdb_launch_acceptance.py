"""Physical wrapper exec/argument forwarding and final managed launch guard."""
import json
from pathlib import Path
import sys
import uuid

sys.path.insert(0, str(Path.home() / '.rootless-workstation/bin'))
import workstation_common as common

resource = '''<ruby>
cfg=ApplicationRecord.connection_db_config.configuration_hash
puts 'ONI_RUN_IDENTITY' if framework.db.active && cfg[:host]=='127.0.0.1' && cfg[:port].to_i==5432 && cfg[:username]=='msf' && cfg[:database]=='msf'
</ruby>
exit -y
'''
result = common.run_kali('bash', ['-ic', 'msfdb run -- -r /dev/stdin'], input=resource, timeout=150)
assert result.returncode == 0 and 'ONI_RUN_IDENTITY' in result.stdout, 'Wrapper run identity'
operation = 'acceptance-' + uuid.uuid4().hex
for verb in ['status', 'poll']:
    response = common.run_kali('bash', ['-ic', 'msfdb ' + verb + ' --json --operation-id ' + operation], timeout=30)
    payload = json.loads(next(line for line in response.stdout.splitlines() if line.startswith('{')))
    assert response.returncode == 0 and payload.get('ok'), 'Operation replay'
guard = common.run_kali('python3', ['-c', '''import runpy,os,pathlib
runtime=runpy.run_path(str(pathlib.Path.home()/'.msf4/oni-managed/config.py'))
for variable in ['MSF_DATABASE_CONFIG','MSF_CFGROOT_CONFIG']:
 try: runtime['validate_launch'](environment={variable:'/tmp/another-framework'})
 except ValueError: continue
 raise AssertionError('Environment conflict was accepted')
print('ONI_GUARD_OK')
'''], timeout=15)
assert guard.returncode == 0 and 'ONI_GUARD_OK' in guard.stdout
print(json.dumps({'ok': True, 'msfdbRunIdentity': True, 'resourceArgumentForwarded': True, 'statusPollReplay': True, 'environmentGuard': True}))

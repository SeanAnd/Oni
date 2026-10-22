"""Physical acceptance using synthetic Framework records; print sanitized results only."""
import json
from pathlib import Path
import subprocess
import sys
import uuid

sys.path.insert(0, str(Path.home() / '.rootless-workstation/bin'))
import workstation_common as common
from workstation_database import ManagedDatabase
from workstation_msfdb import configure, verify

RESOURCE = r'''<ruby>
require 'json'
require 'fileutils'
require 'digest'
begin
  cfg = ApplicationRecord.connection_db_config.configuration_hash
  raise 'identity' unless framework.db.active && framework.db.driver == 'postgresql' && cfg[:host] == '127.0.0.1' && cfg[:port].to_i == 5432 && cfg[:database] == 'msf' && cfg[:username] == 'msf'
  name = 'oni_parity_' + Process.pid.to_s
  original = framework.db.workspace.name
  baseline = framework.db.workspaces.count
  workspace = framework.db.add_workspace(name)
  framework.db.workspace = workspace
  root = File.join(Msf::Config.config_directory, 'oni-managed', 'acceptance', name)
  ::FileUtils.mkdir_p(root, mode: 0700)
  host = framework.db.report_host(host: '127.0.0.1', name: 'oni-synthetic')
  framework.db.report_service(host: host, port: 38089, proto: 'tcp', name: 'oni-test')
  framework.db.report_note(host: host, type: 'oni.parity', data: 'synthetic')
  framework.db.report_vuln(host: host, name: 'Oni synthetic record', info: 'No vulnerability exercised', refs: [])
  run_single('creds add user:oni_synthetic password:synthetic_test_only')
  raise 'host' unless framework.db.hosts(workspace: name).count == 1
  raise 'service' unless framework.db.services(workspace: name).count == 1
  raise 'note' unless framework.db.notes(workspace: name).count == 1
  raise 'vuln' unless framework.db.vulns(workspace: name).count == 1
  raise 'creds' unless framework.db.creds(workspace: name).count >= 1
  loot_path = File.join(root, 'loot.txt')
  File.write(loot_path, 'Oni synthetic loot bytes')
  framework.db.report_loot(workspace: name, host: host, type: 'oni.test', content_type: 'text/plain', path: loot_path, name: 'fixture')
  raise 'loot' unless framework.db.loots(workspace: name).count == 1 && File.read(loot_path) == 'Oni synthetic loot bytes'
  run_single('db_nmap --unprivileged -sT -Pn -n -p 28765 127.0.0.1')
  raise 'nmap' unless framework.db.services(workspace: name).any? { |service| service.port == 28765 }
  export_path = File.join(root, 'export.xml')
  run_single('db_export -f xml ' + export_path)
  raise 'export' unless File.size?(export_path)
  copy_name = name + '_import'
  framework.db.workspace = framework.db.add_workspace(copy_name)
  run_single('db_import ' + export_path)
  raise 'import' unless framework.db.hosts(workspace: copy_name).count >= 1 && framework.db.services(workspace: copy_name).count >= 1
  run_single('workspace ' + name)
  run_single('hosts'); run_single('services'); run_single('notes'); run_single('vulns'); run_single('creds'); run_single('loot')
  run_single('db_status')
  run_single('db_disconnect')
  run_single('db_connect -y ' + File.join(Msf::Config.config_directory, 'database.yml'))
  raise 'reconnect' unless framework.db.active
  framework.db.workspace = framework.db.find_workspace(original) || framework.db.default_workspace
  framework.db.delete_workspaces(ids: [framework.db.find_workspace(name).id, framework.db.find_workspace(copy_name).id])
  raise 'cleanup' unless framework.db.workspaces.count == baseline
  ::FileUtils.remove_entry(root)
  puts 'ONI_PARITY:' + {ok: true, identity: true, hosts: true, services: true, notes: true, vulns: true, credentials: true, loot: true, nmap: true, exportImport: true, reconnect: true, cleanup: true}.to_json
rescue StandardError => e
  puts 'ONI_PARITY:' + {ok: false, category: e.class.name, method: (e.respond_to?(:name) ? e.name : nil), location: e.backtrace.first, stage: (e.message =~ /\A[a-z]+\z/ ? e.message : 'framework_api')}.to_json
end
</ruby>
exit -y
'''


def main(mode):
    db = ManagedDatabase()
    if mode == 'configure':
        with db.lock():
            db.start()
            backup = db.backup('msfdb-before-' + uuid.uuid4().hex)
            with common.framework_session_lock():
                configure(db)
            result = verify()
        print(json.dumps(dict(ok=True, backupId=backup['backupId'], **result)))
    elif mode == 'parity':
        # Deliberately omit -y: prove Framework's native default discovery.
        result = common.run_kali('msfconsole', ['-q', '-r', '/dev/stdin'], input=RESOURCE, timeout=165)
        marker = next((line.split('ONI_PARITY:', 1)[1] for line in result.stdout.splitlines() if line.startswith('ONI_PARITY:')), None)
        payload = json.loads(marker) if marker else {'ok': False, 'stage': 'no_marker'}
        print(json.dumps(payload))
        if result.returncode or not payload['ok']:
            raise SystemExit(1)
    elif mode == 'cli':
        results = []
        for verb in ['status', 'start', 'restart', 'check', 'init', 'status']:
            result = common.run_kali('bash', ['-ic', 'msfdb ' + verb + ' --json'], timeout=175)
            lines = [line for line in result.stdout.splitlines() if line.startswith('{')]
            response = json.loads(lines[-1]) if lines else {'ok': False}
            results.append(dict(verb=verb, ok=result.returncode == 0 and response.get('ok') is True))
            if not results[-1]['ok']:
                print(json.dumps(dict(ok=False, results=results, errorKey=response.get('errorKey'))))
                raise SystemExit(1)
        print(json.dumps(dict(ok=True, results=results)))
    else:
        raise ValueError('Unknown acceptance mode')


if __name__ == '__main__':
    main(sys.argv[1])

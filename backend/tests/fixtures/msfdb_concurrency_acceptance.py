"""Physical two-console visibility and reset refusal with a live stock console."""
import json
from pathlib import Path
import subprocess
import sys
import threading
import time
import urllib.request
import uuid

sys.path.insert(0, str(Path.home() / '.rootless-workstation/bin'))
import workstation_common as common

name = 'oni_concurrency_' + uuid.uuid4().hex
resource = f'''<ruby>
begin
framework.db.workspace=framework.db.add_workspace('{name}')
framework.db.report_host(host:'127.0.0.1',name:'oni-concurrent')
puts 'ONI_READY';STDOUT.flush
300.times do
  break if File.exist?('/tmp/{name}.stop')
  sleep 0.5
end
ensure
File.unlink('/tmp/{name}.stop') if File.exist?('/tmp/{name}.stop')
framework.db.workspace=framework.db.default_workspace
w=framework.db.find_workspace('{name}')
framework.db.delete_workspaces(ids:[w.id]) if w
end
</ruby>
exit -y
'''
process = subprocess.Popen(common.nh_argv('msfconsole', ['-q', '-r', '/dev/stdin']),
    stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True)
ready = threading.Event()
def drain():
    for line in process.stdout:
        if line.startswith('ONI_READY'):
            ready.set()
thread = threading.Thread(target=drain, daemon=True)
thread.start()
process.stdin.write(resource); process.stdin.close()
assert ready.wait(100), 'Console readiness failed'
try:
    # Go through the real Termux helper. Android run-as has different SELinux
    # process-inspection permissions and is not a lifecycle execution transport.
    token = (common.STATE_DIR / 'msfdb-token').read_text().strip()
    operation = 'acceptance-' + uuid.uuid4().hex
    payload = {'verb': 'prepare-reinit', 'operationId': operation}
    deadline = time.monotonic() + 30
    while True:
        request = urllib.request.Request('http://127.0.0.1:28765/v1/workstation/msfdb',
            data=json.dumps(payload).encode(), headers={'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json'})
        with urllib.request.build_opener(urllib.request.ProxyHandler({})).open(request, timeout=10) as response:
            result = json.load(response)
        if result.get('status') not in {'queued', 'starting', 'running'}:
            break
        assert time.monotonic() < deadline, 'Maintenance response timeout'
        time.sleep(.5)
        payload = {'verb': 'poll', 'operationId': operation}
    assert result.get('databaseResult', {}).get('errorKey') == 'DATABASE_BUSY', 'Expected active-session refusal'
    second = common.run_kali('msfconsole', ['-q', '-r', '/dev/stdin'], input=f'''<ruby>
puts 'ONI_VISIBLE' if framework.db.hosts(workspace:'{name}').first.name=='oni-concurrent'
</ruby>
exit -y
''', timeout=90)
    assert second.returncode == 0 and 'ONI_VISIBLE' in second.stdout
finally:
    common.run_kali('python3', ['-c', 'from pathlib import Path;Path("/tmp/' + name + '.stop").touch()'], timeout=15)
    process.wait(timeout=60)
    thread.join(timeout=2)
assert process.returncode == 0
print(json.dumps({'ok': True, 'concurrentConsoles': True, 'crossConsoleVisibility': True, 'activeSessionResetRejected': True}))

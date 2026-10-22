"""Device-local acceptance only. No wake lock, host connection, or service recovery."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import time
import urllib.request
import uuid

root = Path.home() / '.rootless-workstation'
sys.path.insert(0, str(root / 'bin'))
from workstation_database import ManagedDatabase
import workstation_common as common

# CLOCK_BOOTTIME includes Android suspend; monotonic only measured awake time.
# This observer does not wake Android: overdue probes run when it resumes and
# retain their actual elapsed time rather than pretending they ran on schedule.
def elapsed_clock():
    return time.clock_gettime(time.CLOCK_BOOTTIME)


started = elapsed_clock()
output = root / 'acceptance/idle-trial.jsonl'
if output.exists():
    output.rename(output.with_name('idle-trial-' + uuid.uuid4().hex + '.jsonl'))
milestones = set()
planned = 0
while True:
    time.sleep(max(0, min(120, started + planned - elapsed_clock())))
    elapsed = elapsed_clock() - started
    sample = dict(elapsedSeconds=round(elapsed, 3), plannedSeconds=planned, wallTime=time.time(), pid=os.getpid(), clock='CLOCK_BOOTTIME')
    try:
        db = ManagedDatabase()
        result = db.invoke(dict(profileId='termux-local', operation='health', operationId='idle-' + uuid.uuid4().hex))
        sample['databaseOk'] = result.get('ok') is True and result.get('authenticatedQueryOk') is True
        request = urllib.request.Request('http://127.0.0.1:28765/v1/workstation/identity', data=b'{}', headers={'Content-Type': 'application/json', 'Authorization': 'Bearer ' + common.read_helper_token()})
        with urllib.request.urlopen(request, timeout=5) as response:
            identity = json.loads(response.read(4096))
        sample['helperOk'] = identity.get('service') == 'skid-workstation'
        due = [point for point in (1800, 7200) if elapsed >= point and point not in milestones]
        if due:
            scan = common.run_kali('nmap', ['--unprivileged', '-sT', '-Pn', '-n', '-p', '5432', '-oX', '-', '127.0.0.1'], timeout=40)
            xml = scan.stdout.encode()
            path = root / 'acceptance' / f'idle-scan-{due[-1]}.xml'
            common.atomic_write(path, xml)
            sample.update(scanExit=scan.returncode, scanHash=hashlib.sha256(xml).hexdigest(), scanSize=len(xml), milestonesDue=due)
            milestones.update(due)
    except Exception as error:
        sample['errorType'] = type(error).__name__  # Never persist credential-bearing exceptions.
    with output.open('a') as stream:
        os.chmod(output, 0o600)
        stream.write(json.dumps(sample) + '\n')
        stream.flush()
        os.fsync(stream.fileno())
    if elapsed >= 7200:
        break
    planned = min(7200, (int(elapsed) // 120 + 1) * 120)

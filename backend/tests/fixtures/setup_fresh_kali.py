"""Actual ARM64 Kali install with private HOME/launchers, preserving production.

Uses existing Termux Python/PRoot. This is NOT a fresh Termux bootstrap claim.
Invoke only through normal Termux RUN_COMMAND. Failed fixture remains inspectable.
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import uuid

original_home = Path.home()
sys.path.insert(0, str(original_home / '.rootless-workstation/bin'))
import workstation_common as common
from workstation_database import ManagedDatabase
import workstation_setup as setup
from workstation_jobs import execute

db = ManagedDatabase()
with db.lock():
    db.start()
    db.verify_identity()
    before_oid = db.psql("SELECT oid FROM pg_database WHERE datname='msf';", admin=True, database='postgres')
original_launcher = common.resolve_nh_path()
assert original_launcher and shutil.which('proot')
before_hash = hashlib.sha256(original_launcher.read_bytes()).hexdigest()
fixture = original_home / ('.oni-setup-acceptance-' + uuid.uuid4().hex[:12])
fixture.mkdir(mode=0o700)
binaries = fixture / 'bin'
binaries.mkdir(mode=0o700)
os.environ['HOME'] = str(fixture)
common.rebind_workstation_home(fixture / '.rootless-workstation')
setup.ROOT = common.WORKSTATION_HOME / 'setup'
common.resolve_nh_path = lambda: binaries / 'nh' if (binaries / 'nh').is_file() else None
original_installer = setup.Installer
class IsolatedInstaller(original_installer):
    def __init__(self, request):
        super().__init__(request)
        self.launcher_directory = binaries
setup.Installer = IsolatedInstaller
identity = 'setup-fresh-' + uuid.uuid4().hex
result = execute(dict(jobId=identity, projectId='system-onboarding', operationId=identity, timeoutMs=7200000,
                      task=dict(type='setup.nethunter', catalogId=setup.CATALOG_ID)))
os.environ['HOME'] = str(original_home)
with db.lock():
    db.verify_identity()
    unchanged = before_oid == db.psql("SELECT oid FROM pg_database WHERE datname='msf';", admin=True, database='postgres') and db.health()['authenticatedQueryOk']
assert hashlib.sha256(original_launcher.read_bytes()).hexdigest() == before_hash
print(json.dumps(dict(ok=result['status']=='completed', errorKey=result.get('errorKey'), phase=result.get('setup',{}).get('phase'),
                      productionUnchanged=unchanged, fixture=fixture.name, realKaliPackages=True)))
# Retain the isolated tree for subsequent exact-source fixes and verification.

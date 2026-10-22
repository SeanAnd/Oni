"""Disposable real-PG policy integration; Framework verification is explicitly stubbed."""
import json
from pathlib import Path
import secrets
import subprocess
import sys
import uuid
sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
from workstation_database import ManagedDatabase

class FixtureDatabase(ManagedDatabase):
    def run(self, binary, args, **kwargs):
        if args and str(args[0]).endswith('workstation-msf-verify'):
            return subprocess.CompletedProcess([], 0, json.dumps(dict(ok=True, schemaReady=True)), '')
        return super().run(binary, args, **kwargs)

db = FixtureDatabase()
def invoke(operation, **extra):
    result = db.invoke(dict(profileId='termux-local', operationId='integration-' + uuid.uuid4().hex, operation=operation, **extra))
    print(json.dumps(result), flush=True)
    assert result['ok'], result
    return result

password = secrets.token_hex(32)
try:
    invoke('detect')
    invoke('initialize', password=password)
    assert invoke('initialize', password=password)['alreadyInitialized']
    invoke('health', password=password)
    rejected = db.invoke(dict(profileId='termux-local', operationId='wrong-credential', operation='health', password='x'*64))
    assert rejected['errorKey'] == 'DATABASE_CREDENTIALS_INVALID', rejected
    with db.lock():
        assert db.psql("SELECT rolsuper OR rolcreatedb OR rolcreaterole FROM pg_roles WHERE rolname='msf';") == 'f'
        db.psql('CREATE TABLE integration_marker(value integer); INSERT INTO integration_marker VALUES (1);')
    backup = invoke('backup')
    with db.lock(): db.psql('UPDATE integration_marker SET value = 2;')
    restored = invoke('restore', backupId=backup['backupId'], confirmReplace=True)
    with db.lock():
        assert db.psql('SELECT value FROM integration_marker;') == '1'
        assert db.psql("SELECT datallowconn FROM pg_database WHERE datname = '" + restored['rollbackDatabase'] + "';", admin=True, database='postgres') == 'f'
    invoke('rollback', rollbackId=restored['rollbackId'], confirmReplace=True)
    with db.lock(): assert db.psql('SELECT value FROM integration_marker;') == '2'
    invoke('stop')
    invoke('start')
    invoke('health', password=password)
    print('PASS: real PostgreSQL init/repeat/auth/roles/dump/staged cutover/restart; Framework verifier stubbed', flush=True)
finally:
    result = db.invoke(dict(profileId='termux-local', operationId='cleanup-stop', operation='stop'))
    print(json.dumps(result), flush=True)

"""Disposable PostgreSQL maintenance integration; Kali/Framework boundaries are stubbed."""
import json
from pathlib import Path
import secrets
import subprocess
import sys
import tempfile
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
import workstation_common as common
from workstation_database import ManagedDatabase
from workstation_msfdb_maintenance import maintenance


class FixtureDatabase(ManagedDatabase):
    def run(self, binary, args, **kwargs):
        if args and str(args[0]).endswith('workstation-msf-verify'):
            self.psql('CREATE TABLE fresh_schema_marker(value integer);', database=args[-1])
            return subprocess.CompletedProcess([], 0, json.dumps({'ok': True}), '')
        return super().run(binary, args, **kwargs)


with tempfile.TemporaryDirectory(prefix='oni-msfdb-') as root:
    common.rebind_workstation_home(Path(root))
    db = FixtureDatabase()
    try:
        result = db.invoke(dict(profileId='termux-local', operation='initialize', operationId='initialize', password=secrets.token_hex(32)))
        assert result['ok'], result
        with db.lock():
            db.psql('CREATE TABLE existing_marker(value integer); INSERT INTO existing_marker VALUES (41);')
        fake_files = subprocess.CompletedProcess([], 0, '{"ok":true,"files":1,"manifestSha256":"fixture"}', '')
        with patch.object(common, 'run_kali', return_value=fake_files):
            prepared = maintenance(db, dict(verb='prepare-reinit', operationId='prepare-reset'))
            changed = maintenance(db, dict(verb='reinit', operationId='reset', confirmationId=prepared['confirmationId']))
        assert changed['rollbackId']
        with db.lock():
            assert db.psql("SELECT count(*) FROM information_schema.tables WHERE table_name='existing_marker';") == '0'
            assert db.psql("SELECT count(*) FROM information_schema.tables WHERE table_name='fresh_schema_marker';") == '1'
            assert db.psql("SELECT datallowconn FROM pg_database WHERE datname='skid_rollback_"+changed['rollbackId']+"';",admin=True,database='postgres') == 'f'
        result = db.invoke(dict(profileId='termux-local', operation='rollback', operationId='rollback-reset', rollbackId=changed['rollbackId'], confirmReplace=True))
        assert result['ok'], result
        with db.lock(): assert db.psql('SELECT value FROM existing_marker;') == '41'
        with patch.object(common, 'run_kali', return_value=fake_files):
            prepared = maintenance(db, dict(verb='prepare-delete', operationId='prepare-delete'))
            deleted = maintenance(db, dict(verb='delete', operationId='delete', confirmationId=prepared['confirmationId']))
        with db.lock(): assert db.psql("SELECT count(*) FROM pg_database WHERE datname='msf';", admin=True,database='postgres') == '0'
        result = db.invoke(dict(profileId='termux-local', operation='rollback', operationId='rollback-delete', rollbackId=deleted['rollbackId'], confirmReplace=True))
        assert result['ok'], result
        with db.lock(): assert db.psql('SELECT value FROM existing_marker;') == '41'
        print(json.dumps(dict(ok=True, realPostgresql=True, reset=True, deactivate=True, rollback=True, retainedOriginalData=True, frameworkAndFileCopy='stubbed')))
    finally:
        stopped = db.invoke(dict(profileId='termux-local',operation='stop',operationId='stop'))
        assert stopped['ok'], stopped

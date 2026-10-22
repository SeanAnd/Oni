"""Real PostgreSQL failure/recovery checks; only Framework staging is stubbed."""
import json
import os
from pathlib import Path
import secrets
import shutil
import socket
import subprocess
import sys
import tempfile
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
import workstation_common as common
from workstation_database import DatabaseError, ManagedDatabase
from workstation_msfdb_maintenance import maintenance


class FixtureDatabase(ManagedDatabase):
    fail_migration = False

    def run(self, binary, args, **kwargs):
        if args and str(args[0]).endswith('workstation-msf-verify'):
            if self.fail_migration:
                return subprocess.CompletedProcess([], 1, '{"ok":false,"errorKey":"METASPLOIT_UNAVAILABLE"}', '')
            self.psql('CREATE TABLE IF NOT EXISTS fresh_schema_marker(value integer);', database=args[-1])
            return subprocess.CompletedProcess([], 0, '{"ok":true}', '')
        return super().run(binary, args, **kwargs)


with tempfile.TemporaryDirectory(prefix='oni-msfdb-fault-') as root:
    common.rebind_workstation_home(Path(root))
    db = FixtureDatabase()
    passed = []

    def original_preserved():
        assert db.psql('SELECT value FROM existing_marker;') == '41'

    def crash_on_committed(path, data):
        if path.name.endswith('.cutover.json') and json.loads(data)['phase'] == 'committed':
            raise OSError('injected loss after SQL commit')
        atomic(path, data)

    def crash_on_rolled_back(path, data):
        if path.name.endswith('.cutover.json') and json.loads(data)['phase'] == 'rolled_back':
            raise OSError('injected loss after rollback SQL commit')
        atomic(path, data)

    def worker_death(action, phase):
        pid = os.fork()
        if pid == 0:
            def die(path, data):
                if path.suffix == '.json' and json.loads(data).get('phase') == phase:
                    os._exit(93)
                atomic(path, data)
            try:
                with patch.object(common, 'atomic_write', side_effect=die):
                    action()
            except BaseException:
                os._exit(94)
            os._exit(94)
        _, status = os.waitpid(pid, 0)
        assert os.waitstatus_to_exitcode(status) == 93, 'fault boundary not reached'

    try:
        initialize = dict(profileId='termux-local', operation='initialize', operationId='initialize', password=secrets.token_hex(32))
        with socket.socket() as occupied:
            occupied.bind(('127.0.0.1', 5432)); occupied.listen(1)
            refused = db.invoke(initialize)
            assert not refused['ok'] and refused['errorKey'] == 'DATABASE_PORT_CONFLICT'
            assert occupied.getsockname()[1] == 5432
        assert db.invoke(initialize)['ok']
        passed.append('occupied_port_then_resumable_init')
        db.psql('CREATE TABLE existing_marker(value integer); INSERT INTO existing_marker VALUES (41);')
        try: db.health(password='invalid-'+'x'*48)
        except DatabaseError as error: assert error.key == 'DATABASE_CREDENTIALS_INVALID'
        else: raise AssertionError('wrong credential accepted')
        original_preserved(); passed.append('wrong_password_rejected')
        # This fixture runs with a bounded 384 MiB /tmp tmpfs. Allocate enough
        # actual blocks to cross the existing reserve, then remove only our filler.
        usage = shutil.disk_usage(root)
        assert usage.total <= 512*1024*1024, 'Run with a bounded /tmp tmpfs'
        filler = Path(root)/'space-pressure'
        try:
            with filler.open('wb') as stream:
                os.posix_fallocate(stream.fileno(), 0, max(1, usage.free-256*1024*1024+1024*1024))
            try: maintenance(db, dict(verb='prepare-reinit', operationId='real-space-pressure'))
            except DatabaseError as error: assert error.key == 'STORAGE_FULL'
            else: raise AssertionError('low storage accepted')
        finally:filler.unlink(missing_ok=True)
        original_preserved(); passed.append('real_filesystem_reserve_preserves_original')
        with patch.object(db, 'backup', side_effect=DatabaseError('STORAGE_FULL', 'injected')):
            try: maintenance(db, dict(verb='prepare-reinit', operationId='no-space'))
            except DatabaseError as error: assert error.key == 'STORAGE_FULL'
            else: raise AssertionError('backup failure accepted')
        original_preserved(); passed.append('backup_failure_preserves_original')
        files = subprocess.CompletedProcess([], 0, '{"ok":true,"files":0}', '')
        with patch.object(common, 'run_kali', return_value=files):
            prepared = maintenance(db, dict(verb='prepare-reinit', operationId='prepare-reset'))
        request = dict(verb='reinit', operationId='reset', confirmationId=prepared['confirmationId'])
        dump = db.backups/(prepared['backupId']+'.dump')
        original_dump = dump.read_bytes()
        dump.write_bytes(original_dump+b'corrupted fixture')
        try: maintenance(db, request)
        except DatabaseError as error: assert error.key == 'ARTIFACT_INTEGRITY_FAILED'
        else: raise AssertionError('altered backup accepted')
        dump.write_bytes(original_dump)
        original_preserved(); passed.append('altered_backup_rejected')
        with patch.object(db, 'space', side_effect=DatabaseError('STORAGE_FULL', 'injected')):
            try: maintenance(db, request)
            except DatabaseError as error: assert error.key == 'STORAGE_FULL'
            else: raise AssertionError('full disk accepted')
        original_preserved(); passed.append('staging_space_failure_preserves_original')
        db.fail_migration = True
        try: maintenance(db, request)
        except DatabaseError as error: assert error.key == 'METASPLOIT_UNAVAILABLE'
        else: raise AssertionError('failed migration accepted')
        original_preserved(); passed.append('failed_migration_preserves_original')
        db.fail_migration = False
        atomic = common.atomic_write
        with patch.object(common, 'atomic_write', side_effect=crash_on_committed):
            try: maintenance(db, request)
            except OSError: pass
            else: raise AssertionError('commit fault not reached')
        reset = maintenance(db, request)
        assert reset['rollbackId']; passed.append('reset_commit_recovery')
        rollback = dict(profileId='termux-local', operation='rollback', operationId='rollback-reset', rollbackId=reset['rollbackId'], confirmReplace=True)
        with patch.object(common, 'atomic_write', side_effect=crash_on_rolled_back):
            try: db.invoke(rollback)
            except OSError: pass
        assert db.invoke(rollback)['ok']
        original_preserved(); passed.append('reset_rollback_commit_recovery')
        with patch.object(common, 'run_kali', return_value=files):
            prepared = maintenance(db, dict(verb='prepare-delete', operationId='prepare-delete'))
        delete_request = dict(verb='delete', operationId='delete', confirmationId=prepared['confirmationId'])
        worker_death(lambda: maintenance(db, delete_request), 'committed')
        deleted = maintenance(db, delete_request)
        passed.append('worker_death_after_delete_commit')
        rollback = dict(profileId='termux-local', operation='rollback', operationId='rollback-delete', rollbackId=deleted['rollbackId'], confirmReplace=True)
        with patch.object(common, 'atomic_write', side_effect=crash_on_rolled_back):
            try: db.invoke(rollback)
            except OSError: pass
        recovered = db.invoke(rollback)
        assert recovered['ok'], recovered.get('errorKey')
        original_preserved(); passed.append('delete_rollback_commit_recovery')
        with patch.object(common, 'run_kali', return_value=files):
            prepared = maintenance(db, dict(verb='prepare-reinit', operationId='prepare-interrupted-create'))
        interrupted = dict(verb='reinit', operationId='interrupted-create', confirmationId=prepared['confirmationId'])
        worker_death(lambda: maintenance(db, interrupted), 'created')
        try: maintenance(db, interrupted)
        except DatabaseError as error: assert error.key == 'DATABASE_RECOVERY_REQUIRED'
        else: raise AssertionError('ambiguous staging creation accepted')
        original_preserved(); passed.append('worker_death_during_staging_preserves_original')
        print(json.dumps({'ok': True, 'realPostgresql': True, 'passed': passed}))
    finally:
        assert db.invoke(dict(profileId='termux-local', operation='stop', operationId='stop'))['ok']

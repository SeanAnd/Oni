"""Policy failures use disposable state; real database acceptance runs on Termux."""
import fcntl
import json
import os
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from workstation_database import DatabaseError, ManagedDatabase, parse_request
import workstation_common as common
import workstation_jobs as jobs


def request(operation='detect', **extra):
    return dict(profileId='termux-local', operationId='test-operation', operation=operation, **extra)


class DeviceDatabaseTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.previous_home = common.WORKSTATION_HOME
        common.rebind_workstation_home(Path(self.temporary.name))
        self.db = ManagedDatabase(Path(self.temporary.name) / 'postgres')
        self.db.layout()

    def tearDown(self):
        common.rebind_workstation_home(self.previous_home)
        self.temporary.cleanup()

    def test_fixed_profile_operations_and_secret_transport(self):
        self.assertEqual(parse_request(json.dumps(request())), request())
        for change in [dict(profileId='retired-profile'), dict(operation='exec'), dict(operationId='../escape'), dict(sql='DROP DATABASE msf'), dict(host='remote'), dict(password='short')]:
            with self.subTest(change=change), self.assertRaises(DatabaseError):
                parse_request(json.dumps({**request(), **change}))

    def test_restore_requires_explicit_replacement_and_managed_identifier(self):
        for extra in [dict(), dict(backupId='valid'), dict(backupId='../other', confirmReplace=True), dict(backupId='valid', confirmReplace='true')]:
            with self.assertRaises(DatabaseError): parse_request(json.dumps(request('restore', **extra)))
        self.assertEqual(parse_request(json.dumps(request('restore', backupId='backup-1', confirmReplace=True)))['backupId'], 'backup-1')

    def test_rollback_requires_owned_restore_and_confirmation(self):
        for fields in [dict(rollbackId='../../data', confirmReplace=True), dict(rollbackId='f'*16), dict(rollbackId='f'*16, confirmReplace='yes')]:
            with self.assertRaises(DatabaseError): parse_request(json.dumps(request('rollback', **fields)))
        value = parse_request(json.dumps(request('rollback', rollbackId='f'*16, confirmReplace=True)))
        with patch.object(self.db, 'owner', return_value={'installationId': 'owned'}):
            self.assertEqual(self.db.invoke(value)['errorKey'], 'DATABASE_OWNERSHIP_DENIED')

    def test_unknown_data_is_never_adopted(self):
        self.db.data.mkdir()
        preserved = self.db.data / 'user-data'
        preserved.write_text('keep')
        with self.assertRaises(DatabaseError) as caught: self.db.owner(required=False)
        self.assertEqual(caught.exception.key, 'DATABASE_OWNERSHIP_DENIED')
        self.assertEqual(preserved.read_text(), 'keep')

    def test_symlink_cluster_is_rejected(self):
        self.db.data.symlink_to(Path(self.temporary.name))
        result = self.db.invoke(request())
        self.assertEqual(result['errorKey'], 'PERMISSION_DENIED')

    def test_lifecycle_lock_rejects_concurrent_mutation(self):
        with self.db.lock():
            result = self.db.invoke(request('start'))
        self.assertEqual(result['errorKey'], 'DATABASE_BUSY')

    def test_install_respects_python_bootstrap_package_lock(self):
        packages = common.WORKSTATION_HOME / 'bootstrap'
        packages.mkdir()
        with (packages / 'install.lock').open('a') as lock, patch.object(self.db, 'run') as run:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            result = self.db.invoke(request('install'))
            self.assertEqual(result['errorKey'], 'DATABASE_BUSY')
            run.assert_not_called()

    def test_operation_replay_binds_payload_and_does_not_store_secrets(self):
        secret = 'a' * 64
        value = request('initialize', password=secret)
        with patch.object(self.db, 'perform', return_value=dict(alreadyInitialized=False)) as perform:
            first = self.db.invoke(value)
            second = self.db.invoke(value)
            self.assertEqual(first, second)
            self.assertEqual(perform.call_count, 1)
            changed = self.db.invoke({**value, 'password': 'b' * 64})
            self.assertEqual(changed['errorKey'], 'INVALID_PAYLOAD')
        journal = (self.db.journal / 'test-operation.json').read_text()
        self.assertNotIn(secret, journal)
        self.assertNotIn('password', journal)
        self.assertEqual((self.db.journal / 'test-operation.json').stat().st_mode & 0o777, 0o600)

    def test_interrupted_operation_can_resume_same_identity(self):
        value = request('start')
        with patch.object(self.db, 'perform', side_effect=DatabaseError('JOB_TIMEOUT', 'Interrupted')):
            self.assertFalse(self.db.invoke(value)['ok'])
        with patch.object(self.db, 'perform', return_value=dict(running=True)):
            self.assertTrue(self.db.invoke(value)['ok'])

    def test_binary_data_major_mismatch_never_starts(self):
        self.db.data.mkdir()
        (self.db.data / 'PG_VERSION').write_text('17')
        self.db.save_owner(dict(profileId='termux-local', uid=os.getuid(), dataPath=str(self.db.data.resolve()), major=17))
        with patch.object(self.db, 'major', return_value=18):
            result = self.db.invoke(request('start'))
        self.assertEqual(result['errorKey'], 'DATABASE_VERSION_UNSUPPORTED')

    def test_low_space_fails_before_initialization(self):
        with patch('workstation_database.shutil.disk_usage') as usage:
            usage.return_value.free = 1
            result = self.db.invoke(request('initialize', password='a' * 64))
        self.assertEqual(result['errorKey'], 'STORAGE_FULL')
        self.assertFalse(self.db.data.exists())

    def test_existing_credential_is_not_rotated(self):
        (self.db.root / 'msf.secret').write_text('original')
        with patch.object(self.db, 'owner', return_value={'initialized': True}):
            result = self.db.invoke(request('initialize', password='a' * 64))
        self.assertEqual(result['errorKey'], 'DATABASE_CREDENTIALS_INVALID')
        self.assertEqual((self.db.root / 'msf.secret').read_text(), 'original')

    def test_backup_corruption_fails_before_restore(self):
        archive = self.db.backups / 'backup-1.dump'
        archive.write_bytes(b'corrupt')
        (self.db.backups / 'backup-1.json').write_text(json.dumps(dict(installationId='owned', major=18, size=7, sha256='f' * 64)))
        with patch.object(self.db, 'owner', return_value={'installationId': 'owned'}), patch.object(self.db, 'major', return_value=18):
            result = self.db.invoke(request('restore', backupId='backup-1', confirmReplace=True))
        self.assertEqual(result['errorKey'], 'ARTIFACT_INTEGRITY_FAILED')

    def test_restore_space_accounts_for_uncompressed_database(self):
        archive = self.db.backups / 'backup-1.dump'
        archive.write_bytes(b'compressed')
        (self.db.backups / 'backup-1.json').write_text(json.dumps(dict(installationId='owned', major=18, size=archive.stat().st_size, sha256=common.sha256_file(archive), databaseSizeBytes=1024*1024*1024)))
        with patch.object(self.db, 'owner', return_value={'installationId': 'owned'}), patch.object(self.db, 'major', return_value=18), patch.object(self.db, 'space', side_effect=DatabaseError('STORAGE_FULL', 'Insufficient staging space')) as space, patch.object(self.db, 'run') as run:
            result = self.db.invoke(request('restore', backupId='backup-1', confirmReplace=True))
        self.assertEqual(result['errorKey'], 'STORAGE_FULL')
        space.assert_called_once_with(2*1024*1024*1024)
        run.assert_not_called()

    def test_backup_publication_preserves_bytes_and_operation_ownership(self):
        common.ensure_layout()
        archive = self.db.backups / 'backup-owned.dump'
        archive.write_bytes(b'custom-format-backup' * 40000)
        result = dict(backupId='backup-owned', size=archive.stat().st_size, sha256=common.sha256_file(archive))
        jobs.publish_backup_artifact(dict(jobId='backup-job', projectId='system-onboarding', operationId='backup-operation'), result, 'backup-artifact')
        published = common.ARTIFACT_DIR / 'backup-artifact.log'
        self.assertEqual(published.read_bytes(), archive.read_bytes())
        self.assertEqual(published.stat().st_mode & 0o777, 0o600)
        metadata = json.loads((common.ARTIFACT_DIR / 'backup-artifact.json').read_text())
        self.assertEqual(metadata['jobId'], 'backup-job')
        self.assertEqual(metadata['operationId'], 'backup-operation')
        self.assertFalse((common.ARTIFACT_DIR / 'backup-artifact.partial').exists())

    def test_health_and_database_jobs_are_allowlisted_and_secret_free(self):
        for task in [dict(type='kali.health'), dict(type='database', profileId='termux-local', operation='initialize')]:
            value = dict(jobId='job', projectId='system-onboarding', operationId='op', timeoutMs=180000, task=task)
            self.assertIsNotNone(jobs.parse_request(json.dumps(value))[0])
            value['task'] = {**task, 'password': 'never-persist'}
            self.assertIsNone(jobs.parse_request(json.dumps(value))[0])

    def test_database_error_output_never_echoes_sql_credentials(self):
        import subprocess
        with patch('workstation_database.shutil.which', return_value='/bin/psql'), patch('workstation_database.subprocess.run', return_value=subprocess.CompletedProcess([], 1, '', "ERROR secret-password")):
            with self.assertRaises(DatabaseError) as caught: self.db.run('psql', [], sql='secret-password')
        self.assertNotIn('secret-password', str(caught.exception))

class SupervisedHealthTests(unittest.TestCase):
    def test_database_worker_does_not_inherit_scan_file_size_limit(self):
        import shutil
        import subprocess
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            scripts = root / 'scripts'
            scripts.mkdir()
            for name in ['workstation-run', 'workstation_common.py', 'workstation_jobs.py', 'workstation_database.py']:
                shutil.copy(Path(jobs.__file__).with_name(name), scripts / name)
            (scripts / 'workstation-db').write_text("import json, pathlib, sys\np=pathlib.Path(__file__).with_name('database-segment')\np.write_bytes(b'x' * (7 * 1024 * 1024))\nprint(json.dumps(dict(ok=True, operationId=json.loads(sys.argv[2])['operationId'])))\n")
            value = dict(jobId='database-file-limit', projectId='system-onboarding', operationId='file-limit-op', timeoutMs=15000, task=dict(type='database', profileId='termux-local', operation='start', databaseOperationId='stable-database-operation'))
            completed = subprocess.run([sys.executable, str(scripts / 'workstation-run'), '--request-json', json.dumps(value)], env={**os.environ, 'SKID_WORKSTATION_HOME': str(root / 'state')}, capture_output=True, text=True, timeout=20)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            self.assertEqual(json.loads(completed.stdout)['status'], 'completed')
            self.assertEqual(json.loads(completed.stdout)['databaseResult']['operationId'], 'stable-database-operation')
            self.assertEqual((scripts / 'database-segment').stat().st_size, 7 * 1024 * 1024)

    def test_running_health_cancel_confirms_process_exit(self):
        import subprocess
        import time
        previous = common.WORKSTATION_HOME
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            launcher = root / 'nh'
            launcher.write_text('#!/bin/sh\nsleep 30\n')
            launcher.chmod(0o700)
            common.rebind_workstation_home(root)
            value = dict(jobId='health', projectId='system-onboarding', operationId='health-op', timeoutMs=15000, task=dict(type='kali.health'))
            process = subprocess.Popen([sys.executable, str(Path(jobs.__file__).with_name('workstation-run')), '--request-json', json.dumps(value)], env={**os.environ, 'SKID_WORKSTATION_HOME': temporary, 'NH_PATH': str(launcher)}, stdout=subprocess.PIPE, text=True)
            try:
                deadline = time.monotonic() + 4
                state = None
                while time.monotonic() < deadline:
                    state = jobs.read_state('health')
                    if state and state.get('processIdentity'): break
                    time.sleep(.05)
                self.assertIsNotNone(state)
                cancelled = jobs.cancel_job('health', 'health-op')
                self.assertEqual(cancelled['status'], 'cancelled')
                self.assertIsNone(jobs.process_identity(state['processPid']))
                process.communicate(timeout=5)
                self.assertEqual(jobs.load_job('health', 'health-op')['status'], 'cancelled')
            finally:
                if process.poll() is None:
                    if state: jobs.terminate_group(state.get('processPid', 0), state.get('processIdentity'))
                    process.kill()
                    process.communicate()
                common.rebind_workstation_home(previous)

"""Managed Termux PostgreSQL policy. No caller-supplied SQL, paths or endpoints."""
from __future__ import annotations

import fcntl
import hashlib
import hmac
import json
import os
import re
import secrets
import shutil
import socket
import subprocess
import time
import uuid
from contextlib import contextmanager
from datetime import datetime, timezone
from pathlib import Path

import workstation_common as common

OPERATIONS = {'detect', 'install', 'initialize', 'start', 'stop', 'health', 'backup', 'restore', 'rollback'}
MUTATIONS = OPERATIONS - {'detect', 'health'}
SUPPORTED_MAJORS = {17, 18}


class DatabaseError(Exception):
    def __init__(self, key, detail):
        self.key, self.detail = key, detail
        super().__init__(detail)


def parse_request(raw):
    try:
        value = json.loads(raw)
        if not isinstance(value, dict) or set(value) - {'profileId', 'operationId', 'operation', 'password', 'backupId', 'confirmReplace', 'rollbackId'}:
            raise ValueError()
        if value.get('profileId') != 'termux-local' or common.validate_id(value.get('operationId'), 'operationId') or value.get('operation') not in OPERATIONS:
            raise ValueError()
        password = value.get('password')
        if password is not None and (not isinstance(password, str) or not 32 <= len(password) <= 128 or not re.fullmatch(r'[A-Za-z0-9_-]+', password)):
            raise ValueError()
        if value['operation'] == 'initialize' and password is None:
            raise ValueError()
        if value['operation'] == 'restore' and (common.validate_id(value.get('backupId'), 'backupId') or value.get('confirmReplace') is not True):
            raise ValueError()
        if value['operation'] == 'rollback' and (not isinstance(value.get('rollbackId'), str) or not re.fullmatch(r'[a-f0-9]{16}', value['rollbackId']) or value.get('confirmReplace') is not True):
            raise ValueError()
        return value
    except (ValueError, TypeError):
        raise DatabaseError('INVALID_PAYLOAD', 'Expected a supported device database operation and its identity.')


class ManagedDatabase:
    def __init__(self, root=None):
        self.root = root or common.WORKSTATION_HOME / 'postgres'
        self.data = self.root / 'data'
        self.owner_path = self.root / 'owner.json'
        self.socket_dir = self.root / 'socket'
        self.backups = self.root / 'backups'
        self.journal = self.root / 'operations'

    def layout(self):
        for path in (self.root, self.socket_dir, self.backups, self.journal):
            if path.is_symlink():
                raise DatabaseError('PERMISSION_DENIED', 'Managed database paths must not be symbolic links.')
            path.mkdir(parents=True, mode=0o700, exist_ok=True)
            path.chmod(0o700)
        if self.data.is_symlink() or self.owner_path.is_symlink():
            raise DatabaseError('PERMISSION_DENIED', 'Managed cluster ownership path is unsafe.')

    @contextmanager
    def lock(self):
        self.layout()
        with (self.root / 'lifecycle.lock').open('a') as stream:
            try:
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError:
                raise DatabaseError('DATABASE_BUSY', 'Another database operation is active. Retry after it finishes.')
            yield

    def run(self, binary, args, *, sql=None, env=None, timeout=60, check=True):
        executable = shutil.which(binary)
        if not executable:
            raise DatabaseError('TOOL_NOT_FOUND', 'Install the Termux PostgreSQL package from setup.')
        environment = {k: v for k, v in os.environ.items() if not k.startswith('PG')}
        environment.update(PGCONNECT_TIMEOUT='5', PGOPTIONS='-c statement_timeout=30000', LC_ALL='C')
        environment.update(env or {})
        try:
            result = subprocess.run([executable, *map(str, args)], input=sql, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=environment, timeout=timeout)
        except subprocess.TimeoutExpired:
            raise DatabaseError('JOB_TIMEOUT', 'Database operation timed out; inspect state before retrying.')
        if check and result.returncode:
            # Never forward PostgreSQL output: it can quote a credential-bearing statement.
            key = 'DATABASE_CREDENTIALS_INVALID' if 'password authentication failed' in result.stderr else 'DATABASE_UNAVAILABLE'
            raise DatabaseError(key, 'PostgreSQL operation failed. Check the managed service and stored credentials.')
        return result

    def major(self):
        output = self.run('postgres', ['--version']).stdout
        match = re.search(r'PostgreSQL\) (\d+)', output)
        if not match or int(match[1]) not in SUPPORTED_MAJORS:
            raise DatabaseError('DATABASE_VERSION_UNSUPPORTED', 'Supported PostgreSQL majors are 17 and 18; preserve data and use a logical upgrade.')
        return int(match[1])

    def owner(self, required=True):
        if not self.owner_path.exists():
            if self.data.exists() or required:
                raise DatabaseError('DATABASE_OWNERSHIP_DENIED', 'No managed cluster identity. Existing data will not be adopted or overwritten.')
            return None
        owner = json.loads(self.owner_path.read_text())
        if owner.get('profileId') != 'termux-local' or owner.get('uid') != os.getuid() or owner.get('dataPath') != str(self.data.resolve()):
            raise DatabaseError('DATABASE_OWNERSHIP_DENIED', 'Cluster identity does not match this installation.')
        version = self.data / 'PG_VERSION'
        if owner['major'] != self.major() or (version.exists() and int(version.read_text().strip()) != owner['major']):
            raise DatabaseError('DATABASE_VERSION_UNSUPPORTED', 'Binary and data major differ. Back up with the original major before upgrading.')
        return owner

    def save_owner(self, owner):
        common.atomic_write(self.owner_path, json.dumps(owner).encode())

    def running(self):
        if not (self.data / 'PG_VERSION').exists():
            return False
        self.owner()
        result = self.run('pg_ctl', ['-D', self.data, 'status'], check=False)
        if result.returncode == 0:
            # pg_ctl validates the postmaster and data directory; additionally check live /proc argv.
            pid = int((self.data / 'postmaster.pid').read_text().splitlines()[0])
            argv = Path(f'/proc/{pid}/cmdline').read_bytes().split(b'\0')
            if str(self.data).encode() not in argv or b'postgres' not in Path(os.fsdecode(argv[0])).name.encode():
                raise DatabaseError('DATABASE_OWNERSHIP_DENIED', 'Running process does not belong to this cluster.')
            return True
        return False

    def psql(self, sql, *, admin=False, database='msf', password=None):
        password = password or (self.root / ('admin.secret' if admin else 'msf.secret')).read_text().strip()
        # Private passfile, not argv or SQL interpolation. Generated passwords cannot contain delimiters.
        passfile = self.root / 'query.pgpass'
        common.atomic_write(passfile, f'127.0.0.1:5432:*:{"skid_admin" if admin else "msf"}:{password}\n'.encode())
        try:
            return self.run('psql', ['-X', '-w', '-h', '127.0.0.1', '-p', '5432', '-U', 'skid_admin' if admin else 'msf', '-d', database, '-v', 'ON_ERROR_STOP=1', '-At'], sql=sql, env={'PGPASSFILE': str(passfile), 'SKID_MSF_PASSWORD': (self.root / 'msf.secret').read_text().strip()}).stdout.strip()
        finally:
            passfile.unlink(missing_ok=True)

    def space(self, required=256 * 1024 * 1024):
        if shutil.disk_usage(self.root).free < required:
            raise DatabaseError('STORAGE_FULL', 'Insufficient free space for this database operation.')

    def start(self):
        self.owner()
        if not self.running():
            with socket.socket() as probe:
                try:
                    probe.bind(('127.0.0.1', 5432))
                except OSError:
                    raise DatabaseError('DATABASE_PORT_CONFLICT', 'Device port 5432 is occupied by another service. No process was stopped.')
            self.run('pg_ctl', ['-D', self.data, '-l', self.root / 'postgres.log', '-w', '-t', '30', 'start'], timeout=40)
        self.verify_identity()
        return {'running': True}

    def verify_identity(self):
        # Verify endpoint identity over authenticated admin access, not readiness alone.
        if self.psql('SHOW data_directory;', admin=True, database='postgres') != str(self.data):
            raise DatabaseError('DATABASE_OWNERSHIP_DENIED', 'Connected server does not own this managed data directory.')

    def initialize(self, password):
        self.space()
        owner = self.owner(required=False)
        already = bool(owner and owner.get('initialized'))
        if owner and (self.root / 'msf.secret').read_text().strip() != password:
            raise DatabaseError('DATABASE_CREDENTIALS_INVALID', 'Stored credential differs. Restore the existing credential; it was not rotated.')
        if owner is None:
            common.atomic_write(self.root / 'admin.secret', secrets.token_urlsafe(48).encode())
            common.atomic_write(self.root / 'msf.secret', password.encode())
            owner = dict(profileId='termux-local', installationId=str(uuid.uuid4()), major=self.major(), uid=os.getuid(), dataPath=str(self.data.resolve()), initialized=False)
            self.save_owner(owner)
        if not owner.get('clusterCreated') and not already:
            if self.data.exists():
                self.data.rename(self.root / f'incomplete-{uuid.uuid4().hex}')
            self.run('initdb', ['-D', self.data, '-U', 'skid_admin', '--pwfile', self.root / 'admin.secret', '--auth-local=scram-sha-256', '--auth-host=scram-sha-256', '--encoding=UTF8', '--locale=C', '--no-clean'], timeout=120)
            owner['clusterCreated'] = True
            self.save_owner(owner)
        if not already:
            # Own only this dedicated cluster. No global Termux database configuration is touched.
            common.atomic_write(self.data / 'postgresql.conf', ("listen_addresses = '127.0.0.1'\nport = 5432\nunix_socket_directories = '" + str(self.socket_dir).replace("'", "''") + "'\npassword_encryption = 'scram-sha-256'\nfsync = on\n").encode())
            common.atomic_write(self.data / 'pg_hba.conf', b'local all all scram-sha-256\nhost all all 127.0.0.1/32 scram-sha-256\n')
        self.start()
        migration = Path(__file__).resolve().parent / '0001_msf_role.sql'
        if not migration.exists():
            migration = Path(__file__).resolve().parents[1] / 'migrations/termux/0001_msf_role.sql'
        checksum = common.sha256_file(migration)
        if owner.get('migrationChecksum') not in (None, checksum):
            raise DatabaseError('DATABASE_MIGRATION_MISMATCH', 'Managed bootstrap checksum differs. Restore the applied file; do not edit migration records.')
        self.psql(migration.read_text(), admin=True, database='postgres')
        self.psql('SELECT 1;', password=password)
        owner.update(initialized=True, migrationChecksum=checksum)
        self.save_owner(owner)
        return {'alreadyInitialized': already, 'running': True}

    def health(self, password=None):
        owner = self.owner()
        running = self.running()
        if not running:
            return dict(ok=False, errorKey='DATABASE_UNAVAILABLE', packageInstalled=True, clusterInitialized=owner.get('initialized', False), serverReachable=False, authenticatedQueryOk=False, schemaReady=False)
        size = self.psql('SELECT pg_database_size(current_database());', password=password)
        return dict(packageInstalled=True, clusterInitialized=owner.get('initialized', False), serverReachable=True, authenticatedQueryOk=True, schemaReady=False, databaseSizeBytes=int(size))

    def backup(self, operation_id):
        health = self.health()
        self.space()
        backup_id = 'backup-' + hashlib.sha256(operation_id.encode()).hexdigest()[:24]
        path = self.backups / (backup_id + '.dump')
        password = (self.root / 'msf.secret').read_text().strip()
        self.run('pg_dump', ['-h', '127.0.0.1', '-p', '5432', '-U', 'msf', '-w', '-Fc', '-f', str(path) + '.partial', 'msf'], env={'PGPASSWORD': password}, timeout=180)
        Path(str(path) + '.partial').replace(path)
        path.chmod(0o600)
        meta = dict(backupId=backup_id, sha256=common.sha256_file(path), size=path.stat().st_size, databaseSizeBytes=health['databaseSizeBytes'], major=self.major(), installationId=self.owner()['installationId'], createdAt=datetime.now(timezone.utc).isoformat())
        common.atomic_write(self.backups / (backup_id + '.json'), json.dumps(meta).encode())
        return meta

    def restore(self, request):
        backup_id = request['backupId']
        meta_path, path = self.backups / (backup_id + '.json'), self.backups / (backup_id + '.dump')
        if not meta_path.is_file() or not path.is_file() or path.is_symlink() or meta_path.is_symlink():
            raise DatabaseError('INVALID_PAYLOAD', 'Select a backup created by this managed installation.')
        meta = json.loads(meta_path.read_text())
        if meta['installationId'] != self.owner()['installationId'] or meta['major'] != self.major() or meta['sha256'] != common.sha256_file(path) or meta['size'] != path.stat().st_size:
            raise DatabaseError('ARTIFACT_INTEGRITY_FAILED', 'Backup identity, version, size or hash does not match.')
        logical_size = meta.get('databaseSizeBytes')
        if not isinstance(logical_size, int) or logical_size < 0:
            logical_size = self.health()['databaseSizeBytes']
        self.space(max(256 * 1024 * 1024, meta['size'] * 4, logical_size * 2))
        self.run('pg_restore', ['--list', path])
        suffix = hashlib.sha256(request['operationId'].encode()).hexdigest()[:16]
        staging, rollback = 'skid_stage_' + suffix, 'skid_rollback_' + suffix
        # Names are generated here, never request text. psql quotes identifiers through format(%I).
        cutover = self.root / (suffix + '.cutover.json')
        phase = json.loads(cutover.read_text()) if cutover.exists() else {'phase': 'new'}
        if phase['phase'] == 'committed':
            return dict(restored=True, rollbackDatabase=rollback, rollbackId=suffix, backupId=backup_id)
        if phase['phase'] == 'replacing':
            names = set(self.psql("SELECT datname FROM pg_database;", admin=True, database='postgres').splitlines())
            if 'msf' in names and rollback in names and staging not in names:
                common.atomic_write(cutover, json.dumps({'phase': 'committed'}).encode())
                return dict(restored=True, rollbackDatabase=rollback, rollbackId=suffix, backupId=backup_id)
            if 'msf' in names and staging in names and rollback not in names:
                phase = {'phase': 'staged'}
            else:
                raise DatabaseError('DATABASE_RECOVERY_REQUIRED', 'Restore identities are ambiguous. Original data is retained for inspection.')
        if phase['phase'] not in {'new', 'loading', 'staged'}:
            raise DatabaseError('DATABASE_RECOVERY_REQUIRED', 'Restore requires inspection; retained databases were not changed.')
        if self.psql("SELECT count(*) FROM pg_stat_activity WHERE datname = 'msf';", admin=True, database='postgres') != '0':
            raise DatabaseError('DATABASE_BUSY', 'Close Framework sessions before replacing the database.')
        if phase['phase'] == 'new':
            # Reject an existing staging name rather than adopting an unrelated database.
            if self.psql("SELECT count(*) FROM pg_database WHERE datname = '" + staging + "';", admin=True, database='postgres') != '0':
                raise DatabaseError('DATABASE_OWNERSHIP_DENIED', 'Staging database already exists without an operation journal.')
            self.psql(f'CREATE DATABASE {staging} OWNER msf;', admin=True, database='postgres')
            common.atomic_write(cutover, json.dumps({'phase': 'loading'}).encode())
        if phase['phase'] != 'staged':
            self.run('pg_restore', ['-h', '127.0.0.1', '-p', '5432', '-U', 'msf', '-w', '--no-owner', '--no-acl', '--clean', '--if-exists', '--single-transaction', '--exit-on-error', '-d', staging, path], env={'PGPASSWORD': (self.root / 'msf.secret').read_text().strip()}, timeout=180)
            self.psql('SELECT 1;', database=staging)
            import sys
            # Use supported Framework APIs against the staging database before cutover.
            verification = self.run(sys.executable, [Path(__file__).with_name('workstation-msf-verify'), '--json', '--profile', 'termux-local', '--staging', staging], env={'SKID_SUPERVISED': '1'}, timeout=130)
            verified = json.loads(verification.stdout)
            if not verified.get('ok') or not verified.get('schemaReady'):
                raise DatabaseError('METASPLOIT_UNAVAILABLE', 'Framework could not verify the staging database. Active database was preserved.')
            common.atomic_write(cutover, json.dumps({'phase': 'staged'}).encode())
        common.atomic_write(cutover, json.dumps({'phase': 'replacing', 'staging': staging, 'rollback': rollback}).encode())
        try:
            # Rename and connection gates are transactional; active sessions cause a safe failure.
            self.psql(f'BEGIN; ALTER DATABASE msf ALLOW_CONNECTIONS false; ALTER DATABASE msf RENAME TO {rollback}; ALTER DATABASE {staging} RENAME TO msf; COMMIT;', admin=True, database='postgres')
        except DatabaseError:
            common.atomic_write(cutover, json.dumps({'phase': 'staged'}).encode())
            raise
        common.atomic_write(cutover, json.dumps({'phase': 'committed'}).encode())
        return dict(restored=True, rollbackDatabase=rollback, rollbackId=suffix, backupId=backup_id)

    def rollback(self, request):
        self.owner()
        suffix = request['rollbackId']  # parse_request permits exactly 16 lowercase hex digits.
        cutover = self.root / (suffix + '.cutover.json')
        if cutover.is_symlink() or not cutover.is_file():
            raise DatabaseError('DATABASE_OWNERSHIP_DENIED', 'Select a completed restore from this managed installation.')
        cutover_state = json.loads(cutover.read_text())
        phase = cutover_state['phase']
        if cutover_state.get('maintenance') == 'delete':
            from workstation_msfdb_maintenance import rollback_deleted
            return rollback_deleted(self, request, phase)
        retained, replaced = 'skid_rollback_' + suffix, 'skid_replaced_' + suffix
        names = set(self.psql('SELECT datname FROM pg_database;', admin=True, database='postgres').splitlines())
        if phase in {'rolling_back', 'rolled_back'} and retained not in names and replaced in names and 'msf' in names:
            common.atomic_write(cutover, json.dumps({'phase': 'rolled_back'}).encode())
            return dict(rolledBack=True, rollbackId=suffix)
        if phase not in {'committed', 'rolling_back'} or retained not in names or replaced in names or 'msf' not in names:
            raise DatabaseError('DATABASE_RECOVERY_REQUIRED', 'Rollback identities do not match the completed restore. All databases were preserved.')
        if self.psql("SELECT count(*) FROM pg_stat_activity WHERE datname = 'msf';", admin=True, database='postgres') != '0':
            raise DatabaseError('DATABASE_BUSY', 'Close Framework sessions before rolling back the database.')
        common.atomic_write(cutover, json.dumps({'phase': 'rolling_back'}).encode())
        self.psql(f'BEGIN; ALTER DATABASE msf ALLOW_CONNECTIONS false; ALTER DATABASE msf RENAME TO {replaced}; ALTER DATABASE {retained} RENAME TO msf; ALTER DATABASE msf ALLOW_CONNECTIONS true; COMMIT;', admin=True, database='postgres')
        common.atomic_write(cutover, json.dumps({'phase': 'rolled_back'}).encode())
        self.health()
        return dict(rolledBack=True, rollbackId=suffix)

    def perform(self, request):
        operation = request['operation']
        if operation == 'detect':
            installed = shutil.which('postgres') is not None
            owner = self.owner(required=False) if installed else None
            return dict(packageInstalled=installed, clusterInitialized=bool(owner and owner.get('initialized')), serverReachable=self.running() if owner else False, serverMajor=self.major() if installed else None)
        if operation == 'install':
            self.space()
            packages = common.WORKSTATION_HOME / 'bootstrap'
            if packages.is_symlink():
                raise DatabaseError('PERMISSION_DENIED', 'Package setup ownership changed.')
            packages.mkdir(mode=0o700, parents=True, exist_ok=True)
            with (packages / 'install.lock').open('a') as package_lock:
                try: fcntl.flock(package_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError:
                    raise DatabaseError('DATABASE_BUSY', 'Termux prerequisite installation is active. Retry when it finishes.')
                installed = self.run('pkg', ['install', '-y', 'postgresql'], timeout=165, check=False)
            if installed.returncode:
                diagnostic = (installed.stdout + installed.stderr).lower()
                if 'could not get lock' in diagnostic or 'unable to acquire' in diagnostic:
                    raise DatabaseError('DATABASE_BUSY', 'Another Termux package operation is active. Wait for it to finish, then retry.')
                raise DatabaseError('TOOL_NOT_FOUND', 'PostgreSQL package installation failed. Check internet access and the Termux package mirror, then retry. Existing databases were preserved.')
            return dict(packageInstalled=True, serverMajor=self.major())
        if operation == 'initialize':
            return self.initialize(request['password'])
        if operation == 'start':
            return self.start()
        if operation == 'stop':
            self.owner()
            if self.running():
                self.run('pg_ctl', ['-D', self.data, '-m', 'fast', '-w', '-t', '30', 'stop'], timeout=40)
            return dict(running=False)
        if operation == 'health':
            return self.health(request.get('password'))
        if operation == 'backup':
            return self.backup(request['operationId'])
        try:
            with common.framework_session_lock():
                return self.rollback(request) if operation == 'rollback' else self.restore(request)
        except BlockingIOError:
            raise DatabaseError('DATABASE_BUSY', 'Close managed Framework consoles before restoring the database.')

    def invoke(self, request):
        context = {k: request[k] for k in ('operation', 'operationId', 'profileId')}
        try:
            with self.lock():
                # HMAC binds credentials to retries without persisting passwords or a guessable digest.
                key_path = self.root / 'journal.secret'
                if not key_path.exists():
                    common.atomic_write(key_path, secrets.token_bytes(32))
                fingerprint = hmac.new(key_path.read_bytes(), json.dumps(request, sort_keys=True).encode(), hashlib.sha256).hexdigest()
                record_path = self.journal / (request['operationId'] + '.json')
                if record_path.exists():
                    record = json.loads(record_path.read_text())
                    if record['fingerprint'] != fingerprint:
                        raise DatabaseError('INVALID_PAYLOAD', 'Operation identity was already used with different parameters.')
                    if record.get('response'):
                        return record['response']
                common.atomic_write(record_path, json.dumps(dict(fingerprint=fingerprint, status='running')).encode())
                fields = self.perform(request)
                result = dict(ok=True, **context, completedAt=datetime.now(timezone.utc).isoformat())
                result.update(fields)
                common.atomic_write(record_path, json.dumps(dict(fingerprint=fingerprint, status='completed', response=result)).encode())
                return result
        except DatabaseError as error:
            return dict(ok=False, **context, errorKey=error.key, detail=error.detail, completedAt=datetime.now(timezone.utc).isoformat())
        except (OSError, ValueError, KeyError):
            return dict(ok=False, **context, errorKey='DATABASE_RECOVERY_REQUIRED', detail='Managed database state could not be read safely. Preserve the cluster and inspect its private state.', completedAt=datetime.now(timezone.utc).isoformat())

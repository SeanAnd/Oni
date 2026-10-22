"""Recoverable, explicitly confirmed Framework maintenance; never deletes a cluster."""
import hashlib
import json
import re
import secrets
import sys
import time

import workstation_common as common
from workstation_database import DatabaseError

# Runs in Kali. Preserve files where Framework uses them and retain a private
# hashed copy before maintenance. Reject symlinks rather than following them.
FILES_PROGRAM = '''import pathlib,json,shutil,hashlib,sys,os
name=json.load(sys.stdin)['identity']
root=pathlib.Path.home()/'.msf4'
target=root/'oni-managed'/'file-backups'/name
target.mkdir(parents=True,mode=0o700,exist_ok=True)
files=[]
for folder in ['loot','local']:
 source=root/folder
 if source.is_symlink(): raise ValueError()
 if not source.exists(): continue
 for p in source.rglob('*'):
  if p.is_symlink(): raise ValueError()
  if not p.is_file(): continue
  rel=p.relative_to(root)
  out=target/rel
  out.parent.mkdir(parents=True,mode=0o700,exist_ok=True)
  shutil.copyfile(p,out);out.chmod(0o600)
  with out.open('rb') as stream: sha=hashlib.file_digest(stream,'sha256').hexdigest()
  with p.open('rb') as stream: original=hashlib.file_digest(stream,'sha256').hexdigest()
  if sha!=original: raise ValueError()
  files.append(dict(path=str(rel),sha256=sha,size=out.stat().st_size))
manifest=target/'manifest.json'
manifest.write_text(json.dumps(files));manifest.chmod(0o600)
print(json.dumps(dict(ok=True,files=len(files),manifestSha256=hashlib.sha256(manifest.read_bytes()).hexdigest())))
'''


def no_sessions(db):
    if db.psql("SELECT count(*) FROM pg_stat_activity WHERE datname = 'msf';", admin=True, database='postgres') != '0':
        raise DatabaseError('DATABASE_BUSY', 'Close every Framework/database session before maintenance.')


def maintenance(db, payload):
    with db.lock(), common.framework_session_lock():
        db.owner()
        db.start()
        state_dir = db.root / 'msfdb-maintenance'
        if state_dir.is_symlink():
            raise DatabaseError('PERMISSION_DENIED', 'Unsafe maintenance state.')
        state_dir.mkdir(mode=0o700, exist_ok=True)
        verb = payload['verb']
        if verb.startswith('prepare-'):
            no_sessions(db)
            backup = db.backup(payload['operationId'])
            identity = secrets.token_hex(16)
            result = common.run_kali('python3', ['-c', FILES_PROGRAM], input=json.dumps({'identity': identity}), timeout=60)
            if result.returncode:
                raise DatabaseError('ARTIFACT_INTEGRITY_FAILED', 'Could not preserve Kali loot/local files. Database was not replaced.')
            files = json.loads(result.stdout)
            if not files.get('ok'):
                raise DatabaseError('ARTIFACT_INTEGRITY_FAILED', 'Kali file backup failed.')
            record = dict(verb=verb[8:], installationId=db.owner()['installationId'], databaseOid=db.psql("SELECT oid FROM pg_database WHERE datname = 'msf';", admin=True, database='postgres'),
                backupId=backup['backupId'], sha256=backup['sha256'], confirmationId=identity, expiresAt=time.time()+300, phase='prepared', files=files)
            common.atomic_write(state_dir / (identity + '.json'), json.dumps(record).encode())
            return dict(backupId=backup['backupId'], confirmationId=identity, expiresAt=record['expiresAt'], filesPreserved=True)
        identity = payload['confirmationId']
        path = state_dir / (identity + '.json')
        if path.is_symlink() or not path.is_file():
            raise DatabaseError('PERMISSION_DENIED', 'Prepare maintenance and confirm its owned backup first.')
        record = json.loads(path.read_text())
        if record['verb'] != verb or record['installationId'] != db.owner()['installationId']:
            raise DatabaseError('PERMISSION_DENIED', 'Maintenance confirmation does not match this database/action.')
        if record.get('operationId') not in {None, payload['operationId']}:
            raise DatabaseError('PERMISSION_DENIED', 'Confirmation already belongs to another operation.')
        if record['phase'] == 'prepared' and record['expiresAt'] < time.time():
            raise DatabaseError('PERMISSION_DENIED', 'Maintenance confirmation expired. Prepare a new backup.')
        backup = db.backups / (record['backupId'] + '.dump')
        if backup.is_symlink() or common.sha256_file(backup) != record['sha256']:
            raise DatabaseError('ARTIFACT_INTEGRITY_FAILED', 'Confirmed backup changed. No replacement performed.')
        suffix = hashlib.sha256(payload['operationId'].encode()).hexdigest()[:16]
        staging, retained = 'skid_stage_' + suffix, 'skid_rollback_' + suffix
        names = set(db.psql('SELECT datname FROM pg_database;', admin=True, database='postgres').splitlines())
        if record['phase'] == 'replacing' and retained in names and staging not in names and (('msf' in names) == (verb == 'reinit')):
            record['phase'] = 'committed'
            common.atomic_write(db.root / (suffix + '.cutover.json'), json.dumps({'phase': 'committed', 'maintenance': verb}).encode())
        if record['phase'] == 'committed':
            common.atomic_write(path, json.dumps(record).encode())
            return dict(backupId=record['backupId'], rollbackId=suffix, detail='Database retained for rollback; Kali files preserved.')
        if record['databaseOid'] != db.psql("SELECT oid FROM pg_database WHERE datname = 'msf';", admin=True, database='postgres'):
            raise DatabaseError('DATABASE_OWNERSHIP_DENIED', 'Database changed after maintenance was prepared.')
        no_sessions(db)
        record['operationId'] = payload['operationId']
        if verb == 'reinit' and record['phase'] == 'prepared':
            if staging in names or retained in names:
                raise DatabaseError('DATABASE_OWNERSHIP_DENIED', 'Maintenance database name already exists.')
            db.space()
            # Persist intent before creation. An ambiguous crash is retained for inspection.
            record['phase'] = 'creating'
            common.atomic_write(path, json.dumps(record).encode())
            db.psql(f'CREATE DATABASE {staging} OWNER msf;', admin=True, database='postgres')
            record['phase'] = 'created'
            common.atomic_write(path, json.dumps(record).encode())
        if record['phase'] == 'creating':
            raise DatabaseError('DATABASE_RECOVERY_REQUIRED', 'Interrupted staging creation requires inspection; all data is retained.')
        if verb == 'reinit' and record['phase'] == 'created':
            result = db.run(sys.executable, [common.BIN_DIR / 'workstation-msf-verify', '--json', '--staging', staging], env={'SKID_SUPERVISED': '1'}, timeout=130, check=False)
            verified = json.loads(result.stdout)
            if result.returncode or not verified.get('ok'):
                raise DatabaseError(verified.get('errorKey', 'METASPLOIT_UNAVAILABLE'), 'Fresh Framework schema could not be verified.')
            record['phase'] = 'staged'
            common.atomic_write(path, json.dumps(record).encode())
        if record['phase'] not in {'prepared', 'staged', 'replacing'}:
            raise DatabaseError('DATABASE_RECOVERY_REQUIRED', 'Unexpected maintenance phase; inspect retained databases.')
        no_sessions(db)
        record['phase'] = 'replacing'
        common.atomic_write(path, json.dumps(record).encode())
        cutover = db.root / (suffix + '.cutover.json')
        common.atomic_write(cutover, json.dumps({'phase': 'replacing', 'maintenance': verb}).encode())
        replacement = f'ALTER DATABASE {staging} RENAME TO msf;' if verb == 'reinit' else ''
        db.psql(f'BEGIN; ALTER DATABASE msf ALLOW_CONNECTIONS false; ALTER DATABASE msf RENAME TO {retained}; {replacement} COMMIT;', admin=True, database='postgres')
        common.atomic_write(cutover, json.dumps({'phase': 'committed', 'maintenance': verb}).encode())
        record['phase'] = 'committed'
        common.atomic_write(path, json.dumps(record).encode())
        return dict(backupId=record['backupId'], rollbackId=suffix, detail='Previous database retained. Use msfdb rollback --rollback-id ' + suffix + '. Kali files were preserved.')


def rollback_deleted(db, request, phase):
    """Called under existing lifecycle/session locks for a retained deleted DB."""
    suffix = request['rollbackId']
    if not re.fullmatch('[a-f0-9]{16}', suffix):
        raise DatabaseError('INVALID_PAYLOAD', 'Invalid rollback identity.')
    retained = 'skid_rollback_' + suffix
    cutover = db.root / (suffix + '.cutover.json')
    record = json.loads(cutover.read_text())
    names = set(db.psql('SELECT datname FROM pg_database;', admin=True, database='postgres').splitlines())
    if phase in {'rolling_back', 'rolled_back'} and 'msf' in names and retained not in names:
        expected = record.get('retainedOid')
        actual = db.psql("SELECT oid FROM pg_database WHERE datname='msf';", admin=True, database='postgres')
        if (phase == 'rolling_back' and expected is None) or (expected is not None and actual != expected):
            raise DatabaseError('DATABASE_OWNERSHIP_DENIED', 'Restored database identity differs from the retained database.')
        record['phase'] = 'rolled_back'
        common.atomic_write(cutover, json.dumps(record).encode())
        return dict(rolledBack=True, rollbackId=suffix)
    if phase not in {'committed', 'rolling_back'} or 'msf' in names or retained not in names:
        raise DatabaseError('DATABASE_RECOVERY_REQUIRED', 'Database identity changed; retained data requires inspection.')
    retained_oid = db.psql(f"SELECT oid FROM pg_database WHERE datname='{retained}';", admin=True, database='postgres')
    if record.get('retainedOid', retained_oid) != retained_oid:
        raise DatabaseError('DATABASE_OWNERSHIP_DENIED', 'Retained database identity changed before rollback.')
    record.update(phase='rolling_back', maintenance='delete', retainedOid=retained_oid)
    common.atomic_write(cutover, json.dumps(record).encode())
    db.psql(f'BEGIN; ALTER DATABASE {retained} RENAME TO msf; ALTER DATABASE msf ALLOW_CONNECTIONS true; COMMIT;', admin=True, database='postgres')
    record['phase'] = 'rolled_back'
    common.atomic_write(cutover, json.dumps(record).encode())
    return dict(rolledBack=True, rollbackId=suffix)

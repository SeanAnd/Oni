"""Fixed Kali lifecycle ingress and Termux-owned compatibility policy."""
import fcntl
import hashlib
import importlib.util
from importlib.machinery import SourceFileLoader
import json
import os
from pathlib import Path
import re
import secrets
import subprocess
import sys
import time

import workstation_common as common
from workstation_database import DatabaseError, ManagedDatabase

VERBS = {'status', 'check', 'start', 'stop', 'restart', 'init', 'run', 'prepare-delete', 'prepare-reinit', 'delete', 'reinit', 'rollback'}


def parse(payload, poll=False):
    if not isinstance(payload, dict) or set(payload) - {'verb', 'operationId', 'confirmationId', 'rollbackId'}:
        raise DatabaseError('INVALID_PAYLOAD', 'Expected a fixed Oni msfdb operation.')
    verb = payload.get('verb')
    if not isinstance(verb, str) or verb not in VERBS | ({'poll'} if poll else set()) or common.validate_id(payload.get('operationId'), 'operationId'):
        raise DatabaseError('INVALID_PAYLOAD', 'Unknown operation or invalid identity.')
    if len(payload['operationId']) > 96:
        raise DatabaseError('INVALID_PAYLOAD', 'Operation identity is too long.')
    if 'confirmationId' in payload and (verb not in {'delete', 'reinit'} or not isinstance(payload['confirmationId'], str) or not re.fullmatch('[a-f0-9]{32}', payload['confirmationId'])):
        raise DatabaseError('INVALID_PAYLOAD', 'Invalid maintenance confirmation.')
    if 'rollbackId' in payload and (verb != 'rollback' or not isinstance(payload['rollbackId'], str) or not re.fullmatch('[a-f0-9]{16}', payload['rollbackId'])):
        raise DatabaseError('INVALID_PAYLOAD', 'Invalid rollback identity.')
    if verb == 'rollback' and 'rollbackId' not in payload:
        raise DatabaseError('INVALID_PAYLOAD', 'Select an owned rollback identity.')
    if verb in {'delete', 'reinit'} and 'confirmationId' not in payload:
        raise DatabaseError('DATABASE_RECOVERY_REQUIRED', 'Use interactive --confirm to create a verified backup before maintenance. No data changed.')
    return payload


def authorize(token):
    path = common.STATE_DIR / 'msfdb-token'
    try:
        return bool(token and not path.is_symlink() and secrets.compare_digest(path.read_text().strip().encode(), token.encode()))
    except (OSError, AttributeError):
        return False


def job_id(operation):
    return 'msfdb-' + hashlib.sha256(operation.encode()).hexdigest()[:32]


def list_jobs():
    from workstation_jobs import load_job, public_state
    common.ensure_layout()
    paths = sorted(common.JOBS_DIR.glob('msfdb-*.json'), key=lambda p: p.stat().st_mtime, reverse=True)[:50]
    results = []
    for path in paths:
        if path.is_symlink() or path.stat().st_size > 65536:
            continue
        value = json.loads(path.read_text())
        request = value.get('request', {})
        if request.get('task', {}).get('type') != 'msfdb' or request.get('projectId') != 'system-onboarding':
            continue
        state = load_job(value['jobId'], value['operationId'])
        results.append({key: state.get(key) for key in ('jobId', 'operationId', 'status')})
    return results


def dispatch(payload):
    from workstation_jobs import load_job, public_state
    if not isinstance(payload, dict):
        raise DatabaseError('INVALID_PAYLOAD', 'Expected an operation object.')
    retry = payload.get('retry', False)
    if type(retry) is not bool:
        raise DatabaseError('INVALID_PAYLOAD', 'Retry must be explicit.')
    payload = parse({k: v for k, v in payload.items() if k != 'retry'}, poll=True)
    common.ensure_layout()
    operation = payload['operationId']
    # Request journal tracks attempts; execution/results remain in the existing job engine.
    directory = common.STATE_DIR / 'msfdb-requests'
    if directory.is_symlink():
        raise DatabaseError('PERMISSION_DENIED', 'Unsafe request journal.')
    directory.mkdir(mode=0o700, exist_ok=True)
    path = directory / (job_id(operation) + '.json')
    with (common.STATE_DIR / 'msfdb-ingress.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        if path.is_symlink():
            raise DatabaseError('PERMISSION_DENIED', 'Unsafe request identity.')
        record = json.loads(path.read_text()) if path.exists() else dict(request=payload, attempt=0)
        attempt = record['attempt']
        native_operation = operation if attempt == 0 else 'retry-' + hashlib.sha256((operation + ':' + str(attempt)).encode()).hexdigest()[:48]
        identity = job_id(native_operation)
        existing = load_job(identity, native_operation)
        if payload['verb'] == 'poll':
            if existing is None:
                raise DatabaseError('JOB_NOT_FOUND', 'No acknowledged attempt; resubmit the same operation identity.')
            return public_state(existing)
        if record['request'] != payload:
            raise DatabaseError('INVALID_PAYLOAD', 'Operation identity already belongs to different parameters.')
        if existing:
            if existing['request']['task'] != {'type': 'msfdb', **payload}:
                raise DatabaseError('INVALID_PAYLOAD', 'Operation identity already belongs to different parameters.')
            if not retry or existing['status'] not in {'failed', 'cancelled'}:
                return public_state(existing)
            record['attempt'] += 1
            native_operation = 'retry-' + hashlib.sha256((operation + ':' + str(record['attempt'])).encode()).hexdigest()[:48]
            identity = job_id(native_operation)
        common.atomic_write(path, json.dumps(record).encode())
        request = dict(jobId=identity, projectId='system-onboarding', operationId=native_operation, timeoutMs=180000, task={'type': 'msfdb', **payload})
        process = subprocess.Popen([sys.executable, str(Path(__file__).with_name('workstation-run')), '--request-json', json.dumps(request)],
            stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)
        for _ in range(100):
            existing = load_job(identity, native_operation)
            if existing:
                return public_state(existing)
            if process.poll() is not None:
                break
            time.sleep(.02)
        raise DatabaseError('JOB_FAILED', 'Worker did not acknowledge this operation. Inspect state before retrying.')


def load_entry(name):
    loader = SourceFileLoader(name.replace('-', '_'), str(Path(__file__).with_name(name)))
    spec = importlib.util.spec_from_loader(loader.name, loader)
    module = importlib.util.module_from_spec(spec)
    loader.exec_module(module)
    return module


def configure(db):
    result = load_entry('workstation-msf-config').configure((db.root / 'msf.secret').read_text().strip())
    if not result.get('ok'):
        raise DatabaseError(result.get('errorKey', 'METASPLOIT_UNAVAILABLE'), result.get('detail', 'Configuration failed.'))


def verify():
    verifier = load_entry('workstation-msf-verify')
    ok, key, fields = verifier.interpret_db_status(verifier.run_db_status())
    if not ok:
        raise DatabaseError(key, fields.get('detail', 'Framework verification failed.'))
    return fields


def perform(payload):
    payload = parse(payload)
    db = ManagedDatabase()
    verb = payload['verb']
    operation = payload['operationId']
    if verb in {'delete', 'reinit', 'prepare-delete', 'prepare-reinit'}:
        from workstation_msfdb_maintenance import maintenance
        return maintenance(db, payload)
    if verb == 'rollback':
        return db.invoke(dict(profileId='termux-local', operationId=operation, operation='rollback', rollbackId=payload['rollbackId'], confirmReplace=True))
    # Composite init/restart execute under one lifecycle lock; no nested invoke.
    with db.lock():
        if verb == 'status':
            health = db.health()
            if health.get('authenticatedQueryOk'):
                db.verify_identity()
            # The base database probe cannot determine Framework schema readiness.
            health.pop('schemaReady', None)
            return dict(health, running=health.get('serverReachable', False),
                        frameworkCheck='not checked (use msfdb check; Framework may migrate its schema)')
        if verb in {'start', 'stop', 'restart'}:
            if verb in {'stop', 'restart'}:
                db.perform({'operation': 'stop'})
            return db.start() if verb != 'stop' else {'running': False}
        if verb == 'init':
            credential = db.root / 'msf.secret'
            if not credential.is_file():
                raise DatabaseError('DATABASE_CREDENTIALS_INVALID', 'Complete Oni setup/credential pairing before msfdb init.')
            db.initialize(credential.read_text().strip())
            with common.framework_session_lock():
                configure(db)
        elif verb == 'run':
            db.start()
        else:
            db.health()
        db.verify_identity()
        return dict(verify(), running=True, authenticatedQueryOk=True)


def main():
    try:
        payload = json.loads(sys.argv[1])
        result = {'ok': True, **perform(payload)}
    except DatabaseError as error:
        result = common.json_error(error.key, error.detail)
    except BlockingIOError:
        result = common.json_error('DATABASE_BUSY', 'Close managed Framework consoles before maintenance.')
    except (OSError, ValueError, KeyError, subprocess.TimeoutExpired):
        result = common.json_error('DATABASE_RECOVERY_REQUIRED', 'Operation could not complete safely. Inspect managed state; existing data was preserved.')
    print(json.dumps(result))
    return 0 if result.get('ok') else 1


if __name__ == '__main__':
    raise SystemExit(main())

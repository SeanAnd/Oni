"""Bounded Nmap execution, durable results, and acknowledged process cancellation."""
from __future__ import annotations

import fcntl
import ipaddress
import json
import os
import signal
import resource
import subprocess
import time
import uuid
from contextlib import contextmanager
from pathlib import Path

import workstation_common as common

TERMINAL = {"completed", "failed", "cancelled"}
MAX_ARTIFACT_BYTES = 5 * 1024 * 1024


def parse_request(raw: str):
    try:
        payload = json.loads(raw)
        if not isinstance(payload, dict) or set(payload) - {"jobId", "projectId", "operationId", "command", "timeoutMs", "task"}:
            raise ValueError()
        for field in ("jobId", "projectId", "operationId"):
            if common.validate_id(payload.get(field), field):
                raise ValueError()
        timeout = payload.get("timeoutMs", 120000)
        if type(timeout) is not int or not 15000 <= timeout <= (7200000 if isinstance(payload.get("task"), dict) and payload["task"].get("type") == "setup.nethunter" else 180000):
            raise ValueError()
        payload["timeoutMs"] = timeout
        task = payload.get("task")
        if task is not None:
            if "command" in payload or not isinstance(task, dict):
                raise ValueError()
            if task.get('type') == 'msfdb':
                from workstation_msfdb import parse
                from workstation_database import DatabaseError
                try:
                    parse({k: v for k, v in task.items() if k != 'type'})
                    return payload, None
                except DatabaseError:
                    raise ValueError()
            if task == {"type": "setup.nethunter", "catalogId": "kali-2026.2-minimal-arm64-v1"}:
                return payload, None
            if task == {"type": "kali.health"}:
                return payload, None
            if task.get("type") == "metasploit.prepare" and set(task) == {"type", "profileId"} and task["profileId"] in {"termux-local"}:
                return payload, None
            if task.get("type") == "database" and set(task) <= {"type", "operation", "profileId", "backupId", "confirmReplace", "rollbackId", "databaseOperationId"}:
                from workstation_database import parse_request as parse_database, DatabaseError
                try:
                    db_request = {k: v for k, v in task.items() if k not in {"type", "databaseOperationId"}}
                    db_request["operationId"] = task.get("databaseOperationId", payload["operationId"])
                    if db_request.get("operation") == "initialize":
                        db_request["password"] = "x" * 32  # validate shape, resolve real secret only in private worker
                    parse_database(json.dumps(db_request))
                    return payload, None
                except DatabaseError:
                    raise ValueError()
            raise ValueError()
        command = payload["command"]
        if not isinstance(command, dict) or set(command) - {"binary", "args", "cwd"} or command.get("cwd") is not None:
            raise ValueError()
        args = command["args"]
        if command["binary"] != "nmap" or not isinstance(args, list) or common.validate_args(args):
            raise ValueError()
        if args != ["--version"]:
            if len(args) not in (9, 10) or args[:5] != ["--unprivileged", "-sT", "-Pn", "-n", "-p"] or args[6:8] != ["-oX", "-"]:
                raise ValueError()
            if len(args) == 10 and args[8] != "-sV":
                raise ValueError()
            if len(args) not in (9, 10):
                raise ValueError()
            ports = set()
            for token in args[5].split(","):
                parts = token.split("-")
                if len(parts) not in (1, 2) or any(not p.isascii() or not p.isdecimal() or len(p) > 5 for p in parts):
                    raise ValueError()
                start, end = int(parts[0]), int(parts[-1])
                if not 1 <= start <= end <= 65535 or end - start >= 32:
                    raise ValueError()
                ports.update(range(start, end + 1))
            if not 1 <= len(ports) <= 32:
                raise ValueError()
            network = ipaddress.ip_network(args[-1], strict=False)
            if network.version != 4 or network.num_addresses > 16:
                raise ValueError()
        timeout = payload.get("timeoutMs", 120000)
        if type(timeout) is not int or not 15000 <= timeout <= 180000:
            raise ValueError()
        payload["timeoutMs"] = timeout
        return payload, None
    except (ValueError, TypeError, KeyError):
        return None, "Expected a bounded rootless Nmap request with job, project, and operation identifiers."


@contextmanager
def job_lock(job_id):
    common.ensure_layout()
    with (common.JOBS_DIR / f"{job_id}.lock").open("a") as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        yield


def read_state(job_id):
    path = common.JOBS_DIR / f"{job_id}.json"
    if not path.exists():
        return None
    return json.loads(path.read_text())


def write_state(job_id, state):
    common.atomic_write(common.JOBS_DIR / f"{job_id}.json", json.dumps(state, sort_keys=True).encode())


def process_identity(pid):
    try:
        # Linux/Android start ticks prevent signalling a recycled process id.
        fields = Path(f"/proc/{pid}/stat").read_text().rsplit(")", 1)[1].split()
        return None if fields[0] == "Z" else fields[19]
    except (OSError, IndexError):
        return None


def terminate_group(pid, identity):
    if not identity or process_identity(pid) != identity:
        return
    try:
        os.killpg(pid, signal.SIGKILL)
    except ProcessLookupError:
        pass


def load_job(job_id, operation_id):
    with job_lock(job_id):
        state = read_state(job_id)
        if state is None or state["operationId"] != operation_id:
            return None
        if state["status"] not in TERMINAL and process_identity(state["workerPid"]) != state["workerIdentity"]:
            terminate_group(state.get("processPid", 0), state.get("processIdentity"))
            state.update(status="failed", ok=False, errorKey="JOB_FAILED", detail="Execution worker exited before recording a result.")
            write_state(job_id, state)
        return state


def cancel_job(job_id, operation_id):
    with job_lock(job_id):
        state = read_state(job_id)
        if state is None or state["operationId"] != operation_id:
            return None
        if state["status"] not in TERMINAL:
            state["cancelRequested"] = True
            write_state(job_id, state)
    deadline = time.monotonic() + 4
    while time.monotonic() < deadline:
        state = load_job(job_id, operation_id)
        if state is None or state["status"] in TERMINAL:
            return state
        time.sleep(.05)
    return state  # A pending request is never reported as a completed cancellation.


def publish_backup_artifact(request, result, artifact_id):
    import shutil
    from workstation_database import ManagedDatabase, DatabaseError
    backup_id = result.get('backupId', '')
    if common.validate_id(backup_id, 'backupId'):
        raise DatabaseError('ARTIFACT_INTEGRITY_FAILED', 'Invalid backup identity.')
    source = ManagedDatabase().backups / (backup_id + '.dump')
    if source.is_symlink() or source.stat().st_size != result['size'] or common.sha256_file(source) != result['sha256']:
        raise DatabaseError('ARTIFACT_INTEGRITY_FAILED', 'Backup identity or bytes changed.')
    if shutil.disk_usage(common.ARTIFACT_DIR).free < result['size'] + 16 * 1024 * 1024:
        raise DatabaseError('STORAGE_FULL', 'Insufficient artifact storage.')
    partial = common.ARTIFACT_DIR / f'{artifact_id}.partial'
    final = common.ARTIFACT_DIR / f'{artifact_id}.log'
    try:
        # Android Python does not expose os.link. Copy in bounded chunks, then publish atomically.
        with source.open('rb') as source_stream, partial.open('xb') as destination:
            os.chmod(partial, 0o600)
            shutil.copyfileobj(source_stream, destination, length=65536)
            destination.flush()
            os.fsync(destination.fileno())
        if common.sha256_file(partial) != result['sha256']:
            raise DatabaseError('ARTIFACT_INTEGRITY_FAILED', 'Backup copy failed integrity verification.')
        partial.replace(final)
        common.atomic_write(common.ARTIFACT_DIR / f'{artifact_id}.json', json.dumps(dict(operationId=request['operationId'], projectId=request['projectId'], jobId=request['jobId'], sha256=result['sha256'], size=result['size'])).encode())
    finally:
        partial.unlink(missing_ok=True)


def execute(request):
    common.ensure_layout()
    job_id = request["jobId"]
    with job_lock(job_id):
        existing = read_state(job_id)
        if existing:
            if existing.get("request") != request:
                return common.json_error("INVALID_PAYLOAD", "Job identifier already belongs to another request.")
            return existing
        state = dict(request=request, jobId=job_id, projectId=request["projectId"], operationId=request["operationId"], status="running", ok=True, workerPid=os.getpid(), workerIdentity=process_identity(os.getpid()), artifactIds=[])
        write_state(job_id, state)
    task = request.get("task")
    if task and task['type'] == 'setup.nethunter':
        from workstation_setup import execute_setup
        return execute_setup(request)
    if task and task["type"] == "kali.health":
        argv = common.nh_argv("sh", ["-c", "uname -m && test -r /etc/os-release && cat /etc/os-release"])
    elif task and task["type"] == "metasploit.prepare":
        import sys
        argv = [sys.executable, str(Path(__file__).with_name("workstation-msf-verify")), "--json", "--profile", task["profileId"]]
    elif task and task['type'] == 'msfdb':
        import sys
        argv = [sys.executable, str(Path(__file__).with_name('workstation_msfdb.py')), json.dumps({k: v for k, v in task.items() if k != 'type'})]
    elif task:
        import sys
        db_request = {k: v for k, v in task.items() if k not in {"type", "databaseOperationId"}}
        db_request["operationId"] = task.get("databaseOperationId", request["operationId"])
        argv = [sys.executable, str(Path(__file__).with_name("workstation-db")), "--job-request-json", json.dumps(db_request)]
    else:
        argv = common.nh_argv("nmap", request["command"]["args"])
    artifact_id = str(uuid.uuid4())
    partial = common.ARTIFACT_DIR / f"{artifact_id}.partial"
    process = None
    error_key = None
    cancelled = False
    try:
        with partial.open("wb") as output:
            process = subprocess.Popen(argv, env={**os.environ, **({"SKID_SUPERVISED": "1"} if task and task["type"] in {"metasploit.prepare", "msfdb"} else {})}, stdout=output, stderr=subprocess.DEVNULL, start_new_session=True, preexec_fn=(lambda: resource.setrlimit(resource.RLIMIT_FSIZE, (MAX_ARTIFACT_BYTES, MAX_ARTIFACT_BYTES))) if task is None else None)
            with job_lock(job_id):
                state = read_state(job_id)
                state.update(processPid=process.pid, processIdentity=process_identity(process.pid))
                write_state(job_id, state)
            deadline = time.monotonic() + request["timeoutMs"] / 1000
            while process.poll() is None:
                with job_lock(job_id):
                    cancelled = bool(read_state(job_id).get("cancelRequested"))
                if cancelled or time.monotonic() >= deadline or partial.stat().st_size > MAX_ARTIFACT_BYTES:
                    error_key = "JOB_TIMEOUT" if time.monotonic() >= deadline else "PARSER_FAILED"
                    terminate_group(process.pid, state["processIdentity"])
                    process.wait(timeout=5)
                    break
                time.sleep(.05)
            if partial.stat().st_size > MAX_ARTIFACT_BYTES:
                output.truncate(MAX_ARTIFACT_BYTES)
                error_key = "PARSER_FAILED"
    except FileNotFoundError:
        error_key = "NETHUNTER_NOT_FOUND"
    except (OSError, subprocess.SubprocessError):
        error_key = "JOB_FAILED"
    finally:
        if process is not None and process.poll() is None:
            terminate_group(process.pid, state.get("processIdentity"))
            process.wait(timeout=5)
    is_scan = task is None and request["command"]["args"] != ["--version"]
    database_result = None
    if task and task["type"] in {"database", "metasploit.prepare", "msfdb"} and partial.exists():
        try:
            database_result = json.loads(partial.read_text())
            if not database_result.get("ok"):
                error_key = database_result.get("errorKey", "DATABASE_UNAVAILABLE")
        except (ValueError, OSError):
            error_key = "PARSER_FAILED"
    artifact_ids = []
    if partial.exists() and is_scan:
        final = common.ARTIFACT_DIR / f"{artifact_id}.log"
        partial.replace(final)
        common.atomic_write(common.ARTIFACT_DIR / f"{artifact_id}.json", json.dumps(dict(operationId=request["operationId"], projectId=request["projectId"], jobId=job_id, sha256=common.sha256_file(final), size=final.stat().st_size)).encode())
        artifact_ids = [artifact_id]
    else:
        partial.unlink(missing_ok=True)
    if database_result and database_result.get('ok') and task.get('operation') == 'backup':
        from workstation_database import DatabaseError
        try:
            publish_backup_artifact(request, database_result, artifact_id)
            artifact_ids = [artifact_id]
        except (OSError, DatabaseError) as error:
            error_key = error.key if isinstance(error, DatabaseError) else 'STORAGE_FULL'
            database_result.update(ok=False, errorKey=error_key, detail='The private backup is retained, but its export artifact could not be published. Check available storage and retry.')
    code = process.returncode if process else None
    with job_lock(job_id):
        state = read_state(job_id)
        # Completion wins if it was already observed; cancellation is acknowledged only after exit.
        status = "cancelled" if cancelled else "completed" if error_key is None and code == 0 else "failed"
        state.update(status=status, ok=status == "completed", exitCode=code, artifactIds=artifact_ids, observationsPending=is_scan and status == "completed", errorKey=None if status in {"completed", "cancelled"} else error_key or ("TOOL_NOT_FOUND" if code == 127 else "JOB_FAILED"))
        if database_result is not None:
            state["databaseResult"] = database_result
        write_state(job_id, state)
        return state


def public_state(state):
    return {key: value for key, value in state.items() if key not in {"request", "workerPid", "workerIdentity", "processPid", "processIdentity", "cancelRequested"}}

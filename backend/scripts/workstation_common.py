#!/usr/bin/env python3
"""Shared validation and path helpers for Termux workstation wrappers."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import shlex
import tempfile
from pathlib import Path
from typing import Any

def _workstation_home() -> Path:
    override = os.environ.get("SKID_WORKSTATION_HOME")
    if override:
        return Path(override).expanduser()
    return Path.home() / ".rootless-workstation"


WORKSTATION_HOME = _workstation_home()
BIN_DIR = WORKSTATION_HOME / "bin"
STATE_DIR = WORKSTATION_HOME / "state"
LOG_DIR = WORKSTATION_HOME / "logs"
ARTIFACT_DIR = WORKSTATION_HOME / "artifacts"
JOBS_DIR = STATE_DIR / "jobs"


def rebind_workstation_home(path: Path) -> None:
    """Test hook: point layout paths at a disposable directory."""
    global WORKSTATION_HOME, BIN_DIR, STATE_DIR, LOG_DIR, ARTIFACT_DIR, JOBS_DIR
    WORKSTATION_HOME = path
    BIN_DIR = WORKSTATION_HOME / "bin"
    STATE_DIR = WORKSTATION_HOME / "state"
    LOG_DIR = WORKSTATION_HOME / "logs"
    ARTIFACT_DIR = WORKSTATION_HOME / "artifacts"
    JOBS_DIR = STATE_DIR / "jobs"

ID_PATTERN = re.compile(r"^[A-Za-z0-9._-]+$")
MAX_ID_LENGTH = 128
MAX_ARG_LENGTH = 4096
MAX_ARGS = 64
HELPER_VERSION = "1.3.1"
HELPER_PORT = 28765


def ensure_layout() -> None:
    for path in (BIN_DIR, STATE_DIR, LOG_DIR, ARTIFACT_DIR, JOBS_DIR):
        path.mkdir(mode=0o700, parents=True, exist_ok=True)
        path.chmod(0o700)


def read_helper_token() -> str | None:
    token_path = STATE_DIR / "helper_token"
    if not token_path.is_file():
        return None
    token = token_path.read_text(encoding="utf-8").strip()
    return token or None


def write_helper_token(token: str) -> None:
    ensure_layout()
    token_path = STATE_DIR / "helper_token"
    atomic_write(token_path, token.strip().encode())


def validate_id(value: str, field: str) -> str | None:
    if not isinstance(value, str) or not value or value in {".", ".."}:
        return f"{field} must be non-empty"
    if len(value) > MAX_ID_LENGTH:
        return f"{field} exceeds maximum length"
    if not ID_PATTERN.fullmatch(value):
        return f"{field} contains invalid characters"
    return None


def validate_args(args: list[Any]) -> str | None:
    if len(args) > MAX_ARGS:
        return "args exceeds maximum length"
    for arg in args:
        if not isinstance(arg, str):
            return "args must be strings"
        if len(arg) > MAX_ARG_LENGTH:
            return "arg exceeds maximum length"
        if "\x00" in arg:
            return "arg contains invalid characters"
    return None


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(65536), b""):
            digest.update(chunk)
    return digest.hexdigest()


def resolve_nh_path() -> Path | None:
    candidate = os.environ.get("NH_PATH") or shutil.which("nh")
    if candidate and Path(candidate).is_file() and os.access(candidate, os.X_OK):
        return Path(candidate)
    return None


def nh_argv(binary: str, args: list[str]) -> list[str]:
    launcher = resolve_nh_path()
    if launcher is None:
        raise FileNotFoundError("NetHunter launcher missing")
    # Official nh launches bash -c "$*". Preserve argument boundaries at that
    # one shell boundary; callers still supply allowlisted structured arguments.
    return [str(launcher), shlex.join([binary, *args])]


def atomic_write(path: Path, data: bytes) -> None:
    descriptor, temporary = tempfile.mkstemp(prefix=".skid-", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        Path(temporary).unlink(missing_ok=True)


def json_error(error_key: str, detail: str, **extra: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {"ok": False, "errorKey": error_key, "detail": detail}
    payload.update(extra)
    return payload


def json_ok(**extra: Any) -> dict[str, Any]:
    payload: dict[str, Any] = {"ok": True}
    payload.update(extra)
    return payload

def run_kali(binary, args, *, timeout=30, input=None):
    """Run a fixed probe with a deadline that also terminates launcher descendants."""
    import subprocess
    import signal
    process = subprocess.Popen(nh_argv(binary, args), stdin=subprocess.PIPE if input is not None else subprocess.DEVNULL,
                               stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, start_new_session=os.environ.get("SKID_SUPERVISED") != "1")
    try:
        stdout, stderr = process.communicate(input, timeout=timeout)
        return subprocess.CompletedProcess(process.args, process.returncode, stdout, stderr)
    except subprocess.TimeoutExpired:
        try:
            os.killpg(os.getpgrp() if os.environ.get("SKID_SUPERVISED") == "1" else process.pid, signal.SIGKILL)
        except ProcessLookupError:
            pass
        process.communicate()
        raise

# Resolve the configuration path inside Kali, never in Termux's different HOME.
def msf_exec_program(profile, staging=None):
    if profile not in {'termux-local'}:
        raise ValueError('Invalid profile')
    if staging is not None and not re.fullmatch(r'skid_stage_[a-f0-9]{16}', staging):
        raise ValueError('Invalid managed staging identity')
    # The selected profile is fixed before entering Kali. A missing local config never falls back.
    program = """import os,pathlib,sys,json,configparser,runpy
d=pathlib.Path.home()/'.msf4'
p=d/'skid-termux-local.json'
guard=d/'oni-managed/config.py'
if guard.exists():
    p=runpy.run_path(str(guard))['validate_launch']()
else:
    cfg=json.loads(p.read_text())['production']
    assert cfg.get('adapter')=='postgresql' and cfg.get('host')=='127.0.0.1' and cfg.get('port')==5432 and cfg.get('username')=='msf' and cfg.get('database')=='msf', 'Managed database configuration mismatch'
    saved=configparser.ConfigParser(interpolation=None,strict=False)
    saved.read(d/'config')
    assert not saved.get('framework/database','default_db',fallback=''), 'Saved Framework default requires msfdb init'
    for key,allowed in [('MSF_DATABASE_CONFIG',{p,d/'database.yml'}),('MSF_CFGROOT_CONFIG',{d})]:
        value=os.environ.get(key)
        assert not value or pathlib.Path(value).expanduser() in allowed, 'Framework environment conflicts with Oni'
"""
    if staging is None:
        return program + "os.execvp('msfconsole',['msfconsole','-q','-y',str(p),*sys.argv[1:]])\n"
    # Fresh Framework startup initializes schema and workspace state together.
    # A separate private config root excludes saved defaults pointing back to msf.
    return program + "import tempfile,subprocess\ncfg=json.loads(p.read_text())\ncfg['production']['database']=" + repr(staging) + "\n" + """(d/'oni-managed').mkdir(mode=0o700,exist_ok=True)
with tempfile.TemporaryDirectory(prefix='staging-probe-',dir=d/'oni-managed') as temporary:
    config=pathlib.Path(temporary)/'database.yml'
    fd=os.open(config,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
    with os.fdopen(fd,'w') as stream: json.dump(cfg,stream)
    environment={**os.environ,'MSF_CFGROOT_CONFIG':temporary}
    environment.pop('MSF_DATABASE_CONFIG',None)
    code=subprocess.call(['msfconsole','-q','-y',str(config),*sys.argv[1:]],env=environment)
sys.exit(code)
"""



MSF_EXEC_PROGRAM = msf_exec_program('termux-local')

from contextlib import contextmanager
import fcntl

@contextmanager
def framework_session_lock(exclusive=True):
    """A live managed console holds a shared lock through exec; config/switch use exclusive."""
    ensure_layout()
    with (STATE_DIR / 'framework-session.lock').open('a') as stream:
        fcntl.flock(stream, (fcntl.LOCK_EX if exclusive else fcntl.LOCK_SH) | fcntl.LOCK_NB)
        os.set_inheritable(stream.fileno(), True)
        yield stream

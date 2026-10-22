"""Single-session, authenticated device-local PTY. Terminal bytes are never logged."""
import base64
import hashlib
import hmac
import json
import os
from pathlib import Path
import pty
import secrets
import select
import signal
import struct
import termios
import threading
import time
import fcntl
from http.server import BaseHTTPRequestHandler
from loopback_http import BoundedHTTPServer

PORT = 28766
MAX_INPUT = 16384
MAX_OUTPUT = 65536
MAX_REPLAY = 1048576
PRESETS = ('termux', 'kali', 'metasploit')


def detect_presets():
    import workstation_common as common
    import subprocess
    prefix = os.environ.get('PREFIX', '/data/data/com.termux/files/usr')
    if not os.access(prefix + '/bin/bash', os.X_OK):
        return []
    presets = ['termux']
    if common.resolve_nh_path() is not None:
        presets.append('kali')
        try:
            probe = common.run_kali('sh', ['-c', 'command -v python3 >/dev/null && command -v msfconsole >/dev/null'], timeout=5)
            if probe.returncode == 0:
                presets.append('metasploit')
        except (OSError, subprocess.TimeoutExpired):
            pass
    return presets


def preset_argv(preset):
    from workstation_common import nh_argv
    if preset == 'termux':
        prefix = os.environ.get('PREFIX', '/data/data/com.termux/files/usr')
        return [prefix + '/bin/bash', '-i']
    if preset == 'kali':
        return nh_argv('env', ['HISTFILE=/dev/null', 'TERM=xterm-256color', 'bash', '-i'])
    if preset == 'metasploit':
        # Reuse the managed profile validation and lifetime Framework lock.
        import sys
        return [sys.executable, str(Path(__file__).with_name('workstation-msf-console-launch')),
                '--profile', 'termux-local', '--no-history']
    raise ValueError('Unsupported terminal preset')

class TerminalError(Exception):
    pass

class Session:
    def __init__(self, grant, session_id, argv, cwd, env):
        self.grant, self.id = grant, session_id
        self.lock = threading.RLock()
        self.buffer = bytearray()
        self.base = self.end = self.sequence = 0
        self.last_digest = None
        self.last_complete = False
        self.close_groups = set()
        self.exit_code = None
        self.closed = False
        self.pid, self.fd = pty.fork()
        if self.pid == 0:
            try:
                os.chdir(cwd)
                os.execvpe(argv[0], argv, env)
            except Exception:
                os._exit(127)
        os.set_blocking(self.fd, False)
        threading.Thread(target=self._reader, daemon=True).start()

    def _reader(self):
        try:
            while not self.closed:
                if select.select([self.fd], [], [], .2)[0]:
                    try: data = os.read(self.fd, MAX_OUTPUT)
                    except OSError: break
                    if not data: break
                    with self.lock:
                        self.buffer.extend(data)
                        self.end += len(data)
                        if len(self.buffer) > MAX_REPLAY:
                            trim = len(self.buffer) - MAX_REPLAY
                            del self.buffer[:trim]
                            self.base += trim
        finally:
            _, status = os.waitpid(self.pid, 0)
            with self.lock:
                self.exit_code = os.waitstatus_to_exitcode(status)
                self.closed = True
                os.close(self.fd)

    def request(self, payload):
        if payload.get('sessionId') != self.id: raise TerminalError('TERMINAL_SESSION_LOST')
        op = payload.get('operation')
        with self.lock:
            if op == 'read':
                offset = payload.get('offset', 0)
                if type(offset) is not int or offset < 0 or offset > self.end: raise TerminalError('INVALID_PAYLOAD')
                gap = offset < self.base
                offset = max(offset, self.base)
                data = bytes(self.buffer[offset-self.base:offset-self.base+MAX_OUTPUT])
                return dict(ok=True, sessionId=self.id, data=base64.b64encode(data).decode(), offset=offset, nextOffset=offset+len(data), gap=gap, running=not self.closed, drained=offset+len(data)==self.end, exitCode=self.exit_code, sequence=self.sequence)
            if op == 'write':
                sequence = payload.get('sequence')
                try: data = base64.b64decode(payload.get('data', ''), validate=True)
                except (ValueError, TypeError): raise TerminalError('INVALID_PAYLOAD')
                if not 0 < len(data) <= MAX_INPUT or type(sequence) is not int: raise TerminalError('INVALID_PAYLOAD')
                digest = hashlib.sha256(data).digest()
                if sequence == self.sequence and hmac.compare_digest(digest, self.last_digest or b''):
                    if not self.last_complete: raise TerminalError('TERMINAL_INPUT_INTERRUPTED')
                    return dict(ok=True, sequence=self.sequence)
                if self.closed: raise TerminalError('TERMINAL_SESSION_LOST')
                if sequence != self.sequence + 1: raise TerminalError('TERMINAL_INPUT_ORDER')
                # Reserve sequence before writing: an interrupted write is never replayed.
                self.sequence, self.last_digest = sequence, digest
                self.last_complete = False
                end = time.monotonic()+2
                sent = 0
                while sent < len(data):
                    if time.monotonic() > end: raise TerminalError('TERMINAL_INPUT_INTERRUPTED')
                    if select.select([], [self.fd], [], .1)[1]:
                        try: sent += os.write(self.fd, data[sent:])
                        except BlockingIOError: continue
                self.last_complete = True
                return dict(ok=True, sequence=self.sequence)
            if op == 'resize':
                rows, columns = payload.get('rows'), payload.get('columns')
                if type(rows) is not int or type(columns) is not int or not 2 <= rows <= 300 or not 2 <= columns <= 500: raise TerminalError('INVALID_PAYLOAD')
                if not self.closed: fcntl.ioctl(self.fd, termios.TIOCSWINSZ, struct.pack('HHHH', rows, columns, 0, 0))
                return dict(ok=True)
            if op == 'close':
                if not self.closed:
                    # Only our child session/process group, never a PID supplied by the caller.
                    try:
                        foreground = os.tcgetpgrp(self.fd)
                        if foreground > 0 and foreground != self.pid:
                            self.close_groups.add(foreground)
                            os.killpg(foreground, signal.SIGHUP)
                    except OSError: pass
                    try: os.killpg(self.pid, signal.SIGHUP)
                    except ProcessLookupError: pass
                    threading.Thread(target=self._finish_close, daemon=True).start()
                return dict(ok=True)
            raise TerminalError('INVALID_PAYLOAD')

    def _finish_close(self):
        time.sleep(1)
        with self.lock:
            if not self.closed:
                for group in self.close_groups | {self.pid}:
                    try:
                        if os.getsid(group) == self.pid: os.killpg(group, signal.SIGKILL)
                    except ProcessLookupError: pass

class Handler(BaseHTTPRequestHandler):
    def setup(self):
        super().setup()
        self.connection.settimeout(3)
    def log_message(self, *_): pass
    def do_POST(self):
        session = self.server.session
        status, response = 200, None
        try:
            self.connection.settimeout(3)
            provided = self.headers.get('Authorization', '')
            if not secrets.compare_digest(provided, 'Bearer '+session.grant):
                status = 403
                raise TerminalError('PERMISSION_DENIED')
            if self.path != '/v1/terminal' or self.headers.get('Transfer-Encoding'): raise TerminalError('INVALID_PAYLOAD')
            length = int(self.headers.get('Content-Length', 0))
            if not 0 < length <= 24576: raise TerminalError('INVALID_PAYLOAD')
            payload = json.loads(self.rfile.read(length))
            if not isinstance(payload, dict): raise TerminalError('INVALID_PAYLOAD')
            response = session.request(payload)
        except TerminalError as error:
            response = dict(ok=False, errorKey=str(error))
        except (OSError, ValueError, TypeError):
            response = dict(ok=False, errorKey='TERMINAL_TRANSPORT_FAILED')
        raw = json.dumps(response).encode()
        self.send_response(status);self.send_header('Content-Type','application/json');self.send_header('Content-Length',str(len(raw)));self.end_headers()
        try: self.wfile.write(raw)
        except OSError: pass
        if response.get('ok') and payload.get('operation') == 'close':
            threading.Thread(target=self.server.shutdown, daemon=True).start()


def serve(config):
    argv = preset_argv(config['preset'])
    env = {k:v for k,v in os.environ.items() if not k.startswith(('PG', 'SKID_', 'ONI_'))}
    env.update(TERM='xterm-256color', COLORTERM='truecolor', HISTFILE='/dev/null')
    server = BoundedHTTPServer(('127.0.0.1', PORT), Handler)
    server.session = Session(config['grant'], config['sessionId'], argv, os.path.expanduser('~'), env)
    server.serve_forever()
    server.session._finish_close()
    server.server_close()

"""Serve synthetic artifacts through the real helper in a disposable Termux home.

Instrumentation only: no Kali substitute, production token, or persistent state.
The server expires after 20 seconds even if the Android test process dies.
"""
import hashlib
from importlib.machinery import SourceFileLoader
from importlib.util import module_from_spec, spec_from_loader
import json
import os
from pathlib import Path
import sys
import tempfile
import time

os.umask(0o077)
port = int(sys.argv[1])
if not 1024 <= port <= 65535:
    raise SystemExit(64)
token = sys.stdin.read().strip()
if len(token) != 64:
    raise SystemExit(64)

# Read the installed, checksum-verified production implementation.
sys.path.insert(0, str(Path.home() / '.rootless-workstation/bin'))
with tempfile.TemporaryDirectory(prefix='skid-helper-acceptance-') as temporary:
    os.environ['SKID_WORKSTATION_HOME'] = temporary
    import workstation_common as common
    loader = SourceFileLoader('workstation_helper', str(Path.home() / '.rootless-workstation/bin/workstation-helper'))
    spec = spec_from_loader(loader.name, loader)
    helper = module_from_spec(spec)
    loader.exec_module(helper)
    from loopback_http import BoundedHTTPServer

    common.ensure_layout()
    common.write_helper_token(token)
    data = bytes(range(256)) * 600 + 'UTF-8 boundary: € 🔐\n'.encode()
    metadata = dict(operationId='fixture-operation', size=len(data),
                    sha256=hashlib.sha256(data).hexdigest())
    (common.ARTIFACT_DIR / 'fixture-artifact.log').write_bytes(data)
    (common.ARTIFACT_DIR / 'fixture-artifact.json').write_text(json.dumps(metadata))
    for name, invalid in [('missing-hash', {'operationId': 'fixture-operation', 'size': 1}),
                          ('invalid-object', []),
                          ('invalid-hash', {**metadata, 'size': 1, 'sha256': 'invalid'})]:
        (common.ARTIFACT_DIR / f'{name}.log').write_bytes(b'x')
        (common.ARTIFACT_DIR / f'{name}.json').write_text(json.dumps(invalid))

    with BoundedHTTPServer(('127.0.0.1', port), helper.WorkstationHelperHandler) as server:
        server.timeout = 0.2
        deadline = time.monotonic() + 20
        while time.monotonic() < deadline:
            server.handle_request()
print(json.dumps({'ok': True, 'cleanedUp': True}))

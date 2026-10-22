"""Explicit device acceptance fixture: interrupt one owned artifact after 257 bytes.

Forward authentication to the real helper before injecting failure. Never install
this file in the production bootstrap or log request headers/credentials.
"""
from __future__ import annotations

import argparse
import http.client
import json
import os
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--artifact-id', required=True)
    parser.add_argument('--state-dir', type=Path, required=True)
    args = parser.parse_args()
    os.umask(0o077)
    args.state_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    lock = threading.Lock()
    routes = {'/v1/workstation/artifacts/chunk', '/v1/workstation/jobs/status', '/v1/workstation/jobs/cancel'}

    class Handler(BaseHTTPRequestHandler):
        def log_message(self, *_):
            pass

        def do_POST(self):
            connection = None
            try:
                self.connection.settimeout(10)
                length = int(self.headers.get('Content-Length', '-1'))
                if self.path not in routes or not 0 <= length <= 16384:
                    self.send_error(400)
                    return
                payload = json.loads(self.rfile.read(length))
                target = self.path.endswith('/chunk') and payload.get('artifactId') == args.artifact_id
                offset = payload.get('offset')
                if target and offset == 0:
                    payload['limit'] = min(payload.get('limit', 257), 257)
                connection = http.client.HTTPConnection('127.0.0.1', 28766, timeout=10)
                connection.request('POST', self.path, json.dumps(payload), {
                    'Content-Type': 'application/json',
                    'Authorization': self.headers.get('Authorization', ''),
                })
                upstream = connection.getresponse()
                status = upstream.status
                data = upstream.read(131073)
                if len(data) > 131072:
                    raise ValueError('Oversized upstream result')
                if target and status == 200:
                    with lock:
                        with (args.state_dir / 'offsets.jsonl').open('a') as stream:
                            stream.write(json.dumps({'offset': offset, 'resumed': (args.state_dir / 'resume').exists()}) + '\n')
                    if offset >= 257 and not (args.state_dir / 'resume').exists():
                        status = 503
                        data = b'{"ok":false,"errorKey":"CAPABILITY_UNAVAILABLE"}'
                self.send_response(status)
                self.send_header('Content-Type', 'application/json')
                self.send_header('Content-Length', str(len(data)))
                self.end_headers()
                self.wfile.write(data)
            except (OSError, ValueError, TypeError, AttributeError, http.client.HTTPException):
                self.close_connection = True
            finally:
                if connection:
                    connection.close()

    server = ThreadingHTTPServer(('127.0.0.1', 28765), Handler)
    server.daemon_threads = True
    expiry = threading.Timer(300, server.shutdown)
    expiry.daemon = True
    expiry.start()
    try:
        server.serve_forever()
    finally:
        expiry.cancel()
        server.server_close()


if __name__ == '__main__':
    main()

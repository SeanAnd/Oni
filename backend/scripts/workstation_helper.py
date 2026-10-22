#!/usr/bin/env python3
"""Loopback workstation helper for job status, cancellation, and artifact chunks."""

from __future__ import annotations

import argparse
import base64
import json
import re
import secrets
import sys
import threading
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

BACKEND_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = BACKEND_ROOT / "scripts"
if str(SCRIPTS_DIR) not in sys.path:
    sys.path.insert(0, str(SCRIPTS_DIR))

from workstation_common import (  # noqa: E402
    ARTIFACT_DIR,
    HELPER_PORT,
    HELPER_VERSION,
    JOBS_DIR,
    MAX_ID_LENGTH,
    sha256_file,
    read_helper_token,
    validate_id,
)

from workstation_jobs import load_job, cancel_job, public_state
from loopback_http import BoundedHTTPServer

HOST = "127.0.0.1"
# Capture the immutable bundle directory before a later upgrade moves bin's symlink.
RELEASE_ID = Path(__file__).resolve().parent.name
ROUTE_JOBS_STATUS = "/v1/workstation/jobs/status"
ROUTE_JOBS_CANCEL = "/v1/workstation/jobs/cancel"
ROUTE_ARTIFACTS_CHUNK = "/v1/workstation/artifacts/chunk"
MAX_CHUNK = 65536
MAX_METADATA_BYTES = 4096


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_bearer(header: str | None) -> str | None:
    if not header:
        return None
    parts = header.split(None, 1)
    if len(parts) != 2 or parts[0].lower() != "bearer":
        return None
    token = parts[1].strip()
    return token or None


def authorize(header: str | None) -> bool:
    expected = read_helper_token()
    if not expected:
        return False
    provided = parse_bearer(header)
    if not provided:
        return False
    return secrets.compare_digest(provided.encode(), expected.encode())


def error_envelope(error_key: str, detail: str) -> dict[str, Any]:
    return {"ok": False, "errorKey": error_key, "detail": detail, "completedAt": utc_now_iso()}


def read_json_body(raw: bytes) -> tuple[dict[str, Any] | None, dict[str, Any] | None]:
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError):
        return None, error_envelope("INVALID_PAYLOAD", "Request body must be JSON.")
    if not isinstance(payload, dict):
        return None, error_envelope("INVALID_PAYLOAD", "Request body must be a JSON object.")
    return payload, None


def read_artifact_metadata(path: Path) -> dict[str, Any] | None:
    """Reject corrupt private metadata before serving any artifact bytes."""
    try:
        with path.open('rb') as stream:
            raw = stream.read(MAX_METADATA_BYTES + 1)
        if len(raw) > MAX_METADATA_BYTES:
            return None
        value = json.loads(raw)
        if not isinstance(value, dict) or validate_id(value.get('operationId'), 'operationId'):
            return None
        if type(value.get('size')) is not int or value['size'] < 0:
            return None
        digest = value.get('sha256')
        if not isinstance(digest, str) or re.fullmatch(r'[0-9a-f]{64}', digest) is None:
            return None
        return value
    except (OSError, ValueError, UnicodeDecodeError):
        return None


class WorkstationHelperHandler(BaseHTTPRequestHandler):
    server_version = "SKIDWorkstationHelper/1.0"

    def log_message(self, format: str, *args: Any) -> None:  # noqa: A003
        return

    def _send(self, status: int, payload: dict[str, Any]) -> None:
        body = json.dumps(payload).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def do_POST(self) -> None:  # noqa: N802
        route = urlparse(self.path).path
        if route == '/v1/workstation/msfdb':
            from workstation_msfdb import authorize as authorize_cli
            authorized = authorize_cli(parse_bearer(self.headers.get('Authorization')))
        else:
            authorized = authorize(self.headers.get('Authorization'))
        if not authorized:
            self._send(401, error_envelope("PERMISSION_DENIED", "Helper token rejected."))
            return

        route = urlparse(self.path).path
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError:
            length = 0
        if not 0 < length <= 4096 or self.headers.get("Transfer-Encoding"):
            self._send(400, error_envelope("INVALID_PAYLOAD", "Invalid body size."))
            return
        raw = self.rfile.read(length)
        payload, error = read_json_body(raw)
        if error:
            self._send(400, error)
            return
        assert payload is not None

        if route == '/v1/workstation/msfdb':
            from workstation_msfdb import dispatch
            from workstation_database import DatabaseError
            try:
                self._send(200, dispatch(payload))
            except DatabaseError as issue:
                self._send(400, error_envelope(issue.key, issue.detail))
            except (OSError, ValueError, KeyError):
                self._send(500, error_envelope('DATABASE_RECOVERY_REQUIRED', 'Unable to read managed operation state.'))
            return
        if route == "/v1/workstation/identity":
            self._send(200, {"ok": True, "service": "skid-workstation", "helperVersion": HELPER_VERSION, "releaseId": RELEASE_ID})
            return
        if route == '/v1/workstation/msfdb/jobs':
            from workstation_msfdb import list_jobs
            if payload:
                self._send(400, error_envelope('INVALID_PAYLOAD', 'This query takes no parameters.'))
                return
            self._send(200, {'ok': True, 'jobs': list_jobs()})
            return
        if route == ROUTE_JOBS_STATUS:
            self._handle_job_status(payload)
            return
        if route == ROUTE_JOBS_CANCEL:
            self._handle_job_cancel(payload)
            return
        if route == ROUTE_ARTIFACTS_CHUNK:
            self._handle_artifact_chunk(payload)
            return
        self._send(404, error_envelope("INVALID_PAYLOAD", "Unknown route."))

    def _require_ids(self, payload: dict[str, Any]) -> tuple[str, str, dict[str, Any] | None]:
        job_id = payload.get("jobId")
        operation_id = payload.get("operationId")
        if not isinstance(job_id, str) or not isinstance(operation_id, str):
            return "", "", error_envelope("INVALID_PAYLOAD", "jobId and operationId are required.")
        for field, value in (("jobId", job_id), ("operationId", operation_id)):
            issue = validate_id(value, field)
            if issue:
                return "", "", error_envelope("INVALID_PAYLOAD", issue)
        return job_id, operation_id, None

    def _handle_job_status(self, payload: dict[str, Any]) -> None:
        job_id, operation_id, error = self._require_ids(payload)
        if error:
            self._send(400, error)
            return
        state = load_job(job_id, operation_id)
        if state is None:
            self._send(404, error_envelope("JOB_NOT_FOUND", "Job/operation was not found."))
            return
        self._send(200, {**public_state(state), "ok": True})

    def _handle_job_cancel(self, payload):
        job_id, operation_id, error = self._require_ids(payload)
        if error:
            self._send(400, error)
            return
        state = cancel_job(job_id, operation_id)
        if state is None:
            self._send(404, error_envelope("JOB_NOT_FOUND", "Job/operation was not found."))
            return
        self._send(200, {**public_state(state), "ok": True})

    def _handle_artifact_chunk(self, payload: dict[str, Any]) -> None:
        artifact_id = payload.get("artifactId")
        operation_id = payload.get("operationId")
        offset = payload.get("offset")
        limit = payload.get("limit")
        if not isinstance(artifact_id, str) or not isinstance(operation_id, str):
            self._send(400, error_envelope("INVALID_PAYLOAD", "artifactId and operationId are required."))
            return
        for field, value in (("artifactId", artifact_id), ("operationId", operation_id)):
            issue = validate_id(value, field)
            if issue:
                self._send(400, error_envelope("INVALID_PAYLOAD", issue))
                return
        if type(offset) is not int or offset < 0:
            self._send(400, error_envelope("INVALID_PAYLOAD", "offset must be a non-negative integer."))
            return
        if type(limit) is not int or limit <= 0 or limit > MAX_CHUNK:
            self._send(400, error_envelope("INVALID_PAYLOAD", f"limit must be 1..{MAX_CHUNK}."))
            return
        if len(artifact_id) > MAX_ID_LENGTH:
            self._send(400, error_envelope("INVALID_PAYLOAD", "artifactId exceeds maximum length."))
            return
        artifact_path = (ARTIFACT_DIR / f"{artifact_id}.log").resolve()
        if artifact_path.parent != ARTIFACT_DIR.resolve():
            self._send(400, error_envelope("INVALID_PAYLOAD", "artifact path rejected."))
            return
        if not artifact_path.is_file():
            self._send(404, error_envelope("JOB_NOT_FOUND", "Artifact was not found."))
            return
        metadata_path = ARTIFACT_DIR / f"{artifact_id}.json"
        metadata = read_artifact_metadata(metadata_path)
        if metadata is None:
            self._send(500, error_envelope("PARSER_FAILED", "Artifact metadata is invalid or unavailable."))
            return
        if metadata.get("operationId") != operation_id:
            self._send(404, error_envelope("JOB_NOT_FOUND", "Artifact/operation was not found."))
            return
        total = artifact_path.stat().st_size
        if offset > total or total != metadata.get("size"):
            self._send(400, error_envelope("INVALID_PAYLOAD", "Artifact size or offset is invalid."))
            return
        with artifact_path.open("rb") as stream:
            stream.seek(offset)
            chunk = stream.read(limit)
        encoded = base64.b64encode(chunk).decode("ascii")
        self._send(
            200,
            {
                "ok": True,
                "operationId": operation_id,
                "artifactId": artifact_id,
                "offset": offset,
                "limit": limit,
                "totalSize": total,
                "sha256": metadata["sha256"],
                "eof": offset + len(chunk) >= total,
                "dataBase64": encoded,
                "completedAt": utc_now_iso(),
            },
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--host", default=HOST)
    parser.add_argument("--port", type=int, default=HELPER_PORT)
    args = parser.parse_args()

    if args.host != HOST:
        parser.error("Only 127.0.0.1 is allowed.")
    if read_helper_token() is None:
        print("Helper token missing; run install-termux.sh first.", file=sys.stderr)
        sys.exit(2)

    server = BoundedHTTPServer((args.host, args.port), WorkstationHelperHandler)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    print(f"workstation helper listening on http://{args.host}:{args.port}", file=sys.stderr)
    try:
        thread.join()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    main()

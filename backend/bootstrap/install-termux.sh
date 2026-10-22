#!/usr/bin/env bash
# Installs or updates the SKID Termux workstation helper bundle.
# Run inside Termux after copying the backend tree to ~/skid-backend/.
set -euo pipefail
umask 077

BOOTSTRAP_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MANIFEST="${BOOTSTRAP_DIR}/manifest.json"
SRC_ROOT="${BOOTSTRAP_DIR}/.."
HOME_WS="${HOME}/.rootless-workstation"
BIN_DIR="${HOME_WS}/bin"
LIB_DIR="${HOME_WS}/lib"
STATE_DIR="${HOME_WS}/state"

if [[ ! -f "${MANIFEST}" ]]; then
  echo "manifest.json missing next to install-termux.sh" >&2
  exit 1
fi

mkdir -p "${BIN_DIR}" "${LIB_DIR}" "${STATE_DIR}" "${HOME_WS}/logs" "${HOME_WS}/artifacts" "${STATE_DIR}/jobs"

python3 - <<'PY' "${MANIFEST}" "${SRC_ROOT}" "${BIN_DIR}" "${LIB_DIR}"
import hashlib
import json
import shutil
import sys
from pathlib import Path

manifest_path = Path(sys.argv[1])
src_root = Path(sys.argv[2])
bin_dir = Path(sys.argv[3])
lib_dir = Path(sys.argv[4])

manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
verified = []
for entry in manifest.get("scripts", []):
    rel = entry["path"]
    expected = entry["sha256"]
    source = (src_root / rel).resolve()
    if not source.is_file():
        raise SystemExit(f"missing bundle file: {source}")
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    if digest != expected:
        raise SystemExit(f"checksum mismatch for {rel}")
    name = entry["name"]
    if Path(name).name != name or not source.is_relative_to(src_root.resolve()):
        raise SystemExit("invalid bundle path")
    verified.append((source, name))
# Verify the entire bundle before installing any file. All shared Python modules
# live beside the executables so imports work on Termux without PYTHONPATH.
for source, name in verified:
    target = bin_dir / ("workstation-helper" if name == "workstation_helper.py" else name)
    temporary = target.with_suffix(".installing")
    data = source.read_bytes()
    if data.startswith(b"#!/usr/bin/env python3"):
        data = data.replace(b"#!/usr/bin/env python3", ("#!" + sys.executable).encode(), 1)
    temporary.write_bytes(data)
    temporary.chmod(0o700)
    temporary.replace(target)
print("verified and installed", len(manifest.get("scripts", [])), "files")
PY

TOKEN_FILE="${STATE_DIR}/helper_token"
if [[ ! -s "${TOKEN_FILE}" ]]; then
  python3 -c "import secrets, pathlib, sys; p=pathlib.Path(sys.argv[1]); p.write_text(secrets.token_urlsafe(32), encoding='utf-8'); p.chmod(0o600); print('generated helper token at', p)" "${TOKEN_FILE}"
fi

cat <<EOF
SKID workstation bootstrap ${HOME_WS} is ready.
Enable Termux allow-external-apps and grant RUN_COMMAND to SKID.
Start helper (required for durable job polling, cancellation, and artifacts):
  ${BIN_DIR}/workstation-helper
Health probe:
  ${BIN_DIR}/workstation-health --json
EOF

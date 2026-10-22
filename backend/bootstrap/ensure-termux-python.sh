#!/data/data/com.termux/files/usr/bin/bash
# APK-owned pre-helper bootstrap. No Python, shell startup files or user commands.
set -eu
umask 077
export PATH=/data/data/com.termux/files/usr/bin:/system/bin
unset PYTHONHOME PYTHONPATH BASH_ENV ENV
root="$HOME/.rootless-workstation/bootstrap"
action="${1:-probe}"
id="${2:-probe}"
[[ "$id" =~ ^[A-Za-z0-9._-]{1,128}$ && "$id" != . && "$id" != .. ]] || exit 2
[[ ! -L "$root" && ! -L "$root/$id" ]] || exit 2
mkdir -p "$root"
operation="$root/$id"
python_ready() { command -v python3 >/dev/null && python3 -I -c 'import json,hashlib,zipfile,ssl,sqlite3,fcntl,subprocess' >/dev/null 2>&1; }
packages_healthy() {
  local audit
  audit="$(dpkg --audit 2>/dev/null)" || return 1
  [[ -z "$audit" ]]
}
result() {
  printf '{"ok":%s,"status":"%s","phase":"%s","errorKey":%s,"operationId":"%s","exitCode":%s,"artifactIds":[]}\n' "$1" "$2" "$3" "$4" "$id" "$5" > "$operation/result.tmp"
  mv "$operation/result.tmp" "$operation/result.json"
}
probe() {
  local python=false packages=false arch ok=true error=''
  python_ready && python=true
  if command -v pkg >/dev/null && command -v dpkg >/dev/null; then packages=true; fi
  if [[ "$packages" == true ]] && ! packages_healthy; then
    ok=false
    error=',"errorKey":"SETUP_PACKAGE_REPAIR_REQUIRED"'
  fi
  arch="$(dpkg --print-architecture 2>/dev/null || true)"
  case "$arch" in aarch64|arm|x86_64|i686) ;; *) arch=unknown ;; esac
  printf '{"ok":%s,"pythonReady":%s,"packageManagerReady":%s,"architecture":"%s"%s}\n' "$ok" "$python" "$packages" "$arch" "$error"
}
worker() {
  # Linux start ticks distinguish an owned worker from a recycled PID.
  awk '{print $22}' "/proc/$BASHPID/stat" > "$operation/identity"
  echo "$BASHPID" > "$operation/pid"
  trap 'result false failed interrupted "\"SETUP_INTERRUPTED\"" 1' EXIT
  exec 9>"$root/install.lock"
  if ! flock -n 9; then result false failed waiting_for_packages '"SETUP_BUSY"' 1; trap - EXIT; return; fi
  if [[ -f "$operation/cancel" ]]; then result false cancelled stopped null 1; trap - EXIT; return; fi
  if ! packages_healthy; then result false failed package_repair '"SETUP_PACKAGE_REPAIR_REQUIRED"' 1; trap - EXIT; return; fi
  if python_ready; then result true completed ready null 0; trap - EXIT; return; fi
  result true running installing_python null null
  # apt owns its package locks. Never delete locks or interrupt dpkg on cancellation.
  if ! apt-get -o DPkg::Lock::Timeout=60 -o Acquire::Retries=2 -o Acquire::http::Timeout=30 update >"$operation/packages.log" 2>&1; then
    result false failed repository_unavailable '"SETUP_DOWNLOAD_FAILED"' 1
  elif [[ -f "$operation/cancel" ]]; then result false cancelled stopped null 1
  elif ! DEBIAN_FRONTEND=noninteractive apt-get -o DPkg::Lock::Timeout=60 -o Dpkg::Options::=--force-confold -y --no-remove install python >>"$operation/packages.log" 2>&1; then
    result false failed installing_python '"SETUP_PACKAGE_REPAIR_REQUIRED"' 1
  elif ! packages_healthy; then result false failed package_repair '"SETUP_PACKAGE_REPAIR_REQUIRED"' 1
  elif python_ready; then result true completed ready null 0
  else result false failed checking_python '"SETUP_PYTHON_UNAVAILABLE"' 1; fi
  trap - EXIT
}
case "$action" in
  probe) probe ;;
  start)
    if mkdir "$operation" 2>/dev/null; then
      date +%s > "$operation/started"
      result true running starting null null
      # Copy only this reviewed script; a later APK cannot replace a running worker.
      cp "$0" "$operation/worker.sh"
      nohup bash --noprofile --norc "$operation/worker.sh" worker "$id" </dev/null >/dev/null 2>&1 &
    fi
    cat "$operation/result.json"
    ;;
  worker) worker ;;
  status|cancel)
    if [[ ! -f "$operation/result.json" ]]; then printf '{"ok":false,"errorKey":"JOB_NOT_FOUND"}\n'; exit 0; fi
    [[ "$action" != cancel ]] || touch "$operation/cancel"
    if [[ -f "$operation/pid" ]] && [[ "$(cat "$operation/result.json")" == *'"status":"running"'* ]]; then
      pid="$(cat "$operation/pid")"
      current="$(awk '$3 != "Z" {print $22}' "/proc/$pid/stat" 2>/dev/null || true)"
      if [[ -z "$current" || "$current" != "$(cat "$operation/identity")" ]]; then result false failed interrupted '"SETUP_INTERRUPTED"' 1; fi
    fi
    if [[ ! -f "$operation/pid" && -f "$operation/started" ]] && (( $(date +%s) - $(cat "$operation/started") > 15 )); then
      result false failed interrupted '"SETUP_INTERRUPTED"' 1
    fi
    cat "$operation/result.json"
    ;;
  *) exit 2 ;;
esac

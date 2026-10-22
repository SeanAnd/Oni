#!/usr/bin/env sh
# Run real IPC tests on an explicitly selected, already provisioned Android target.
set -eu

: "${SKID_DEVICE_SERIAL:?Set SKID_DEVICE_SERIAL to the intended emulator or phone}"
software_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
test_apk="$software_dir/modules/termux/android/build/outputs/apk/androidTest/debug/skid-termux-debug-androidTest.apk"
if [ ! -f "$test_apk" ]; then
  echo 'Build :skid-termux:assembleDebugAndroidTest first; see docs/development/termux-bridge.md.' >&2
  exit 1
fi

umask 077
mkdir -p "$software_dir/.cache"
result_file=$(mktemp "$software_dir/.cache/termux-device-test.XXXXXX")
trap 'rm -f "$result_file"' EXIT HUP INT TERM
adb -s "$SKID_DEVICE_SERIAL" install -r "$test_apk"
adb -s "$SKID_DEVICE_SERIAL" shell pm grant expo.modules.termux.test com.termux.permission.RUN_COMMAND
adb -s "$SKID_DEVICE_SERIAL" shell am instrument -w \
  -e class expo.modules.termux.TermuxDeviceAcceptanceTest,expo.modules.termux.TermuxHelperDeviceAcceptanceTest \
  expo.modules.termux.test/androidx.test.runner.AndroidJUnitRunner > "$result_file" 2>&1
cat "$result_file"
# `am instrument` can exit zero even when tests fail or the runner cannot start.
python3 - "$result_file" <<'PY'
import pathlib, re, sys
output = pathlib.Path(sys.argv[1]).read_text()
passed = re.search(r'^OK \([1-9][0-9]* tests?\)$', output, re.MULTILINE)
failed = any(marker in output for marker in ('FAILURES!!!', 'INSTRUMENTATION_FAILED', 'Process crashed'))
sys.exit(0 if passed and not failed else 1)
PY

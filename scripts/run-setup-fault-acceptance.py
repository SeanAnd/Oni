#!/usr/bin/env python3
"""Run fault fixtures on a disposable, already-running headless AVD."""
import argparse
import json
from pathlib import Path
import shlex
import subprocess

ROOT = Path(__file__).resolve().parents[1]
PREFIX = '/data/data/com.termux/files/usr'
HOME = '/data/data/com.termux/files/home'


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--serial', required=True)
    parser.add_argument('--scenario', required=True, choices=['storage', 'python-package'])
    parser.add_argument('--disposable-emulator', required=True, action='store_true',
                        help='Acknowledge this AVD was started with -read-only -no-snapshot')
    args = parser.parse_args()
    adb = ['adb', '-s', args.serial]
    if not args.serial.startswith('emulator-'):
        parser.error('Full-storage testing refuses physical device serials')
    qemu = subprocess.check_output([*adb, 'shell', 'getprop', 'ro.kernel.qemu'], text=True).strip()
    if qemu != '1':
        parser.error('The selected device is not an Android emulator')
    files = {}
    for directory, names in (
        ('backend/scripts', ['workstation_common.py', 'workstation_jobs.py',
                             'workstation_setup.py', 'workstation_setup_archive.py']),
        ('backend/tests/fixtures', ['setup_recovery_acceptance.py',
                                   'setup_storage_acceptance.py',
                                   'setup_android_storage_acceptance.py',
                                   'setup_android_package_acceptance.py']),
        ('backend/bootstrap', ['ensure-termux-python.sh']),
    ):
        for name in names:
            files[name] = (ROOT / directory / name).read_text()
    # Only the reviewed, fixed source names above are written to a fresh private
    # fixture directory. No production helper, app pairing or database is used.
    script = '''
import json, pathlib, subprocess, sys, tempfile
sources = json.load(sys.stdin)
with tempfile.TemporaryDirectory(prefix='.oni-fault-acceptance-', dir=pathlib.Path.home()) as temporary:
    root = pathlib.Path(temporary)
    for name, source in sources.items():
        assert pathlib.Path(name).name == name
        (root / name).write_text(source)
    result = subprocess.run([sys.executable, str(root / sys.argv[1])], timeout=600)
    sys.exit(result.returncode)
'''
    command = ['run-as', 'com.termux', '/system/bin/env', 'HOME=' + HOME,
               'PATH=' + PREFIX + '/bin:/system/bin', 'ONI_DISPOSABLE_EMULATOR=1',
               PREFIX + '/bin/python3', '-c', script,
               'setup_android_storage_acceptance.py' if args.scenario == 'storage'
               else 'setup_android_package_acceptance.py']
    result = subprocess.run([*adb, 'shell', shlex.join(command)],
                            input=json.dumps(files), text=True, timeout=630)
    raise SystemExit(result.returncode)


if __name__ == '__main__':
    main()

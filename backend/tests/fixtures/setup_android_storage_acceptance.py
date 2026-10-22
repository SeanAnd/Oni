"""Full /data write faults only on an explicitly disposable Android emulator.

Run under Termux Python with the reviewed helper/fixture sources beside this
file. The host runner must launch the AVD with -read-only -no-snapshot, so even
an Android crash discards every session mutation. Never run on a physical phone.
"""
import errno
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import threading
import time

from setup_storage_acceptance import download_case, extraction_case, expect_full
import workstation_common as common
from workstation_jobs import read_state, write_state


def emulator_gate():
    if os.environ.get('ONI_DISPOSABLE_EMULATOR') != '1':
        raise RuntimeError('Requires explicit disposable-emulator acknowledgement')
    qemu = subprocess.check_output(['/system/bin/getprop', 'ro.kernel.qemu'], text=True).strip()
    if qemu != '1':
        raise RuntimeError('Full-storage acceptance refuses physical devices')
    if not str(Path.home()).startswith('/data/data/com.termux/files/'):
        raise RuntimeError('This fixture runs only under the Termux test UID')
    if shutil.disk_usage(Path.home()).total > 8 * 1024 ** 3:
        raise RuntimeError('Refusing an emulator data partition larger than 8 GiB')


def fill_data(root, reserve=1024 * 1024):
    filler = root / 'fixture-filler'
    deadline = time.monotonic() + 60
    with filler.open('wb', buffering=0) as output:
        while shutil.disk_usage(root).free > reserve:
            if time.monotonic() > deadline:
                raise AssertionError('Bounded emulator fill timed out')
            try:
                output.write(bytes(min(1024 * 1024, shutil.disk_usage(root).free - reserve)))
            except OSError as error:
                if error.errno != errno.ENOSPC:
                    raise
                break
    return filler


def journal_case(root):
    original_home = common.WORKSTATION_HOME
    try:
        common.rebind_workstation_home(root / 'workstation')
        common.ensure_layout()
        previous = {'jobId': 'storage-fixture', 'status': 'running',
                    'setup': {'phase': 'extracting'}}
        write_state('storage-fixture', previous)
        filler = fill_data(root, reserve=0)
        expect_full(lambda: write_state('storage-fixture', {
            **previous, 'status': 'failed', 'errorKey': 'STORAGE_FULL'}))
        assert read_state('storage-fixture') == previous
        filler.unlink()
        write_state('storage-fixture', {
            **previous, 'status': 'failed', 'errorKey': 'STORAGE_FULL'})
        assert read_state('storage-fixture')['errorKey'] == 'STORAGE_FULL'
    finally:
        common.rebind_workstation_home(original_home)


def main():
    emulator_gate()
    results = []
    for name in ('download', 'extract', 'journal'):
        with tempfile.TemporaryDirectory(prefix='.oni-storage-', dir=Path.home()) as temporary:
            root = Path(temporary)
            # Releases only this fixture's filler if a case stalls. The emulator's
            # disposable overlay is the fallback if Android kills this process.
            timed_out = threading.Event()
            def release():
                timed_out.set()
                (root / 'fixture-filler').unlink(missing_ok=True)
            watchdog = threading.Timer(90, release)
            watchdog.start()
            try:
                if name == 'download':
                    download_case(root, fill_data)
                elif name == 'extract':
                    extraction_case(root, root, fill_data)
                else:
                    journal_case(root)
                assert not timed_out.is_set(), 'Watchdog released storage before acceptance finished'
                results.append({'case': name, 'ok': True, 'realEnospc': True})
            finally:
                watchdog.cancel()
                watchdog.join()
                (root / 'fixture-filler').unlink(missing_ok=True)
    print(json.dumps({'ok': True, 'scope': 'android-emulator-full-data', 'cases': results}))


if __name__ == '__main__':
    main()

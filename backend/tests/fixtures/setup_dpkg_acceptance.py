"""Physical Kali dpkg interruption using only a disposable package database.

Run inside the installed Kali with Python. Does not exercise the whole Oni UI or
interrupt real tool packages. No installed package state is repaired or removed.
"""
import hashlib
import json
import os
from pathlib import Path
import signal
import subprocess
import tempfile
import time


def run(*args):
    result = subprocess.run(args, text=True, capture_output=True, timeout=30)
    if result.returncode:
        raise AssertionError(result.stderr)
    return result


def main():
    real_status = Path('/var/lib/dpkg/status')
    before = hashlib.sha256(real_status.read_bytes()).hexdigest()
    with tempfile.TemporaryDirectory(prefix='.oni-dpkg-acceptance-', dir=Path.home()) as directory:
        base = Path(directory)
        root = base / 'root'
        (root / 'var/lib/dpkg').mkdir(parents=True)
        (root / 'var/lib/dpkg/status').touch()
        package = base / 'package'
        control = package / 'DEBIAN'
        control.mkdir(parents=True)
        control.chmod(0o755)
        (control / 'control').write_text(
            'Package: oni-disposable-fixture\nVersion: 1.0\nArchitecture: all\n'
            'Maintainer: Oni acceptance <fixture@example.invalid>\n'
            'Description: Disposable interruption checkpoint\n')
        postinst = control / 'postinst'
        postinst.write_text(
            '#!/bin/sh\nset -eu\n'
            'touch "$DPKG_ROOT/checkpoint"\n'
            'while [ ! -f "$DPKG_ROOT/release" ]; do sleep 0.1; done\n')
        postinst.chmod(0o755)
        archive = base / 'fixture.deb'
        run('dpkg-deb', '--build', str(package), str(archive))
        arguments = ['dpkg', '--root=' + str(root), '--force-script-chrootless']
        worker = subprocess.Popen(
            [*arguments, '--install', str(archive)], start_new_session=True,
            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        try:
            deadline = time.monotonic() + 20
            while not (root / 'checkpoint').exists():
                if worker.poll() is not None or time.monotonic() > deadline:
                    raise AssertionError('Disposable dpkg did not reach postinst')
                time.sleep(.05)
            os.killpg(worker.pid, signal.SIGKILL)
            worker.wait(timeout=5)
            audit = run(*arguments, '--audit').stdout
            assert 'oni-disposable-fixture' in audit, 'Interrupted package must need repair'
            # dpkg may leave its latest state in updates/ until the next transaction.
            status = run('dpkg-query', '--admindir=' + str(root / 'var/lib/dpkg'),
                         '--show', '--showformat=${Status}', 'oni-disposable-fixture').stdout
            assert status == 'install ok half-configured', status
            (root / 'release').touch()
            run(*arguments, '--configure', 'oni-disposable-fixture')
            assert not run(*arguments, '--audit').stdout.strip()
            assert 'Status: install ok installed' in (root / 'var/lib/dpkg/status').read_text()
        finally:
            try:
                os.killpg(worker.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            worker.wait(timeout=5)
    assert hashlib.sha256(real_status.read_bytes()).hexdigest() == before
    print(json.dumps(dict(ok=True, interruptionDetected=True, explicitFixtureRepair=True,
                          realPackageDatabaseUnchanged=True)))


if __name__ == '__main__':
    main()

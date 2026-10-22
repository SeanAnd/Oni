"""Kill real Termux Python package phases only in a disposable emulator session.

Uses the signed repository's unchanged package and real dpkg database/scripts.
This is explicit fault injection, never a production cancellation strategy.
"""
import hashlib
import json
import os
from pathlib import Path
import selectors
import signal
import subprocess
import tempfile
import time

from setup_android_storage_acceptance import emulator_gate


def run(*args, cwd=None, timeout=180):
    result = subprocess.run(args, cwd=cwd, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise AssertionError(f'{args[0]} exited {result.returncode}: {result.stderr[-2000:]}')
    return result.stdout


def package_state():
    return run('dpkg-query', '-W', '-f=${Status}', 'python').strip()


def compiler_in_group(group):
    for path in Path('/proc').iterdir():
        if not path.name.isdigit():
            continue
        try:
            if os.getpgid(int(path.name)) == group and b'py3compile' in (path / 'cmdline').read_bytes():
                return True
        except (OSError, ProcessLookupError):
            pass
    return False


def interrupt(phase, archive):
    reader, writer = os.pipe()
    arguments = ['dpkg', '--status-fd', str(writer)]
    arguments += ['--unpack', str(archive)] if phase == 'unpack' else ['--configure', 'python']
    worker = subprocess.Popen(arguments, pass_fds=(writer,), start_new_session=True,
                              stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    os.close(writer)
    selector = selectors.DefaultSelector()
    selector.register(reader, selectors.EVENT_READ)
    pending = b''
    expected = 'half-installed' if phase == 'unpack' else 'half-configured'
    observed = False
    compiler = False
    deadline = time.monotonic() + 90
    try:
        while worker.poll() is None and time.monotonic() < deadline:
            for _, _ in selector.select(.001):
                chunk = os.read(reader, 8192)
                if not chunk:
                    selector.unregister(reader)
                    break
                pending += chunk
                while b'\n' in pending:
                    line, pending = pending.split(b'\n', 1)
                    fields = line.decode().split(': ')
                    if len(fields) == 3 and fields[0] == 'status' and fields[1].split(':')[0] == 'python' and fields[2] == expected:
                        observed = True
            if observed:
                compiler = phase == 'configure' and compiler_in_group(worker.pid)
                if phase == 'unpack' or compiler:
                    os.killpg(worker.pid, signal.SIGSTOP)
                    os.killpg(worker.pid, signal.SIGKILL)
                    worker.wait(timeout=10)
                    state = package_state()
                    # Status-fd is emitted at a transition; SIGKILL can precede
                    # its database flush. Record the persisted state honestly.
                    assert state != 'install ok installed', (phase, state)
                    assert 'python' in run('dpkg', '--audit')
                    return {'phase': phase, 'observedTransition': expected, 'interruptedState': state,
                            'realCompilerObserved': compiler}
        raise AssertionError(f'Real Python {phase} checkpoint was not reached before process exit/deadline')
    finally:
        selector.close()
        os.close(reader)
        if worker.poll() is None:
            os.killpg(worker.pid, signal.SIGKILL)
        worker.wait(timeout=10)


def bootstrap_refuses_interrupted_packages(root, phase):
    script = Path(__file__).with_name('ensure-termux-python.sh')
    environment = {**os.environ, 'HOME': str(root)}
    def call(action):
        result = subprocess.run(['bash', '--noprofile', '--norc', str(script), action, phase],
                                env=environment, capture_output=True, text=True, timeout=10)
        assert result.returncode == 0, result.stderr
        return json.loads(result.stdout)
    probe = call('probe')
    assert not probe['ok'] and probe.get('errorKey') == 'SETUP_PACKAGE_REPAIR_REQUIRED', probe
    result = call('start')
    deadline = time.monotonic() + 15
    while result.get('status') == 'running' and time.monotonic() < deadline:
        time.sleep(.05)
        result = call('status')
    assert result.get('errorKey') == 'SETUP_PACKAGE_REPAIR_REQUIRED', result


def main():
    emulator_gate()
    assert not run('dpkg', '--audit').strip(), 'Start with a consistent disposable package database'
    version = run('dpkg-query', '-W', '-f=${Version}', 'python').strip()
    before = run('dpkg-query', '-W', '-f=${Package}\t${Version}\t${Status}\n')
    results = []
    with tempfile.TemporaryDirectory(prefix='.oni-package-fault-', dir=Path.home()) as temporary:
        root = Path(temporary)
        run('apt-get', '-o', 'Acquire::Retries=1', '-o', 'Acquire::http::Timeout=30',
            '-o', 'APT::Update::Error-Mode=any', 'update')
        run('apt-get', 'download', 'python=' + version, cwd=root)
        archives = list(root.glob('python_*.deb'))
        assert len(archives) == 1
        archive = archives[0]
        checksum = hashlib.sha256(archive.read_bytes()).hexdigest()
        assert run('dpkg-deb', '-f', str(archive), 'Package').strip() == 'python'
        assert run('dpkg-deb', '-f', str(archive), 'Version').strip() == version
        for phase in ('unpack', 'configure'):
            if phase == 'configure':
                run('dpkg', '--unpack', str(archive))
            try:
                result = interrupt(phase, archive)
                bootstrap_refuses_interrupted_packages(root, phase)
                result['bootstrapRefusesRetry'] = True
            finally:
                # Explicit fixture repair, never automatic product repair.
                run('dpkg', '--unpack', str(archive))
                run('dpkg', '--configure', 'python')
            assert not run('dpkg', '--audit').strip()
            assert package_state() == 'install ok installed'
            run('python3', '-I', '-c', 'import json,hashlib,ssl,sqlite3,fcntl,subprocess,zipfile')
            result['explicitRepairVerified'] = True
            results.append(result)
    assert run('dpkg-query', '-W', '-f=${Package}\t${Version}\t${Status}\n') == before
    print(json.dumps({'ok': True, 'scope': 'android-emulator-real-termux-python',
                      'version': version, 'archiveSha256': checksum, 'cases': results,
                      'packageVersionsAndStatesRestored': True}))


if __name__ == '__main__':
    main()

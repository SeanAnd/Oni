"""Bounded recovery tests on host or Termux; no real packages or user trees change.

Real loopback transport, SIGKILL and filesystem operations exercise the shipped
archive/worker owners. Package lease uses a harmless child, not apt/dpkg. This
fixture does not claim physical package-manager interruption acceptance.
"""
import contextlib
import fcntl
import hashlib
import http.server
import io
import json
import os
from pathlib import Path
import signal
import socket
import subprocess
import sys
import tarfile
import tempfile
import threading
import time
import unittest

# A device runner places the reviewed helper sources beside this fixture.
source = Path(__file__).resolve().parents[2] / 'scripts'
if source.is_dir():
    sys.path.insert(0, str(source))
from workstation_setup_archive import SetupError, download, extract
from workstation_setup import Installer

DATA = bytes(range(256)) * 8192

@contextlib.contextmanager
def image_server(drop_first=False):
    ranges = []
    class Handler(http.server.BaseHTTPRequestHandler):
        def log_message(self, *_): pass
        def do_GET(self):
            value = self.headers.get('Range')
            ranges.append(value)
            start = int(value[6:-1]) if value else 0
            self.send_response(206 if value else 200)
            self.send_header('Content-Length', str(len(DATA) - start))
            if value: self.send_header('Content-Range', f'bytes {start}-{len(DATA)-1}/{len(DATA)}')
            self.end_headers()
            try:
                if drop_first and len(ranges) == 1:
                    self.wfile.write(DATA[:512 * 1024]); self.wfile.flush()
                    self.connection.shutdown(socket.SHUT_RDWR)
                    self.connection.close()
                else:
                    self.wfile.write(DATA[start:])
            except (BrokenPipeError, ConnectionResetError): pass
    server = http.server.ThreadingHTTPServer(('127.0.0.1', 0), Handler)
    thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
    try:
        yield {'url':f'http://127.0.0.1:{server.server_port}/image', 'downloadBytes':len(DATA), 'sha256':hashlib.sha256(DATA).hexdigest()}, ranges
    finally:
        server.shutdown(); server.server_close(); thread.join(timeout=2)


def await_file(path, worker=None):
    until = time.monotonic() + 15
    while time.monotonic() < until:
        if path.exists(): return
        if worker and worker.poll() is not None: raise AssertionError('Fixture worker exited before checkpoint')
        time.sleep(.02)
    raise AssertionError('Fixture checkpoint timed out')


def start_worker(kind, root, catalog):
    environment = dict(os.environ)
    environment['PYTHONPATH'] = os.pathsep.join(sys.path)
    return subprocess.Popen([sys.executable, __file__, kind, str(root), json.dumps(catalog)], env=environment,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)


class SetupRecoveryAcceptance(unittest.TestCase):
    def test_real_connection_drop_retains_and_resumes_partial_download(self):
        with tempfile.TemporaryDirectory(prefix='oni-recovery-') as tmp, image_server(True) as (catalog, ranges):
            target=Path(tmp)/'image.xz'
            with self.assertRaises(SetupError) as caught:
                download(catalog,target,lambda *_:None,lambda:None)
            self.assertEqual(caught.exception.key,'SETUP_DOWNLOAD_FAILED')
            self.assertFalse(target.exists())
            size=target.with_suffix('.partial').stat().st_size
            self.assertGreater(size,0); self.assertLess(size,len(DATA))
            download(catalog,target,lambda *_:None,lambda:None)
            self.assertEqual(ranges,[None,f'bytes={size}-'])
            self.assertEqual(target.read_bytes(),DATA)

    def test_killed_download_worker_retries_only_retained_bytes(self):
        with tempfile.TemporaryDirectory(prefix='oni-recovery-') as tmp, image_server() as (catalog, ranges):
            root=Path(tmp); worker=start_worker('download',root,catalog)
            try:
                await_file(root/'checkpoint',worker)
                worker.kill(); worker.wait(timeout=5)
                target=root/'image.xz'
                size=target.with_suffix('.partial').stat().st_size
                self.assertGreater(size,0); self.assertLess(size,len(DATA))
                download(catalog,target,lambda *_:None,lambda:None)
                self.assertEqual(ranges[-1],f'bytes={size}-')
                self.assertEqual(target.read_bytes(),DATA)
            finally:
                if worker.poll() is None: worker.kill(); worker.wait(timeout=5)

    def test_killed_extractor_leaves_staging_and_never_publishes(self):
        with tempfile.TemporaryDirectory(prefix='oni-recovery-') as tmp:
            root=Path(tmp); archive=root/'image.xz'
            with tarfile.open(archive,'w:xz') as output:
                for i in range(8):
                    member=tarfile.TarInfo(f'kali/file{i}'); member.size=65536
                    output.addfile(member,io.BytesIO(DATA[:65536]))
            catalog={'rootDirectory':'kali','maximumExpandedBytes':1048576}
            worker=start_worker('extract',root,catalog)
            try:
                await_file(root/'checkpoint',worker); worker.kill(); worker.wait(timeout=5)
                self.assertTrue((root/'stage/kali/file0').exists())
                self.assertFalse((root/'kali').exists())
                with self.assertRaises(SetupError): extract(archive,root/'stage',catalog,lambda:None)
                # A separate empty staging destination proves the retained archive can retry.
                extract(archive,root/'retry-stage',catalog,lambda:None)
                self.assertEqual(len(list((root/'retry-stage/kali').iterdir())),8)
            finally:
                if worker.poll() is None: worker.kill(); worker.wait(timeout=5)

    def test_package_child_retains_install_lease_after_supervisor_death(self):
        with tempfile.TemporaryDirectory(prefix='oni-recovery-') as tmp:
            root=Path(tmp); worker=start_worker('lease',root,{})
            try:
                await_file(root/'checkpoint',worker); worker.kill(); worker.wait(timeout=5)
                with (root/'install.lock').open('a') as lock:
                    with self.assertRaises(BlockingIOError): fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
                    (root/'release').touch()
                    until=time.monotonic()+10
                    while True:
                        try: fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB); break
                        except BlockingIOError:
                            if time.monotonic()>until: raise AssertionError('Fixture child did not release its lease')
                            time.sleep(.02)
            finally:
                (root/'release').touch()
                if worker.poll() is None: worker.kill(); worker.wait(timeout=5)


def worker_main(kind, root, catalog):
    if kind == 'lease':
        class LeaseInstaller(Installer):
            def state(self, **_): pass
            def check(self): pass
        installer=LeaseInstaller({'jobId':'recovery-lease','timeoutMs':15000})
        with (root/'install.lock').open('a') as lock:
            fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB); installer.lease_fd=lock.fileno()
            # This child has no package privileges or package-manager calls.
            child='import pathlib,sys,time; r=pathlib.Path(sys.argv[1]); (r/"checkpoint").touch(); end=time.monotonic()+20\nwhile not (r/"release").exists() and time.monotonic()<end: time.sleep(.02)'
            installer.run([sys.executable,'-c',child,str(root)],package=True)
    elif kind == 'download':
        def progress(*_): (root/'checkpoint').touch(); time.sleep(30)
        download(catalog,root/'image.xz',progress,lambda:None)
    elif kind == 'extract':
        count=0
        def check():
            nonlocal count
            count+=1
            if count==3: (root/'checkpoint').touch(); time.sleep(30)
        extract(root/'image.xz',root/'stage',catalog,check)

if __name__ == '__main__':
    if len(sys.argv)>1 and sys.argv[1] in ('download','extract','lease'):
        worker_main(sys.argv[1],Path(sys.argv[2]),json.loads(sys.argv[3]))
    else:
        result=unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(SetupRecoveryAcceptance))
        print(json.dumps({'ok':result.wasSuccessful(),'tests':result.testsRun,'failures':len(result.failures),'errors':len(result.errors)}))
        raise SystemExit(0 if result.wasSuccessful() else 1)

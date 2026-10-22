import base64
import hashlib
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest
import zipfile

RECEIVER = Path(__file__).resolve().parents[1] / 'bootstrap/receive_bundle.py'

class BundleReceiverTests(unittest.TestCase):
    def bundle(self, name='helper.py', content=b'print("ok")', mode=0o100600):
        stream = io.BytesIO()
        with zipfile.ZipFile(stream, 'w') as archive:
            archive.writestr('manifest.json', json.dumps(dict(backendVersion='1.3.1', scripts=[dict(name=name, path='scripts/'+name, sha256=hashlib.sha256(content).hexdigest())])))
            entry = zipfile.ZipInfo(name)
            entry.external_attr = mode << 16
            archive.writestr(entry, content)
        return stream.getvalue()

    def call(self, home, payload):
        completed = subprocess.run([sys.executable, str(RECEIVER)], input=json.dumps(payload), env={**os.environ, 'HOME': home}, text=True, capture_output=True)
        self.assertEqual(completed.returncode, 0, completed.stderr)
        return json.loads(completed.stdout)

    def activate(self, home, payload):
        digest = hashlib.sha256(payload).hexdigest()
        self.assertTrue(self.call(home, dict(action='chunk', sha256=digest, offset=0, data=base64.b64encode(payload).decode()))['ok'])
        return self.call(home, dict(action='activate', sha256=digest, token='a'*64))

    def test_verified_private_install_retains_pairing_and_rollback(self):
        with tempfile.TemporaryDirectory() as home:
            root = Path(home)/'.rootless-workstation'
            (root/'bin').mkdir(parents=True)
            (root/'bin'/'old').write_text('preserved')
            self.assertTrue(self.activate(home, self.bundle())['ok'])
            self.assertTrue((root/'bin').is_symlink())
            self.assertEqual((root/'bin/helper.py').stat().st_mode & 0o777, 0o700)
            self.assertEqual(len(list(root.glob('bin-before-*'))), 1)
            self.assertTrue(self.activate(home, self.bundle())['ok'])
            self.assertEqual((root/'state/helper_token').read_text(), 'a'*64)
            self.assertEqual((root/'state/helper_token').stat().st_mode & 0o777, 0o600)

    def test_traversal_and_archive_symlinks_rejected(self):
        for name, mode in [('../escape', 0o100600), ('link', 0o120777)]:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as home:
                self.assertFalse(self.activate(home, self.bundle(name=name, mode=mode))['ok'])
                self.assertFalse((Path(home)/'escape').exists())

    def test_existing_pairing_cannot_be_replaced(self):
        with tempfile.TemporaryDirectory() as home:
            root = Path(home)/'.rootless-workstation'
            (root/'state').mkdir(parents=True)
            (root/'state/helper_token').write_text('original-token')
            self.assertEqual(self.activate(home, self.bundle())['errorKey'], 'PERMISSION_DENIED')
            self.assertEqual((root/'state/helper_token').read_text(), 'original-token')

    def test_chunk_offsets_and_final_integrity_checked(self):
        with tempfile.TemporaryDirectory() as home:
            digest = 'a'*64
            self.assertFalse(self.call(home, dict(action='chunk', sha256=digest, offset=10, data='YQ=='))['ok'])
            self.assertTrue(self.call(home, dict(action='chunk', sha256=digest, offset=0, data='YQ=='))['ok'])
            self.assertFalse(self.call(home, dict(action='activate', sha256=digest, token='a'*64))['ok'])

    def test_compressed_bundle_cannot_exhaust_memory_on_expansion(self):
        stream = io.BytesIO()
        content = b'x' * (512 * 1024)
        entries = [dict(name=f'file-{i}', sha256=hashlib.sha256(content).hexdigest()) for i in range(5)]
        with zipfile.ZipFile(stream, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
            archive.writestr('manifest.json', json.dumps(dict(backendVersion='1.3.1', scripts=entries)))
            for entry in entries: archive.writestr(entry['name'], content)
        with tempfile.TemporaryDirectory() as home:
            self.assertFalse(self.activate(home, stream.getvalue())['ok'])
            self.assertFalse((Path(home)/'.rootless-workstation/bin').exists())

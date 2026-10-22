"""Real ENOSPC acceptance on a private, 16 MiB Linux tmpfs.

Uses an unprivileged host user/mount namespace, never Android root or the host's
shared temporary filesystem. This is not Android full-storage acceptance.
"""
import errno
import io
import json
import os
from pathlib import Path
import shutil
import subprocess
import sys
import tarfile
import tempfile
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'scripts'))
from workstation_setup_archive import download, extract

sys.path.insert(0, str(Path(__file__).resolve().parent))
from setup_recovery_acceptance import DATA, image_server


def fill_to_one_mib_free(root):
    filler = root / 'fixture-filler'
    # A small, explicitly mounted tmpfs is the only permitted fill target.
    usage = shutil.disk_usage(root)
    if not os.path.ismount(root) or usage.total != 16 * 1024 * 1024:
        raise AssertionError('Refusing to fill anything except the isolated 16 MiB mount')
    with filler.open('wb') as output:
        while shutil.disk_usage(root).free > 1024 * 1024:
            output.write(bytes(65536))
            output.flush()
    return filler


def expect_full(action):
    try:
        action()
    except OSError as error:
        if error.errno != errno.ENOSPC:
            raise
    else:
        raise AssertionError('The real write must fail with ENOSPC')


def download_case(root, fill=fill_to_one_mib_free):
    with image_server() as (catalog, ranges):
        filler = fill(root)
        target = root / 'image.xz'
        expect_full(lambda: download(catalog, target, lambda *_: None, lambda: None))
        assert not target.exists(), 'An incomplete download must not be published'
        partial = target.with_suffix('.partial')
        retained = partial.stat().st_size
        assert 0 < retained < len(DATA)
        assert partial.read_bytes() == DATA[:retained]
        filler.unlink()
        download(catalog, target, lambda *_: None, lambda: None)
        assert ranges == [None, f'bytes={retained}-']
        assert target.read_bytes() == DATA
        assert not partial.exists()


def extraction_case(root, directory, fill=fill_to_one_mib_free):
    archive = directory / 'image.xz'
    with tarfile.open(archive, 'w:xz') as output:
        member = tarfile.TarInfo('kali/payload')
        member.size = len(DATA)
        output.addfile(member, io.BytesIO(DATA))
    original = archive.read_bytes()
    catalog = {'rootDirectory': 'kali', 'maximumExpandedBytes': len(DATA)}
    filler = fill(root)
    staging = root / 'staging'
    expect_full(lambda: extract(archive, staging, catalog, lambda: None))
    assert not (root / 'kali').exists(), 'An incomplete staging tree must not be published'
    assert (staging / 'kali/payload').stat().st_size < len(DATA)
    assert archive.read_bytes() == original
    filler.unlink()
    # Same owned-staging retry policy as Installer.fresh; never remove a final tree.
    shutil.rmtree(staging)
    extract(archive, staging, catalog, lambda: None)
    assert (staging / 'kali/payload').read_bytes() == DATA
    assert archive.read_bytes() == original


def worker(case):
    with tempfile.TemporaryDirectory(prefix='oni-storage-acceptance-') as temporary:
        directory = Path(temporary)
        root = directory / 'bounded-storage'
        root.mkdir()
        subprocess.run(['mount', '-t', 'tmpfs', '-o', 'size=16m,mode=0700',
                        'oni-storage-acceptance', str(root)], check=True, timeout=10)
        try:
            if case == 'download':
                download_case(root)
            elif case == 'extract':
                extraction_case(root, directory)
            else:
                raise ValueError('Unknown acceptance case')
        finally:
            subprocess.run(['umount', str(root)], check=True, timeout=10)
    print(json.dumps({'ok': True, 'case': case, 'realEnospc': True,
                      'scope': 'host-private-tmpfs'}))


class SetupStorageAcceptance(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        if not all(shutil.which(command) for command in ('unshare', 'mount', 'umount')):
            raise unittest.SkipTest('Private Linux mount namespace tools unavailable')
        probe = subprocess.run(['unshare', '--user', '--map-root-user', '--mount',
                                '--fork', 'true'], capture_output=True, timeout=10)
        if probe.returncode:
            raise unittest.SkipTest('Unprivileged user/mount namespaces unavailable')

    def run_case(self, case):
        result = subprocess.run(
            ['unshare', '--user', '--map-root-user', '--mount', '--fork',
             sys.executable, __file__, case], capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(json.loads(result.stdout), {
            'ok': True, 'case': case, 'realEnospc': True, 'scope': 'host-private-tmpfs'})

    def test_full_download_retains_bytes_and_resumes_after_space_is_freed(self):
        self.run_case('download')

    def test_full_extraction_retains_archive_and_retries_owned_staging(self):
        self.run_case('extract')


if __name__ == '__main__':
    if len(sys.argv) == 2 and sys.argv[1] in ('download', 'extract'):
        worker(sys.argv[1])
    else:
        unittest.main()

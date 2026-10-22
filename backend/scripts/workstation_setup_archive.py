"""Pinned setup downloads and rootfs extraction. Never execute archive content here."""
import hashlib
import http.client
import os
from pathlib import Path, PurePosixPath
import shutil
import tarfile
import urllib.error
import urllib.request


class SetupError(Exception):
    def __init__(self, key, detail):
        self.key, self.detail = key, detail
        super().__init__(detail)


def digest(path):
    value = hashlib.sha256()
    with path.open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            value.update(chunk)
    return value.hexdigest()


def download(catalog, target, progress, check):
    if target.exists():
        if digest(target) != catalog['sha256']:
            raise SetupError('SETUP_CATALOG_MISMATCH', 'The saved download does not match the reviewed image.')
        return
    partial = target.with_suffix('.partial')
    offset = partial.stat().st_size if partial.exists() else 0
    if offset > catalog['downloadBytes']:
        raise SetupError('SETUP_CATALOG_MISMATCH', 'The partial download has an unexpected size.')
    # The release URL and pinned digest are immutable for this private catalog directory.
    if offset < catalog['downloadBytes']:
        request = urllib.request.Request(catalog['url'], headers={'Range': f'bytes={offset}-'} if offset else {})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                if response.url != catalog['url']:
                    raise SetupError('SETUP_CATALOG_MISMATCH', 'The image location changed; update the reviewed catalog.')
                if response.status == 206:
                    expected = f'bytes {offset}-'
                    if not response.headers.get('Content-Range', '').startswith(expected):
                        raise SetupError('SETUP_DOWNLOAD_FAILED', 'The server returned an unexpected download range.')
                else:
                    offset = 0  # A server ignoring Range must replace, never append.
                with partial.open('ab' if offset else 'wb') as output:
                    os.chmod(partial, 0o600)
                    while chunk := response.read(256 * 1024):
                        check()
                        offset += len(chunk)
                        if offset > catalog['downloadBytes']:
                            raise SetupError('SETUP_CATALOG_MISMATCH', 'The image size changed.')
                        output.write(chunk)
                        progress(offset, catalog['downloadBytes'])
        except (urllib.error.URLError, TimeoutError, ConnectionError, http.client.IncompleteRead) as error:
            raise SetupError('SETUP_DOWNLOAD_FAILED', 'The download stopped. Completed setup steps and partial bytes are retained.') from error
    check()
    if partial.stat().st_size < catalog['downloadBytes']:
        raise SetupError('SETUP_DOWNLOAD_FAILED', 'The download stopped early. Partial bytes are retained; retry to continue the download.')
    if partial.stat().st_size != catalog['downloadBytes'] or digest(partial) != catalog['sha256']:
        raise SetupError('SETUP_CATALOG_MISMATCH', 'The downloaded image failed its integrity check. It was not installed.')
    partial.replace(target)


def member_path(name, root):
    path = PurePosixPath(name)
    if path.is_absolute() or '..' in path.parts or not path.parts or path.parts[0] != root:
        raise SetupError('ARTIFACT_INTEGRITY_FAILED', 'The rootfs contains an unsafe archive path.')
    return path


def extract(archive, destination, catalog, check):
    """Write regular data before links; no extraction writes traverse archive symlinks.

    Linux absolute symlinks are retained for PRoot, but never followed by this
    extractor. Hard links are private file copies because Android lacks os.link.
    Device nodes are unnecessary: the launcher binds the real /dev.
    """
    if destination.exists():
        raise SetupError('SETUP_EXISTING_INSTALLATION', 'Extraction requires an empty owned staging directory.')
    root = catalog['rootDirectory']
    with tarfile.open(archive, 'r:xz') as source:
        members = source.getmembers()
        paths = {}
        total = 0
        for member in members:
            path = member_path(member.name, root)
            if path in paths:
                raise SetupError('ARTIFACT_INTEGRITY_FAILED', 'Duplicate archive path.')
            paths[path] = member
            total += member.size
            if total > catalog['maximumExpandedBytes']:
                raise SetupError('STORAGE_FULL', 'The rootfs exceeds the reviewed expansion limit.')
        links = {p for p, m in paths.items() if m.issym() or m.islnk()}
        for path, member in paths.items():
            if any(parent in links for parent in path.parents):
                raise SetupError('ARTIFACT_INTEGRITY_FAILED', 'An archive entry writes through a link.')
            if member.islnk():
                referenced = paths.get(member_path(member.linkname, root))
                if referenced is None or not referenced.isfile():
                    raise SetupError('ARTIFACT_INTEGRITY_FAILED', 'Unsafe hard link.')
            if not (member.isfile() or member.isdir() or member.issym() or member.islnk() or member.isdev()):
                raise SetupError('ARTIFACT_INTEGRITY_FAILED', 'Unsupported archive entry.')
        destination.mkdir(mode=0o700)
        for path, member in paths.items():
            check()
            target = destination.joinpath(*path.parts)
            if member.isdev() or member.issym() or member.islnk():
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            if member.isdir():
                target.mkdir(exist_ok=True)
            else:
                with source.extractfile(member) as data, target.open('xb') as output:
                    shutil.copyfileobj(data, output, 1024 * 1024)
                target.chmod(member.mode & 0o777)
        for path, member in paths.items():
            check()
            target = destination.joinpath(*path.parts)
            if member.islnk():
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(destination / member.linkname, target)
                target.chmod(member.mode & 0o777)
            elif member.issym():
                target.parent.mkdir(parents=True, exist_ok=True)
                os.symlink(member.linkname, target)
        # Directory permissions last, so restrictive members cannot obstruct extraction.
        for path, member in reversed(list(paths.items())):
            if member.isdir():
                (destination.joinpath(*path.parts)).chmod((member.mode & 0o777) | 0o700)

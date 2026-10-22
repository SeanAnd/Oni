"""Fixed APK-owned receiver executed by normal RUN_COMMAND; stdin is bounded data."""
import base64
import hashlib
import io
import json
import os
import pathlib
import re
import secrets
import stat
import sys
import zipfile

root = pathlib.Path.home() / '.rootless-workstation'
def secure_directory(path):
    if path.is_symlink():
        raise ValueError('Unsafe directory')
    path.mkdir(mode=0o700, exist_ok=True)
    path.chmod(0o700)
try:
    secure_directory(root)
    request = json.loads(sys.stdin.read(60000))
    digest = request['sha256']
    if not isinstance(digest, str) or not re.fullmatch('[a-f0-9]{64}', digest):
        raise ValueError()
    staging = root / 'incoming'
    secure_directory(staging)
    archive = staging / (digest + '.zip')
    if archive.is_symlink():
        raise ValueError()
    if request['action'] == 'chunk':
        chunk = base64.b64decode(request['data'], validate=True)
        offset = request['offset']
        if type(offset) is not int or not 0 <= offset <= 2 * 1024 * 1024 or len(chunk) > 32768 or offset + len(chunk) > 2 * 1024 * 1024:
            raise ValueError()
        if offset == 0:
            archive.write_bytes(chunk)
        else:
            with archive.open('r+b') as stream:
                stream.seek(0, 2)
                if stream.tell() != offset:
                    raise ValueError()
                stream.write(chunk)
        archive.chmod(0o600)
    elif request['action'] == 'activate':
        token = request['token']
        if not isinstance(token, str) or not re.fullmatch('[A-Za-z0-9_-]{32,128}', token):
            raise ValueError()
        payload = archive.read_bytes()
        if len(payload) > 2 * 1024 * 1024 or hashlib.sha256(payload).hexdigest() != digest:
            raise ValueError()
        state = root / 'state'
        secure_directory(state)
        token_path = state / 'helper_token'
        if token_path.is_symlink():
            raise ValueError()
        if token_path.exists() and not secrets.compare_digest(token_path.read_text().strip(), token):
            print(json.dumps(dict(ok=False, errorKey='PERMISSION_DENIED', detail='Existing helper pairing differs. Enter its original token to repair pairing.')))
            sys.exit(0)
        releases = root / 'releases'
        secure_directory(releases)
        release = releases / digest
        secure_directory(release)
        with zipfile.ZipFile(io.BytesIO(payload)) as bundle:
            if len(bundle.infolist()) > 64 or sum(info.file_size for info in bundle.infolist()) > 2 * 1024 * 1024 or bundle.getinfo('manifest.json').file_size > 65536:
                raise ValueError()
            manifest = json.loads(bundle.read('manifest.json'))
            expected = {entry['name']: entry for entry in manifest['scripts']}
            if len(bundle.namelist()) != len(set(bundle.namelist())) or len(expected) != len(manifest['scripts']) or set(bundle.namelist()) != set(expected) | {'manifest.json'} or manifest['backendVersion'] != '1.3.1':
                raise ValueError()
            verified = []
            for name, entry in expected.items():
                info = bundle.getinfo(name)
                if pathlib.PurePosixPath(name).name != name or name in {'.', '..'} or stat.S_ISLNK(info.external_attr >> 16) or info.file_size > 512 * 1024:
                    raise ValueError()
                content = bundle.read(name)
                if hashlib.sha256(content).hexdigest() != entry['sha256']:
                    raise ValueError()
                verified.append((name, content))
            for name, content in verified:
                target = release / ('workstation-helper' if name == 'workstation_helper.py' else name)
                if target.is_symlink():
                    raise ValueError()
                if content.startswith(b'#!/usr/bin/env python3'):
                    content = content.replace(b'#!/usr/bin/env python3', ('#!' + sys.executable).encode(), 1)
                target.write_bytes(content)
                target.chmod(0o700)
        bin_path = root / 'bin'
        if bin_path.exists() and not bin_path.is_symlink():
            bin_path.rename(root / ('bin-before-' + secrets.token_hex(8)))
        link = root / 'bin.next'
        link.unlink(missing_ok=True)
        link.symlink_to(release, target_is_directory=True)
        link.replace(bin_path)
        if not token_path.exists():
            temporary = state / ('helper-token-' + secrets.token_hex(8) + '.tmp')
            descriptor = os.open(temporary, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
            with os.fdopen(descriptor, 'w') as stream:
                stream.write(token)
                stream.flush()
                os.fsync(stream.fileno())
            temporary.replace(token_path)
        archive.unlink()
    else:
        raise ValueError()
    print(json.dumps(dict(ok=True)))
except (ValueError, KeyError, OSError, zipfile.BadZipFile):
    print(json.dumps(dict(ok=False, errorKey='INVALID_PAYLOAD', detail='Bundle validation or activation failed; existing state was retained.')))

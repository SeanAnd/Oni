"""Standalone Kali-side configuration publisher, transported as reviewed source."""
import hashlib
import json
import os
from pathlib import Path
import re
import tempfile
import configparser
from urllib.parse import urlsplit, unquote


def digest(data):
    return hashlib.sha256(data).hexdigest()


def safe(path):
    if path.is_symlink() or (path.exists() and path.stat().st_uid != os.getuid()):
        raise ValueError('Unsafe configuration ownership')


def atomic(path, data, mode=0o600):
    safe(path)
    fd, name = tempfile.mkstemp(dir=path.parent, prefix='.oni-')
    try:
        with os.fdopen(fd, 'wb') as stream:
            stream.write(data)
            stream.flush()
            os.fsync(stream.fileno())
        os.chmod(name, mode)
        os.replace(name, path)
    finally:
        Path(name).unlink(missing_ok=True)


def default_matches(data, config):
    saved = configparser.ConfigParser(interpolation=None, strict=False)
    saved.read_string(data.decode())
    name = saved.get('framework/database', 'default_db', fallback='')
    if not name:
        return True
    raw = saved.get('framework/database/' + name, 'url', fallback='')
    try:
        url = urlsplit(raw if '://' in raw else 'postgresql://' + raw)
        return (url.scheme in {'postgresql', 'postgres'} and url.hostname == '127.0.0.1'
                and (url.port or 5432) == 5432 and url.path == '/msf'
                and unquote(url.username or '') == 'msf' and unquote(url.password or '') == config['password'])
    except ValueError:
        return False


def clear_default(data, config=None):
    """Preserve Rex INI bytes except its automatic database selector."""
    if config is not None and default_matches(data, config):
        return data
    section = ''
    result = []
    for line in data.splitlines(keepends=True):
        stripped = line.strip()
        if stripped.startswith(b'[') and stripped.endswith(b']'):
            section = stripped[1:-1].lower()
        if section == b'framework/database' and re.match(rb'^\s*default_db\s*=', line, re.I):
            continue
        result.append(line)
    return b''.join(result)


def validate_launch(home=None, environment=None):
    directory = (home or Path.home()) / '.msf4'
    environment = os.environ if environment is None else environment
    profile = directory / 'skid-termux-local.json'
    config = json.loads(profile.read_text())['production']
    expected = dict(adapter='postgresql', host='127.0.0.1', port=5432, username='msf', database='msf')
    if any(config.get(key) != value for key, value in expected.items()):
        raise ValueError('Managed database configuration mismatch')
    saved = directory / 'config'
    if not default_matches(saved.read_bytes() if saved.exists() else b'', config):
        raise ValueError('Saved default conflicts; run msfdb init to repair it')
    for name, allowed in [('MSF_DATABASE_CONFIG', {profile, directory / 'database.yml'}),
                          ('MSF_CFGROOT_CONFIG', {directory})]:
        value = environment.get(name)
        if value and Path(value).expanduser() not in allowed:
            raise ValueError('Framework environment conflicts with Oni')
    return profile


def publish(request, home=None):
    home = home or Path.home()
    directory = home / '.msf4'
    safe(directory)
    directory.mkdir(mode=0o700, exist_ok=True)
    directory.chmod(0o700)
    state = directory / 'oni-managed'
    safe(state)
    state.mkdir(mode=0o700, exist_ok=True)
    state.chmod(0o700)
    manifest_path = state / 'configuration.json'
    safe(manifest_path)
    manifest = json.loads(manifest_path.read_text()) if manifest_path.exists() else {'files': {}}
    if manifest.get('uninstalled'):
        manifest = {'files': {}}
    config = request['config']
    if request['profileId'] != 'termux-local':
        raise ValueError('Retired profile')
    for key, value in dict(adapter='postgresql', host='127.0.0.1', port=5432, username='msf', database='msf').items():
        if config.get(key) != value:
            raise ValueError('Invalid managed connection')
    if not isinstance(config.get('password'), str) or not config['password'] or '\x00' in config['password']:
        raise ValueError('Invalid credential')
    data = json.dumps({'production': config}).encode()
    files = {'.msf4/skid-termux-local.json': (data, 0o600), '.msf4/database.yml': (data, 0o600)}
    existing_config = directory / 'config'
    safe(existing_config)
    if existing_config.exists():
        before = existing_config.read_bytes()
        after = clear_default(before, config)
        if before != after:
            files['.msf4/config'] = (after, 0o600)
    if 'wrapper' in request:
        files['.local/share/oni/bin/msfdb'] = (request['wrapper'].encode(), 0o700)
        files['.msf4/oni-managed/client.json'] = (json.dumps({'token': request['token'], 'version': 1}).encode(), 0o600)
        if 'runtime' in request:
            files['.msf4/oni-managed/config.py'] = (request['runtime'].encode(), 0o600)
        snippet = '\n# >>> Oni msfdb >>>\nexport PATH="$HOME/.local/share/oni/bin:$PATH"\n# <<< Oni msfdb <<<\n'
        shells = ['.bashrc', '.profile']
        shells += [name for name in ('.bash_profile', '.bash_login', '.zshrc', '.zprofile') if (home / name).exists()]
        for name in shells:
            target = home / name
            safe(target)
            before = target.read_bytes() if target.exists() else b''
            if b'# >>> Oni msfdb >>>' not in before:
                files[name] = (before + snippet.encode(), 0o600)
    # Validate every conflict before writing. A prepared manifest also permits
    # recovery after any individual atomic replacement in a multi-file update.
    changes = []
    for name, (content, mode) in files.items():
        target = home / name
        for parent in reversed(target.parents):
            if parent == home or home in parent.parents:
                safe(parent)
                parent.mkdir(mode=0o700, exist_ok=True)
        safe(target)
        before = target.read_bytes() if target.exists() else None
        entry = manifest['files'].get(name)
        if before == content and entry:
            target.chmod(mode)
            continue
        if name == '.local/share/oni/bin/msfdb' and before is not None and entry is None and before != content:
            raise ValueError('Wrapper path already belongs to the user')
        if entry and digest(before or b'') not in {entry['hash'], entry.get('pending')}:
            # Shell/config files are user-owned; append-only installation and
            # targeted selector repair preserve unrelated edits after install.
            if name not in shells_if_present(files):
                raise ValueError('Managed configuration was edited; preserve and repair it explicitly')
        if entry is None or name == '.msf4/config':
            backup = name.replace('/', '_') + '-' + digest(before or b'') + '.original'
            if before is not None and not (state / backup).exists():
                atomic(state / backup, before)
            if entry is None:
                entry = {'hash': digest(before or b''), 'original': backup if before is not None else None,
                         'originalMode': (target.stat().st_mode & 0o777) if before is not None else None}
                manifest['files'][name] = entry
        entry['pending'] = digest(content)
        changes.append((name, target, content, mode))
    atomic(manifest_path, json.dumps(manifest).encode())
    for name, target, content, mode in changes:
        atomic(target, content, mode)
        manifest['files'][name]['hash'] = digest(content)
        manifest['files'][name].pop('pending', None)
        atomic(manifest_path, json.dumps(manifest).encode())
    return {'ok': True, 'configured': True}


def shells_if_present(files):
    return {name for name in files if name in {'.bashrc', '.profile', '.bash_profile', '.bash_login', '.zshrc', '.zprofile', '.msf4/config'}}


def uninstall(home=None):
    """Restore only unchanged owned files; retain private originals and user edits."""
    home = home or Path.home()
    state = home / '.msf4/oni-managed'
    manifest_path = state / 'configuration.json'
    safe(state)
    safe(manifest_path)
    manifest = json.loads(manifest_path.read_text())
    conflicts = []
    for name, entry in manifest['files'].items():
        if name not in {'.msf4/database.yml', '.msf4/skid-termux-local.json', '.msf4/config', '.local/share/oni/bin/msfdb', '.msf4/oni-managed/client.json', '.msf4/oni-managed/config.py', '.bashrc', '.profile', '.bash_profile', '.bash_login', '.zshrc', '.zprofile'}:
            raise ValueError('Unknown installation file')
        target = home / name
        if target.is_symlink():
            conflicts.append(name)
            continue
        before = target.read_bytes() if target.exists() else b''
        if digest(before) not in {entry['hash'], entry.get('pending')}:
            conflicts.append(name)
            continue
        original = entry['original']
        if original:
            if Path(original).name != original:
                raise ValueError('Invalid original backup path')
            backup = state / original
            safe(backup)
            atomic(target, backup.read_bytes(), entry['originalMode'] or 0o600)
        else:
            target.unlink(missing_ok=True)
    if not conflicts:
        manifest['uninstalled'] = True
        atomic(manifest_path, json.dumps(manifest).encode())
    return {'ok': not conflicts, 'conflicts': conflicts, 'detail': 'Private originals retained. Database and user data were not changed.'}


if __name__ == '__main__':
    import sys
    try:
        request = json.load(sys.stdin)
        print(json.dumps(uninstall() if request == {'uninstall': True} else publish(request)))
    except (OSError, ValueError, KeyError, configparser.Error):
        print(json.dumps({'ok': False, 'errorKey': 'DATABASE_RECOVERY_REQUIRED',
                          'detail': 'Framework configuration conflicts with managed state. Original files were preserved.'}))
        sys.exit(1)

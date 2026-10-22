"""Fixed setup task composed with the existing durable job ledger.

Package mutations use cooperative cancellation: no supervisor kills dpkg. Download
and extraction checkpoints can stop immediately. All paths and URLs are catalog-owned.
"""
import fcntl
import ipaddress
import json
import os
from pathlib import Path
import selectors
import shlex
import shutil
import subprocess
import sys
import time

import workstation_common as common
from workstation_setup_archive import SetupError, download, extract

CATALOG_ID = 'kali-2026.2-minimal-arm64-v1'
ROOT = common.WORKSTATION_HOME / 'setup'


def catalog():
    path = Path(__file__).with_name('setup-catalog.json')
    if not path.exists():
        path = Path(__file__).resolve().parents[1] / 'bootstrap/setup-catalog.json'
    return json.loads(path.read_text())


def raw_kali(root, args, user='root'):
    home = '/root' if user == 'root' else '/home/kali'
    return ['proot', '--link2symlink', '-0', '-r', str(root), '-b', '/dev', '-b', '/proc', '-b', str(root / home.lstrip('/')) + ':/dev/shm', '-w', home,
            '/usr/bin/env', '-i', 'HOME=' + home, 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', 'LANG=C.UTF-8',
            *([] if user == 'root' else ['sudo', '-u', 'kali']), '/bin/bash', '--noprofile', '--norc', '-c', shlex.join(args)]


def launcher_source(root):
    return ('#!' + sys.executable + '\n' + '''# Oni-owned NetHunter-compatible launcher; no Android root.
import os,sys,shlex
root=''' + repr(str(root)) + '''
args=sys.argv[1:]
is_root=bool(args and args[0] in ['-r','-R'])
if is_root:args=args[1:]
home='/root' if is_root else '/home/kali'
command=['proot','--link2symlink','-0','-r',root,'-b','/dev','-b','/proc','-b',root+home+':/dev/shm','-w',home,
'/usr/bin/env','-i','HOME='+home,'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin','LANG=C.UTF-8','TERM='+os.environ.get('TERM','xterm-256color')]
if not is_root:command+=['sudo','-u','kali']
command+=['/bin/bash']
if args:command+=['-c',' '.join(args)]
os.environ.pop('LD_PRELOAD',None)
os.execvp(command[0],command)
''').encode()


def configure_fresh_dns(root):
    # The published image carries its builder's DNS server. Reuse Termux's
    # configured resolvers only for a new Oni-owned Kali installation.
    resolver = Path(sys.executable).parent.parent / 'etc/resolv.conf'
    nameservers = []
    for line in resolver.read_text().splitlines():
        parts = line.split()
        if len(parts) >= 2 and parts[0] == 'nameserver':
            try: nameservers.append(str(ipaddress.ip_address(parts[1])))
            except ValueError: continue
    if not nameservers:
        raise SetupError('SETUP_DOWNLOAD_FAILED', 'Termux has no usable DNS resolver configuration. Check its network settings.')
    common.atomic_write(root / 'etc/resolv.conf', ''.join('nameserver ' + address + '\n' for address in nameservers).encode())
    (root / 'etc/resolv.conf').chmod(0o644)


def configure_fresh_database_policy(root):
    # Service-start suppression alone does not prevent Debian's postinst from
    # creating a cluster. This policy belongs only to a new Oni-owned rootfs.
    directory = root / 'etc/postgresql-common'
    if directory.is_symlink():
        raise SetupError('SETUP_EXISTING_INSTALLATION', 'Kali database policy ownership changed.')
    directory.mkdir(exist_ok=True)
    common.atomic_write(directory / 'createcluster.conf', b'# Oni uses Termux PostgreSQL.\ncreate_main_cluster = false\n')
    (directory / 'createcluster.conf').chmod(0o644)


class Installer:
    def __init__(self, request):
        self.request = request
        self.started = time.time()
        self.deadline = self.started + request['timeoutMs'] / 1000
        self.last_update = 0
        self.phase = 'checking'
        self.package_phase = False
        self.lease_fd = None
        self.launcher_directory = Path(sys.executable).parent
        self.catalog = catalog()
        self.directory = ROOT / self.catalog['id']

    def state(self, **fields):
        from workstation_jobs import job_lock, read_state, write_state
        with job_lock(self.request['jobId']):
            state = read_state(self.request['jobId'])
            setup = state.get('setup', {})
            if fields.get('phase', self.phase) != self.phase:
                setup = {}
            self.phase = fields.get('phase', self.phase)
            setup.update(phase=self.phase, elapsedSeconds=int(time.time() - self.started), **{k: v for k, v in fields.items() if k != 'phase'})
            setup['cancelDeferred'] = self.package_phase
            state.update(setup=setup)
            write_state(self.request['jobId'], state)
            return state

    def check(self):
        from workstation_jobs import job_lock, read_state
        with job_lock(self.request['jobId']):
            state = read_state(self.request['jobId'])
        if state.get('cancelRequested'):
            raise SetupError('CANCELLED', 'Setup stopped at a safe boundary. Existing files are retained.')
        if time.time() > self.deadline:
            raise SetupError('JOB_TIMEOUT', 'Setup reached its time budget. Completed work is retained.')

    def run(self, args, package=False):
        self.check()
        self.package_phase = package
        self.state()
        environment = {**os.environ, 'DEBIAN_FRONTEND': 'noninteractive'}
        environment.pop('LD_PRELOAD', None)
        process = subprocess.Popen(args, stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=environment, start_new_session=True, pass_fds=(self.lease_fd,) if package and self.lease_fd is not None else ())
        output = bytearray()
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ)
        selector.register(process.stderr, selectors.EVENT_READ)
        try:
            while process.poll() is None:
                for key, _ in selector.select(.25):
                    chunk = os.read(key.fileobj.fileno(), 8192)
                    if chunk and key.fileobj is process.stdout:
                        output.extend(chunk); del output[:-65536]
                    elif chunk: pass  # PRoot warnings must not become package names.
                    else: selector.unregister(key.fileobj)
                if not package:
                    self.check()
                if time.time() - self.last_update > 2:
                    self.state(); self.last_update = time.time()
            # Drain a bounded remainder after exit.
            output.extend(process.stdout.read(65536)); del output[:-65536]
            if process.returncode:
                raise SetupError('SETUP_PACKAGE_REPAIR_REQUIRED' if package else 'SETUP_EXISTING_INSTALLATION', f'The setup command exited with code {process.returncode}. Existing files were retained; inspect package health before retrying.')
            return output.decode(errors='replace')
        finally:
            selector.close()
            process.stdout.close()
            process.stderr.close()
            if process.poll() is None and not package:
                os.killpg(process.pid, 9); process.wait()
            self.package_phase = False

    def progress(self, size, total):
        if time.time() - self.last_update > .5 or size == total:
            self.state(phase='downloading', downloadedBytes=size, totalBytes=total)
            self.last_update = time.time()

    def install(self):
        if ROOT.is_symlink() or self.directory.is_symlink():
            raise SetupError('SETUP_EXISTING_INSTALLATION', 'Setup storage ownership changed.')
        ROOT.mkdir(mode=0o700, parents=True, exist_ok=True)
        self.directory.mkdir(mode=0o700, exist_ok=True)
        (common.WORKSTATION_HOME / 'bootstrap').mkdir(mode=0o700, exist_ok=True)
        with (ROOT / 'install.lock').open('a') as lock:
            try: fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError: raise SetupError('SETUP_BUSY', 'Another setup operation is still running.')
            self.lease_fd = lock.fileno()
            launcher = common.resolve_nh_path()
            if launcher:
                # A failed existing launcher is never permission to replace its rootfs.
                release = self.run(common.nh_argv('cat', ['/etc/os-release']))
                if 'ID=kali' not in release and 'ID="kali"' not in release:
                    raise SetupError('SETUP_EXISTING_INSTALLATION', 'The existing launcher did not identify Kali.')
                self.install_tools(launcher)
            else:
                self.fresh()
            self.state(phase='checking_tools')
            self.run(common.nh_argv('python3', ['-c', 'import json;print(json.dumps({"ok":True}))']))
            self.run(common.nh_argv('nmap', ['--version']))
            self.run(common.nh_argv('msfconsole', ['--version']))
            self.state(phase='ready')

    def fresh(self):
        if self.run(['dpkg', '--print-architecture']).strip() != self.catalog['termuxArchitecture']:
            raise SetupError('DEVICE_UNSUPPORTED', 'Automatic Kali installation currently supports ARM64 Termux.')
        home = Path.home()
        destination = home / self.catalog['rootDirectory']
        marker = destination / '.oni-setup-catalog'
        prefix = self.launcher_directory
        launchers = [prefix / 'nethunter', prefix / 'nh']
        owned = destination.is_dir() and not destination.is_symlink() and marker.is_file() and marker.read_text() == self.catalog['id']
        if (destination.exists() or destination.is_symlink()) and not owned:
            raise SetupError('SETUP_EXISTING_INSTALLATION', 'An existing Kali directory needs inspection; it was not changed.')
        expected = launcher_source(destination)
        for path in launchers:
            if os.path.lexists(path) and (path.is_symlink() or path.read_bytes() != expected):
                raise SetupError('SETUP_EXISTING_INSTALLATION', 'An existing launcher was preserved.')
        if not owned:
            if shutil.disk_usage(home).free < self.catalog['reserveBytes']:
                raise SetupError('STORAGE_FULL', 'Allow at least 8 GiB free for Kali, tool packages and working space.')
            self.state(phase='installing_prerequisites')
            # Coordinate Oni's Termux package operations; apt also holds its own locks.
            with (common.WORKSTATION_HOME / 'bootstrap/install.lock').open('a') as package_lock:
                try: fcntl.flock(package_lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
                except BlockingIOError: raise SetupError('SETUP_BUSY', 'Termux package setup is already running.')
                if shutil.which('proot') is None:
                    self.run(['apt-get', '-o', 'DPkg::Lock::Timeout=60', 'update'], package=True)
                    self.run(['apt-get', '-o', 'DPkg::Lock::Timeout=60', '-o', 'Dpkg::Options::=--force-confold', '-y', '--no-remove', 'install', 'proot'], package=True)
            image = self.directory / 'rootfs.tar.xz'
            self.state(phase='downloading')
            download(self.catalog, image, self.progress, self.check)
            self.state(phase='extracting')
            staging = self.directory / 'staging'
            if staging.exists():
                # This catalog-owned staging is never a user's final rootfs.
                if staging.is_symlink(): raise SetupError('SETUP_EXISTING_INSTALLATION', 'Staging ownership changed.')
                shutil.rmtree(staging)
            extract(image, staging, self.catalog, self.check)
            root = staging / self.catalog['rootDirectory']
            self.state(phase='configuring_kali')
            self.run(raw_kali(root, ['sh', '-c', 'test -x /bin/bash && . /etc/os-release && test "$ID" = kali']))
            # Persist ownership before publication so an interrupted rename is recoverable.
            common.atomic_write(root / '.oni-setup-catalog', self.catalog['id'].encode())
            root.rename(destination)
        configure_fresh_dns(destination)
        configure_fresh_database_policy(destination)
        self.install_tools(None, destination)
        self.run(raw_kali(destination, ['usermod', '-u', str(os.getuid()), 'kali']))
        self.run(raw_kali(destination, ['groupmod', '-g', str(os.getgid()), 'kali']))
        # Atomic per-file publication; retries accept only our exact bytes.
        for path in launchers:
            common.atomic_write(path, expected); path.chmod(0o700)
        self.check()

    def install_tools(self, launcher, root=None):
        def argv(args):
            return [str(launcher), '-r', shlex.join(args)] if launcher else raw_kali(root, args)
        # Resolve only fixed package names, and do not upgrade an already-present tool.
        script = 'for p in python3 nmap metasploit-framework sudo; do dpkg-query -W -f=\'${Status}\' "$p" 2>/dev/null | grep -qx "install ok installed" || printf "%s\\n" "$p"; done'
        missing = self.run(argv(['sh', '-c', script])).strip().splitlines()
        if not missing: return
        if not set(missing) <= set(self.catalog['kaliPackages']):
            raise SetupError('PARSER_FAILED', 'Unexpected package detection result.')
        self.state(phase='installing_tools')
        # Never replace an existing service policy. The owned marker supports crash recovery.
        script = '''set -eu
policy=/usr/sbin/policy-rc.d
marker=/root/.oni-setup-policy
if [ -e "$policy" ]; then
  [ -f "$marker" ] && cmp -s "$marker" "$policy" || exit 73
else
  [ ! -L "$policy" ] || exit 73
  umask 077
  printf '#!/bin/sh\nexit 101\n' > "$marker"
  cp "$marker" "$policy"
  chmod 755 "$policy"
fi
pgpolicy=/etc/postgresql-common/createcluster.conf
pgstate=/root/.oni-setup-pg-policy
pgowned=false
cleanup() {
  if cmp -s "$marker" "$policy"; then rm -f "$policy" "$marker"; fi
  if [ "$pgowned" = true ] && cmp -s "$pgstate/applied" "$pgpolicy"; then
    if [ -f "$pgstate/original" ]; then cp -p "$pgstate/original" "$pgpolicy"; else rm -f "$pgpolicy"; fi
    rm -f "$pgstate/applied" "$pgstate/original"
    rmdir "$pgstate"
  fi
}
trap cleanup EXIT
[ ! -L "$pgstate" ] && [ ! -L /etc/postgresql-common ] && [ ! -L "$pgpolicy" ] || exit 73
if [ -e "$pgstate" ]; then
  [ -d "$pgstate" ] && cmp -s "$pgstate/applied" "$pgpolicy" || exit 73
else
  mkdir -m 700 "$pgstate"
  if [ -e "$pgpolicy" ]; then [ -f "$pgpolicy" ] || exit 73; cp -p "$pgpolicy" "$pgstate/original"; fi
  { if [ -f "$pgstate/original" ]; then cat "$pgstate/original"; fi; printf '\ncreate_main_cluster = false\n'; } > "$pgstate/applied"
  mkdir -p /etc/postgresql-common
  cp "$pgstate/applied" "$pgpolicy"
  chmod 644 "$pgpolicy"
fi
pgowned=true
export DEBIAN_FRONTEND=noninteractive
[ -z "$(dpkg --audit)" ] || exit 74
apt-get -o DPkg::Lock::Timeout=60 -o Acquire::Retries=2 -o Acquire::http::Timeout=30 -o APT::Update::Error-Mode=any update
apt-get -o DPkg::Lock::Timeout=60 -o Acquire::Retries=2 -o Acquire::http::Timeout=30 -o Dpkg::Options::=--force-confold -y --no-remove install "$@"
'''
        self.run(argv(['sh', '-c', script, 'oni-tools', *missing]), package=True)
        self.check()


def execute_setup(request):
    from workstation_jobs import job_lock, read_state, write_state
    installer = Installer(request)
    key, detail = None, None
    try:
        installer.install()
    except SetupError as error:
        key, detail = error.key, error.detail
    except OSError as error:
        key = 'STORAGE_FULL' if error.errno == 28 else 'SETUP_INTERRUPTED'
        detail = 'Setup stopped. Existing files and completed work are retained.'
    except Exception:
        key, detail = 'SETUP_INTERRUPTED', 'Setup stopped before verification. Inspect the retained installation before retrying.'
    with job_lock(request['jobId']):
        state = read_state(request['jobId'])
        status = 'completed' if key is None else 'cancelled' if key == 'CANCELLED' else 'failed'
        state.update(status=status, ok=key is None, errorKey=None if key == 'CANCELLED' else key, detail=detail, exitCode=0 if key is None else 1)
        write_state(request['jobId'], state)
        return state

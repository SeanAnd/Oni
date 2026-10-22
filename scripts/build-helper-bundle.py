"""Deterministic APK assets; only manifest-listed, hash-verified source is bundled."""
import hashlib
import json
from pathlib import Path
import zipfile

root = Path(__file__).resolve().parents[1]
backend = root / 'backend'
manifest_path = backend / 'bootstrap/manifest.json'
manifest = json.loads(manifest_path.read_text())
manifest['backendVersion'] = '1.3.1'
manifest['requiredPackages'] = ['python', 'postgresql']
files = {entry['name']: entry['path'] for entry in manifest['scripts']}
for name in ['workstation-db', 'workstation_database.py', 'workstation-credentials', 'workstation-helper-start', 'workstation-profile-check', 'workstation_msf_config.py', 'workstation-msfdb-client', 'workstation_msfdb.py', 'workstation_msfdb_maintenance.py']:
    files[name] = 'scripts/' + name
files['setup-catalog.json'] = 'bootstrap/setup-catalog.json'
for name in ['workstation_setup.py', 'workstation_setup_archive.py', 'workstation-setup-probe']:
    files[name] = 'scripts/' + name
files['0001_msf_role.sql'] = 'migrations/termux/0001_msf_role.sql'
manifest['scripts'] = [dict(name=name, path=path, sha256=hashlib.sha256((backend / path).read_bytes()).hexdigest()) for name, path in sorted(files.items())]
manifest_path.write_text(json.dumps(manifest, indent=2) + '\n')
assets = root / 'modules/termux/android/src/main/assets'
assets.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(assets / 'skid-backend.zip', 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for name, content in [('manifest.json', manifest_path.read_bytes()), *[(entry['name'], (backend / entry['path']).read_bytes()) for entry in manifest['scripts']]]:
        info = zipfile.ZipInfo(name, date_time=(2026, 1, 1, 0, 0, 0))
        info.external_attr = 0o100600 << 16
        archive.writestr(info, content, compress_type=zipfile.ZIP_DEFLATED)
(assets / 'skid-receive-bundle.py').write_bytes((backend / 'bootstrap/receive_bundle.py').read_bytes())
print('Verified bundle:', (assets / 'skid-backend.zip').stat().st_size, 'bytes')

(assets / 'oni-ensure-python.sh').write_bytes((backend / 'bootstrap/ensure-termux-python.sh').read_bytes())

import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tarfile
import tempfile
import time
import unittest
from unittest.mock import patch

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
from workstation_setup_archive import SetupError, extract, download
from workstation_jobs import parse_request


class SetupArchiveTests(unittest.TestCase):
    def archive(self, base, entries):
        path = base / 'root.tar.xz'
        with tarfile.open(path, 'w:xz') as output:
            for name, kind, value in entries:
                item = tarfile.TarInfo(name); item.mode = 0o755
                if kind == 'file':
                    item.size = len(value); output.addfile(item, io.BytesIO(value))
                else:
                    item.type = tarfile.SYMTYPE if kind == 'symlink' else tarfile.LNKTYPE
                    item.linkname = value; output.addfile(item)
        return path

    def test_linux_links_preserved_without_following_them_during_extraction(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            archive = self.archive(root, [('kali/usr/file', 'file', b'original'), ('kali/usr/copy', 'hardlink', 'kali/usr/file'), ('kali/bin', 'symlink', '/usr')])
            extract(archive, root/'stage', {'rootDirectory':'kali','maximumExpandedBytes':100}, lambda:None)
            self.assertEqual((root/'stage/kali/usr/copy').read_bytes(), b'original')
            self.assertEqual(os.readlink(root/'stage/kali/bin'), '/usr')

    def test_traversal_and_link_write_through_rejected_before_any_extraction(self):
        for entries in [[('kali/../outside','file',b'bad')], [('kali/link','symlink','/tmp'), ('kali/link/file','file',b'bad')], [('kali/file','hardlink','../outside')]]:
            with self.subTest(entries=entries), tempfile.TemporaryDirectory() as tmp:
                root=Path(tmp); archive=self.archive(root,entries)
                with self.assertRaises(SetupError):extract(archive,root/'stage',{'rootDirectory':'kali','maximumExpandedBytes':100},lambda:None)
                self.assertFalse((root/'stage').exists())

    def test_expansion_limit_and_existing_tree_are_preserved(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); archive=self.archive(root,[('kali/file','file',b'data')]); catalog={'rootDirectory':'kali','maximumExpandedBytes':2}
            with self.assertRaises(SetupError):extract(archive,root/'stage',catalog,lambda:None)
            (root/'stage').mkdir();(root/'stage/keep').write_text('mine')
            with self.assertRaises(SetupError):extract(archive,root/'stage',catalog,lambda:None)
            self.assertEqual((root/'stage/keep').read_text(),'mine')

    def test_range_ignored_restarts_and_digest_mismatch_never_publishes(self):
        import hashlib
        class Response(io.BytesIO):
            status=200;headers={};url='https://official.invalid/root'
        with tempfile.TemporaryDirectory() as tmp:
            target=Path(tmp)/'root.xz';target.with_suffix('.partial').write_bytes(b'ab')
            catalog={'url':Response.url,'downloadBytes':4,'sha256':hashlib.sha256(b'abcd').hexdigest()}
            with patch('urllib.request.urlopen',return_value=Response(b'abcd')):
                download(catalog,target,lambda *_:None,lambda:None)
            self.assertEqual(target.read_bytes(),b'abcd')
            target.write_bytes(b'bad')
            with self.assertRaises(SetupError):download(catalog,target,lambda *_:None,lambda:None)

    def test_setup_deadline_does_not_expand_other_job_authority(self):
        request=dict(jobId='j',projectId='p',operationId='o',timeoutMs=7200000,task=dict(type='setup.nethunter',catalogId='kali-2026.2-minimal-arm64-v1'))
        self.assertIsNotNone(parse_request(json.dumps(request))[0])
        request['task']['url']='https://untrusted.invalid'
        self.assertIsNone(parse_request(json.dumps(request))[0])
        request['task']={'type':'kali.health'}
        self.assertIsNone(parse_request(json.dumps(request))[0])

    def test_interrupted_download_resumes_verified_bytes(self):
        import hashlib
        class Interrupted:
            status=200; headers={}; url='https://official.invalid/root'
            def __enter__(self): self.first=True; return self
            def __exit__(self, *_): pass
            def read(self, _):
                if self.first: self.first=False; return b'ab'
                raise ConnectionResetError()
        class Remainder(io.BytesIO):
            status=206; headers={'Content-Range':'bytes 2-3/4'}; url=Interrupted.url
        with tempfile.TemporaryDirectory() as tmp:
            target=Path(tmp)/'root.xz'
            catalog={'url':Interrupted.url,'downloadBytes':4,'sha256':hashlib.sha256(b'abcd').hexdigest()}
            with patch('urllib.request.urlopen', return_value=Interrupted()), self.assertRaises(SetupError):
                download(catalog,target,lambda *_:None,lambda:None)
            self.assertFalse(target.exists())
            self.assertEqual(target.with_suffix('.partial').read_bytes(),b'ab')
            with patch('urllib.request.urlopen', return_value=Remainder(b'cd')) as request:
                download(catalog,target,lambda *_:None,lambda:None)
                self.assertEqual(request.call_args.args[0].get_header('Range'),'bytes=2-')
            self.assertEqual(target.read_bytes(),b'abcd')


class PythonBootstrapTests(unittest.TestCase):
    def test_runnable_python_cannot_hide_interrupted_or_failed_package_audit(self):
        for audit in ['echo "python requires reinstallation"', 'exit 1']:
            with self.subTest(audit=audit), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                binaries = root / 'bin'
                binaries.mkdir()
                source = (SCRIPTS.parent / 'bootstrap/ensure-termux-python.sh').read_text().replace(
                    'export PATH=/data/data/com.termux/files/usr/bin:/system/bin',
                    f'export PATH={binaries}:/usr/bin:/bin')
                script = root / 'bootstrap.sh'
                script.write_text(source)
                for name, body in {
                    'python3': 'exit 0',
                    'pkg': 'exit 0',
                    'dpkg': f'case "$1" in --audit) {audit};; --print-architecture) echo aarch64;; esac',
                    'apt-get': 'touch "$HOME/unexpected-install"; exit 1',
                }.items():
                    path = binaries / name
                    path.write_text('#!/bin/sh\n' + body + '\n')
                    path.chmod(0o700)
                def call(action):
                    response = subprocess.run(['/bin/bash', str(script), action, 'interrupted'],
                        env={**os.environ, 'HOME': tmp}, capture_output=True, text=True, timeout=10)
                    self.assertEqual(response.returncode, 0, response.stderr)
                    return json.loads(response.stdout)
                probe = call('probe')
                self.assertTrue(probe['pythonReady'])
                self.assertFalse(probe['ok'])
                self.assertEqual(probe['errorKey'], 'SETUP_PACKAGE_REPAIR_REQUIRED')
                result = call('start')
                for _ in range(100):
                    if result['status'] != 'running':
                        break
                    time.sleep(.03)
                    result = call('status')
                self.assertEqual(result['status'], 'failed', result)
                self.assertEqual(result['errorKey'], 'SETUP_PACKAGE_REPAIR_REQUIRED')
                self.assertFalse((root / 'unexpected-install').exists())

    def test_no_python_probe_then_install_and_replay_do_not_reinstall(self):
        # Host package-command doubles prove the bootstrap itself never needs Python.
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); binaries=root/'bin';binaries.mkdir()
            source=(SCRIPTS.parent/'bootstrap/ensure-termux-python.sh').read_text().replace('export PATH=/data/data/com.termux/files/usr/bin:/system/bin',f'export PATH={binaries}:/usr/bin:/bin')
            script=root/'bootstrap.sh';script.write_text(source)
            for name, body in {
                'python3':'test -f "$HOME/installed"',
                'pkg':'exit 0',
                'dpkg':'if [ "$1" = --print-architecture ]; then echo aarch64; fi',
                'apt-get':'echo command >> "$HOME/calls"; case "$*" in *install*) touch "$HOME/installed";; esac',
            }.items():
                p=binaries/name;p.write_text('#!/bin/sh\n'+body+'\n');p.chmod(0o700)
            env={**os.environ,'HOME':tmp}
            def call(action):
                result=subprocess.run(['/bin/bash',str(script),action,'test'],env=env,capture_output=True,text=True,timeout=10)
                self.assertEqual(result.returncode,0,result.stderr)
                return json.loads(result.stdout)
            self.assertFalse(call('probe')['pythonReady'])
            call('start')
            for _ in range(100):
                result=call('status')
                if result['status']!='running':break
                time.sleep(.03)
            self.assertEqual(result['status'],'completed',result)
            self.assertTrue(call('probe')['pythonReady'])
            count=(root/'calls').read_text()
            self.assertEqual(call('start')['status'],'completed')
            self.assertEqual((root/'calls').read_text(),count)


class SetupCommandTests(unittest.TestCase):
    def test_package_policy_blocks_cluster_creation_and_restores_original(self):
        import shlex
        from workstation_setup import Installer
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp)
            for name in ['usr/sbin','etc/postgresql-common','root','bin']:
                (root/name).mkdir(parents=True,exist_ok=True)
            policy=root/'etc/postgresql-common/createcluster.conf'
            original='# User configuration\ncreate_main_cluster = true\n'
            policy.write_text(original); policy.chmod(0o600)
            for name,body in {'dpkg':'exit 0', 'apt-get':f'test "$(tail -n 1 {policy})" = "create_main_cluster = false" || exit 99'}.items():
                path=root/'bin'/name; path.write_text('#!/bin/sh\n'+body+'\n');path.chmod(0o700)
            installer=Installer({'jobId':'test','timeoutMs':10000})
            def run(args, package=False):
                if not package:return 'metasploit-framework\n'
                command=shlex.split(args[2])
                script=command[2]
                for prefix in ['/usr/sbin','/etc/postgresql-common','/root']:
                    script=script.replace(prefix,str(root/prefix.lstrip('/')))
                result=subprocess.run(['/bin/sh','-c',script,*command[3:]],capture_output=True,text=True,
                                      env={**os.environ,'PATH':str(root/'bin')+':/usr/bin:/bin'})
                self.assertEqual(result.returncode,0,result.stderr)
                return ''
            with patch.object(installer,'run',side_effect=run), patch.object(installer,'state'), patch.object(installer,'check'):
                installer.install_tools(Path('/bin/nh'))
            self.assertEqual(policy.read_text(),original)
            self.assertEqual(policy.stat().st_mode & 0o777,0o600)
            self.assertFalse((root/'usr/sbin/policy-rc.d').exists())
            self.assertFalse((root/'root/.oni-setup-pg-policy').exists())

    def test_unknown_existing_kali_tree_is_never_replaced(self):
        from workstation_setup import Installer
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); user_tree=root/'kali-arm64'; user_tree.mkdir(); (user_tree/'keep').write_text('mine')
            installer=Installer({'jobId':'test','timeoutMs':10000})
            installer.launcher_directory=root/'bin'
            with patch('workstation_setup.Path.home', return_value=root), patch.object(installer,'run',return_value='aarch64'), self.assertRaises(SetupError) as caught:
                installer.fresh()
            self.assertEqual(caught.exception.key,'SETUP_EXISTING_INSTALLATION')
            self.assertEqual((user_tree/'keep').read_text(),'mine')

    def test_proot_warnings_cannot_be_parsed_as_missing_packages(self):
        from workstation_setup import Installer
        installer = Installer({'jobId': 'test', 'timeoutMs': 10000})
        with patch.object(installer, 'check'), patch.object(installer, 'state'):
            result = installer.run([sys.executable, '-c',
                                    'import sys; print("nmap"); sys.stderr.write("proot warning\\n" * 20000)'])
        self.assertEqual(result, 'nmap\n')

class SetupPublicationRecoveryTests(unittest.TestCase):
    def test_low_storage_fails_before_package_or_download_changes(self):
        from workstation_setup import Installer
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp); installer=Installer({'jobId':'space','timeoutMs':10000})
            installer.launcher_directory=root/'bin'; installer.launcher_directory.mkdir()
            with patch('workstation_setup.Path.home',return_value=root), patch.object(installer,'run',return_value='aarch64') as command, patch('workstation_setup.shutil.disk_usage',return_value=SimpleNamespace(free=0)), self.assertRaises(SetupError) as error:
                installer.fresh()
            self.assertEqual(error.exception.key,'STORAGE_FULL')
            self.assertEqual(command.call_args_list[0].args[0],['dpkg','--print-architecture'])
            self.assertEqual(command.call_count,1)
            self.assertEqual(list(root.iterdir()),[installer.launcher_directory])

    def test_half_published_launchers_retry_without_replacing_the_owned_tree(self):
        from workstation_setup import Installer,launcher_source
        import workstation_common as common
        with tempfile.TemporaryDirectory() as tmp:
            home=Path(tmp); root=home/'kali-arm64'; root.mkdir()
            installer=Installer({'jobId':'publish','timeoutMs':10000})
            installer.launcher_directory=home/'bin'; installer.launcher_directory.mkdir()
            (root/'.oni-setup-catalog').write_text(installer.catalog['id']); (root/'keep').write_text('verified tree')
            first=installer.launcher_directory/'nethunter'; second=installer.launcher_directory/'nh'
            original=common.atomic_write
            def interrupt(path,data):
                if path==second: raise OSError('simulated publication interruption')
                return original(path,data)
            with patch('workstation_setup.Path.home',return_value=home), patch.object(installer,'run',return_value='aarch64'), patch.object(installer,'check'), patch.object(installer,'install_tools'), patch('workstation_setup.configure_fresh_dns'), patch('workstation_setup.configure_fresh_database_policy'):
                with patch('workstation_setup.common.atomic_write',side_effect=interrupt), self.assertRaises(OSError): installer.fresh()
                expected=launcher_source(root)
                self.assertEqual(first.read_bytes(),expected); self.assertFalse(second.exists())
                installer.fresh()
                self.assertEqual(second.read_bytes(),expected)
                self.assertEqual((root/'keep').read_text(),'verified tree')
                first.write_text('# user edited launcher\n')
                with self.assertRaises(SetupError) as error: installer.fresh()
                self.assertEqual(error.exception.key,'SETUP_EXISTING_INSTALLATION')
                self.assertEqual(first.read_text(),'# user edited launcher\n')

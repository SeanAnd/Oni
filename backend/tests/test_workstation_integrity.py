"""Regression tests use real child processes and disposable workstation directories."""
import copy
import importlib.machinery
import importlib.util
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

SCRIPTS = Path(__file__).resolve().parents[1] / 'scripts'
sys.path.insert(0, str(SCRIPTS))
import workstation_common as common
import workstation_jobs as jobs
import workstation_helper as helper


def request():
    return dict(jobId='job-1', projectId='project-1', operationId='op-1', timeoutMs=15000,
                command=dict(binary='nmap', args=['--unprivileged', '-sT', '-Pn', '-n', '-p', '22,80', '-oX', '-', '127.0.0.1']))


class PolicyTests(unittest.TestCase):
    def test_only_bounded_nmap_policy_is_accepted(self):
        self.assertIsNotNone(jobs.parse_request(json.dumps(request()))[0])
        commands = [dict(binary='python3', args=['-c', 'print(1)']), dict(binary='msfconsole', args=['-x', 'exit']),
                    dict(binary='nmap', args=['--script', '/tmp/code']), dict(binary='nmap', args=['--version'], cwd='/tmp')]
        for command in commands:
            value = request(); value['command'] = command
            with self.subTest(command=command): self.assertIsNone(jobs.parse_request(json.dumps(value))[0])

    def test_limits_and_shell_metacharacters_are_rejected_at_execution(self):
        for target in ['0.0.0.0/0', '127.0.0.1;id', '$(id)', 'localhost', '::1', '-iL', '127.0.0.1\n']:
            value = request(); value['command']['args'][-1] = target
            with self.subTest(target=target): self.assertIsNone(jobs.parse_request(json.dumps(value))[0])
        for ports in ['0', '65536', '1-33', '1,', '1,,2', '-1', '22;id']:
            value = request(); value['command']['args'][5] = ports
            with self.subTest(ports=ports): self.assertIsNone(jobs.parse_request(json.dumps(value))[0])
        for timeout in [True, 0, 180001, 15000.5, '15000']:
            value = request(); value['timeoutMs'] = timeout
            with self.subTest(timeout=timeout): self.assertIsNone(jobs.parse_request(json.dumps(value))[0])

    def test_ids_cannot_escape_or_alias_directories(self):
        for value in ['.', '..', '../x', 'x/y', 'x\n', '', None, 42, 'a' * 129]:
            with self.subTest(value=value): self.assertIsNotNone(common.validate_id(value, 'id'))

    def test_nh_shell_boundary_preserves_arguments(self):
        with tempfile.TemporaryDirectory() as temporary:
            launcher = Path(temporary) / 'nh'
            launcher.write_text('#!/bin/sh\nexec /bin/sh -c "$*"\n'); launcher.chmod(0o700)
            value = 'quotes " spaces ; $(false) & newline\nend'
            with mock.patch.dict(os.environ, {'NH_PATH': str(launcher)}):
                result = common.run_kali(sys.executable, ['-c', 'import sys;print(sys.argv[1],end="")', value])
            self.assertEqual(result.stdout, value)


class ProcessTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.previous = common.WORKSTATION_HOME
        common.rebind_workstation_home(Path(self.tmp.name))
        common.ensure_layout()
        self.launcher = Path(self.tmp.name) / 'nh'
        self.environment = {**os.environ, 'SKID_WORKSTATION_HOME': self.tmp.name, 'NH_PATH': str(self.launcher)}
        self.process = None

    def tearDown(self):
        if self.process:
            state = jobs.read_state('job-1')
            if state: jobs.terminate_group(state.get('processPid', 0), state.get('processIdentity'))
            if self.process.poll() is None: self.process.kill()
            self.process.communicate(timeout=5)
        common.rebind_workstation_home(self.previous)
        self.tmp.cleanup()

    def start(self, script):
        self.launcher.write_text('#!/bin/sh\n' + script); self.launcher.chmod(0o700)
        self.process = subprocess.Popen([sys.executable, str(SCRIPTS / 'workstation-run'), '--request-json', json.dumps(request())], env=self.environment, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
        return self.process

    def wait_for_process(self):
        deadline = time.monotonic() + 4
        while time.monotonic() < deadline:
            state = jobs.read_state('job-1')
            if state and state.get('processIdentity'): return state
            time.sleep(.02)
        self.fail('Worker did not publish process identity')

    def test_cancel_kills_child_and_is_acknowledged_only_after_exit(self):
        self.start('sleep 60 &\nwait\n')
        state = self.wait_for_process()
        self.assertIsNone(jobs.cancel_job('job-1', 'wrong-operation'))
        self.assertEqual(jobs.load_job('job-1', 'op-1')['status'], 'running')
        result = jobs.cancel_job('job-1', 'op-1')
        self.assertEqual(result['status'], 'cancelled')
        self.assertIsNone(jobs.process_identity(state['processPid']))
        output, errors = self.process.communicate(timeout=5)
        self.assertEqual(json.loads(output)['status'], 'cancelled', errors)
        self.assertEqual(jobs.cancel_job('job-1', 'op-1')['status'], 'cancelled')

    def test_worker_death_is_reconciled_and_orphan_process_is_killed(self):
        self.start('sleep 60 &\nwait\n')
        state = self.wait_for_process()
        self.process.kill(); self.process.wait(timeout=5)
        result = jobs.load_job('job-1', 'op-1')
        self.assertEqual(result['status'], 'failed')
        deadline = time.monotonic() + 2
        while jobs.process_identity(state['processPid']) and time.monotonic() < deadline: time.sleep(.02)
        self.assertIsNone(jobs.process_identity(state['processPid']))

    def test_completed_result_preserves_correlation_artifact_hash_and_deduplication(self):
        self.start("printf '<!DOCTYPE nmaprun><nmaprun></nmaprun>'\n")
        output, _ = self.process.communicate(timeout=5)
        result = json.loads(output)
        self.assertEqual(result['projectId'], 'project-1')
        self.assertEqual(result['operationId'], 'op-1')
        artifact = common.ARTIFACT_DIR / (result['artifactIds'][0] + '.log')
        metadata = json.loads(artifact.with_suffix('.json').read_text())
        self.assertEqual(metadata['sha256'], common.sha256_file(artifact))
        with mock.patch.object(jobs.subprocess, 'Popen') as popen:
            self.assertEqual(jobs.execute(request())['status'], 'completed')
            popen.assert_not_called()
        changed = request(); changed['projectId'] = 'different'
        self.assertFalse(jobs.execute(changed)['ok'])

    def test_failed_output_is_retained_for_diagnostics(self):
        self.start("printf '<nmaprun>'; exit 2\n")
        output, _ = self.process.communicate(timeout=5)
        result = json.loads(output)
        self.assertEqual(result['status'], 'failed')
        self.assertEqual(len(result['artifactIds']), 1)
        self.assertFalse(result['observationsPending'])


class BootstrapTests(unittest.TestCase):
    def test_installed_bundle_imports_and_private_permissions(self):
        backend = SCRIPTS.parent
        with tempfile.TemporaryDirectory() as temporary:
            completed = subprocess.run(['bash', str(backend / 'bootstrap/install-termux.sh')], env={**os.environ, 'HOME': temporary}, text=True, capture_output=True)
            self.assertEqual(completed.returncode, 0, completed.stderr)
            root = Path(temporary) / '.rootless-workstation'
            self.assertEqual((root / 'state/helper_token').stat().st_mode & 0o777, 0o600)
            for executable in ['workstation-health', 'workstation-run', 'workstation-helper', 'workstation-msf-config', 'workstation-msf-verify']:
                result = subprocess.run([str(root / 'bin' / executable), '--help'], text=True, capture_output=True)
                self.assertEqual(result.returncode, 0, result.stderr)


class HelperBoundaryTests(unittest.TestCase):
    def test_corrupt_artifact_metadata_returns_a_stable_error(self):
        valid = dict(operationId='op', size=1, sha256='a' * 64)
        invalid = [None, [], 1, 'text', {}, {'operationId': 'op', 'size': 1},
                   {**valid, 'size': True}, {**valid, 'size': -1}, {**valid, 'size': 1.0},
                   {**valid, 'sha256': None}, {**valid, 'sha256': 'z' * 64},
                   {**valid, 'sha256': 'a' * 64 + '\n'}, {**valid, 'operationId': []}]
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / 'artifact.log').write_bytes(b'x')
            handler = object.__new__(helper.WorkstationHelperHandler)
            handler._send = mock.Mock()
            with mock.patch.object(helper, 'ARTIFACT_DIR', directory):
                for metadata in invalid:
                    with self.subTest(metadata=metadata):
                        (directory / 'artifact.json').write_text(json.dumps(metadata))
                        handler._handle_artifact_chunk(dict(artifactId='artifact', operationId='op', offset=0, limit=16))
                        self.assertEqual(handler._send.call_args.args[0], 500)
                        self.assertEqual(handler._send.call_args.args[1]['errorKey'], 'PARSER_FAILED')

    def test_artifact_metadata_read_is_bounded(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'artifact.json'
            path.write_text(json.dumps(dict(operationId='op', size=1, sha256='a'*64, extra='x'*4096)))
            self.assertIsNone(helper.read_artifact_metadata(path))
            path.write_text('{truncated')
            self.assertIsNone(helper.read_artifact_metadata(path))
            path.unlink()
            self.assertIsNone(helper.read_artifact_metadata(path))

    def test_invalid_unicode_json_and_non_ascii_auth_do_not_crash(self):
        self.assertIsNotNone(helper.read_json_body(b'\xff')[1])
        with mock.patch.object(helper, 'read_helper_token', return_value='abc'):
            self.assertFalse(helper.authorize('Bearer \xe9'))

    def test_artifact_requires_matching_operation_and_returns_bounded_bytes(self):
        with tempfile.TemporaryDirectory() as temporary:
            directory = Path(temporary)
            (directory / 'artifact.log').write_bytes(b'abcdef')
            (directory / 'artifact.json').write_text(json.dumps(dict(operationId='op', size=6, sha256='a'*64)))
            handler = object.__new__(helper.WorkstationHelperHandler)
            handler._send = mock.Mock()
            with mock.patch.object(helper, 'ARTIFACT_DIR', directory):
                handler._handle_artifact_chunk(dict(artifactId='artifact', operationId='wrong', offset=0, limit=3))
                self.assertEqual(handler._send.call_args.args[0], 404)
                handler._handle_artifact_chunk(dict(artifactId='artifact', operationId='op', offset=0, limit=3))
                self.assertEqual(handler._send.call_args.args[1]['dataBase64'], 'YWJj')
                for offset, limit in [(True, 3), (0, False), (-1, 3), (7, 3), (0, 65537)]:
                    handler._handle_artifact_chunk(dict(artifactId='artifact', operationId='op', offset=offset, limit=limit))
                    self.assertEqual(handler._send.call_args.args[0], 400)

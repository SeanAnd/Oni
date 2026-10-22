"""Unit tests for Metasploit workstation wrapper interpretation."""

from __future__ import annotations

import importlib.util
import subprocess
import sys
import unittest
from importlib.machinery import SourceFileLoader
from pathlib import Path

BACKEND = Path(__file__).resolve().parents[1]
SCRIPTS = BACKEND / "scripts"
if str(SCRIPTS) not in sys.path:
    sys.path.insert(0, str(SCRIPTS))


def load_verify_module():
    path = SCRIPTS / "workstation-msf-verify"
    spec = importlib.util.spec_from_loader(
        "workstation_msf_verify",
        loader=SourceFileLoader("workstation_msf_verify", str(path)),
    )
    if spec is None:
        raise RuntimeError("Unable to load workstation-msf-verify module spec.")
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    assert spec.loader is not None
    spec.loader.exec_module(module)
    return module


class WorkstationMsfVerifyTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.verify = load_verify_module()

    def test_interpret_db_status_detects_connection(self) -> None:
        completed = subprocess.CompletedProcess(
            args=["msfconsole"],
            returncode=0,
            stdout='SKID_DB_STATUS:{"connected":true,"schemaReady":true,"identityVerified":true}',
            stderr="",
        )
        ok, error_key, fields = self.verify.interpret_db_status(completed)
        self.assertTrue(ok)
        self.assertEqual(error_key, "")
        self.assertTrue(fields["connected"])

    def test_interpret_db_status_flags_auth_failure(self) -> None:
        completed = subprocess.CompletedProcess(
            args=["msfconsole"],
            returncode=1,
            stdout="",
            stderr="password authentication failed for user msf",
        )
        ok, error_key, fields = self.verify.interpret_db_status(completed)
        self.assertFalse(ok)
        self.assertEqual(error_key, "DATABASE_CREDENTIALS_INVALID")
        self.assertFalse(fields["connected"])

    def test_connection_refusal_reports_database_unavailable(self):
        result = subprocess.CompletedProcess([], 0, 'SKID_DB_STATUS:{"connected":false,"schemaReady":false}', 'connection refused')
        ok, key, fields = self.verify.interpret_db_status(result)
        self.assertFalse(ok)
        self.assertEqual(key, 'DATABASE_UNAVAILABLE')
        self.assertIn('Start the device database and check its saved credential.', fields['detail'])

    def test_incidental_password_text_does_not_claim_bad_credentials(self):
        result = subprocess.CompletedProcess([], 1, '', 'could not load password configuration file')
        self.assertEqual(self.verify.interpret_db_status(result)[1], 'METASPLOIT_UNAVAILABLE')

    def test_framework_disconnected_marker_needs_no_console_error_banner(self):
        result = subprocess.CompletedProcess([], 0, 'SKID_DB_STATUS:{"connected":false,"schemaReady":false}', '')
        ok, key, fields = self.verify.interpret_db_status(result)
        self.assertFalse(ok)
        self.assertEqual(key, 'DATABASE_UNAVAILABLE')
        self.assertIn('Start the device database and check its saved credential.', fields['detail'])


if __name__ == "__main__":
    unittest.main()

class MetasploitIntegrityTests(unittest.TestCase):
    def test_generic_connection_banner_does_not_prove_schema(self):
        verify = load_verify_module()
        result = subprocess.CompletedProcess([], 0, 'Connected to msf. Connection type: postgresql', '')
        ok, _, fields = verify.interpret_db_status(result)
        self.assertFalse(ok)
        self.assertFalse(fields['schemaReady'])

    def test_failed_exit_cannot_report_ready(self):
        verify = load_verify_module()
        result = subprocess.CompletedProcess([], 1, 'SKID_DB_STATUS:{"connected":true,"schemaReady":true,"identityVerified":true}', '')
        self.assertFalse(verify.interpret_db_status(result)[0])

    def test_credentials_are_json_encoded_and_written_privately_in_kali_home(self):
        import os
        import json
        import tempfile
        path = SCRIPTS / 'workstation-msf-config'
        loader = SourceFileLoader('msf_config_test', str(path))
        spec = importlib.util.spec_from_loader(loader.name, loader)
        config_module = importlib.util.module_from_spec(spec)
        loader.exec_module(config_module)
        password = 'colon: quote"\nproduction:\n  host: attacker # ${secret}'
        with tempfile.TemporaryDirectory() as home:
            config = dict(adapter='postgresql', password=password, host='127.0.0.1', port=5432, username='msf', database='msf')
            result = subprocess.run([sys.executable, '-c', config_module.KALI_CONFIG_PROGRAM], input=json.dumps(dict(profileId='termux-local', config=config)), text=True, capture_output=True, env={**os.environ, 'HOME': home})
            self.assertEqual(result.returncode, 0, result.stderr)
            target = Path(home) / '.msf4/skid-termux-local.json'
            self.assertEqual(json.loads(target.read_text())['production']['password'], password)
            self.assertEqual(target.stat().st_mode & 0o777, 0o600)
            self.assertNotIn(password, result.stdout + result.stderr)
            rejected, _ = config_module.parse_request(json.dumps(dict(jobId='job', password='secret', host='attacker')))
            self.assertIsNone(rejected)

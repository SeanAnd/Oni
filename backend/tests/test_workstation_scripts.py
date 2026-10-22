import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path

BACKEND_ROOT = Path(__file__).resolve().parents[1]
SCRIPTS_DIR = BACKEND_ROOT / "scripts"
sys.path.insert(0, str(SCRIPTS_DIR))

import workstation_common  # noqa: E402


class WorkstationScriptTests(unittest.TestCase):
    def test_validate_id_rejects_traversal(self) -> None:
        self.assertIsNotNone(workstation_common.validate_id("../job", "jobId"))

    def test_helper_token_roundtrip(self) -> None:
        with tempfile.TemporaryDirectory() as tmp:
            original_home = workstation_common.WORKSTATION_HOME
            workstation_common.rebind_workstation_home(Path(tmp))
            try:
                self.assertIsNone(workstation_common.read_helper_token())
                workstation_common.write_helper_token("test-token-value")
                self.assertEqual(workstation_common.read_helper_token(), "test-token-value")
            finally:
                workstation_common.rebind_workstation_home(original_home)

    def test_workstation_run_rejects_disallowed_binary(self) -> None:
        script = SCRIPTS_DIR / "workstation-run"
        payload = json.dumps(
            {
                "jobId": "job-1",
                "projectId": "project-1",
                "operationId": "operation-1",
                "command": {"binary": "curl", "args": ["-V"]},
            }
        )
        with tempfile.TemporaryDirectory() as tmp:
            completed = subprocess.run(
                [sys.executable, str(script), "--request-json", payload],
                capture_output=True,
                text=True,
                check=False,
                env={**os.environ, "SKID_WORKSTATION_HOME": tmp},
            )
        self.assertNotEqual(completed.returncode, 0)
        body = json.loads(completed.stdout)
        self.assertFalse(body["ok"])
        self.assertEqual(body["errorKey"], "INVALID_PAYLOAD")

    def test_workstation_run_stores_nmap_stdout_as_xml_artifact(self) -> None:
        script = SCRIPTS_DIR / "workstation-run"
        sample_xml = '<?xml version="1.0"?><nmaprun scanner="nmap"></nmaprun>'
        payload = json.dumps(
            {
                "jobId": "job-nmap-xml",
                "projectId": "project-1",
                "operationId": "operation-1",
                "command": {
                    "binary": "nmap",
                    "args": ["--unprivileged", "-sT", "-Pn", "-n", "-p", "22", "-oX", "-", "127.0.0.1"],
                },
            }
        )

        with tempfile.TemporaryDirectory() as tmp:
            nh_path = Path(tmp) / "nh"
            nh_path.write_text(
                "#!/bin/sh\n"
                "if [ -n \"$1\" ]; then\n"
                f"  printf '%s' '{sample_xml}'\n"
                "  exit 0\n"
                "fi\n"
                "exit 127\n",
                encoding="utf-8",
            )
            nh_path.chmod(0o755)
            env = {**os.environ, "SKID_WORKSTATION_HOME": tmp, "NH_PATH": str(nh_path)}
            completed = subprocess.run(
                [sys.executable, str(script), "--request-json", payload],
                capture_output=True,
                text=True,
                check=False,
                env=env,
            )
            artifact_files = list((Path(tmp) / "artifacts").glob("*.log"))
            self.assertEqual(completed.returncode, 0)
            body = json.loads(completed.stdout)
            self.assertTrue(body["ok"])
            self.assertEqual(len(artifact_files), 1)
            self.assertEqual(artifact_files[0].read_text(encoding="utf-8"), sample_xml)

    def test_workstation_health_missing_nh(self) -> None:
        script = SCRIPTS_DIR / "workstation-health"
        env = os.environ.copy()
        env.pop("NH_PATH", None)
        with tempfile.TemporaryDirectory() as tmp:
            env["SKID_WORKSTATION_HOME"] = tmp
            completed = subprocess.run(
                [sys.executable, str(script), "--json"],
                capture_output=True,
                text=True,
                check=False,
                env=env,
            )
        body = json.loads(completed.stdout)
        self.assertFalse(body["ok"])
        self.assertEqual(body["errorKey"], "NETHUNTER_NOT_FOUND")


if __name__ == "__main__":
    unittest.main()

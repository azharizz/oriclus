import subprocess
import sys
import unittest
from pathlib import Path


class AwsRuntimeTests(unittest.TestCase):
    def test_lambda_http_and_worker_flow(self):
        script = Path(__file__).with_name("aws_runtime_scenario.py")
        result = subprocess.run(
            [sys.executable, str(script)], capture_output=True, text=True, timeout=30
        )
        self.assertEqual(result.returncode, 0, result.stderr + result.stdout)
        self.assertIn("Cloud sessions, persistence, quota", result.stdout)

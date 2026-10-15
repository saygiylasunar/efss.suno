"""Session lifecycle tests: no Suno account or network needed."""
import json
import sys
import unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import collector


class SessionStateTests(unittest.TestCase):
    def test_connection_status_contains_no_cookie(self):
        session_secret = "sensitive-test-cookie-never-display"
        manager = collector.Manager()
        with patch.object(collector, "SunoSession", side_effect=lambda raw: SimpleNamespace(cookie=raw)):
            manager.connect(session_secret)
        status = manager.status()
        self.assertTrue(status["connected"])
        self.assertIsNotNone(status["connectedAt"])
        self.assertEqual(status["sessionStorage"], "memory-only")
        self.assertNotIn(session_secret, json.dumps(status))
        manager.disconnect()
        self.assertFalse(manager.status()["connected"])
        self.assertIsNone(manager.status()["connectedAt"])

    def test_session_change_rejected_while_busy(self):
        manager = collector.Manager()
        manager.syncing = True
        with self.assertRaises(ValueError):
            manager.connect("test")
        with self.assertRaises(ValueError):
            manager.disconnect()
        manager.syncing = False
        manager.download_busy = True
        with self.assertRaises(ValueError):
            manager.disconnect()


if __name__ == "__main__":
    unittest.main()

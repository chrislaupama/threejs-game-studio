#!/usr/bin/env python3
"""Focused tests for create_threejs_game.py."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("create_threejs_game.py")


class CreateThreejsGameTest(unittest.TestCase):
    def test_creates_named_self_contained_project(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "My Local Game"
            result = subprocess.run(
                [sys.executable, str(SCRIPT), str(target)],
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
            package = json.loads((target / "package.json").read_text(encoding="utf-8"))
            self.assertEqual(package["name"], "my-local-game")
            self.assertEqual(set(package["dependencies"]), {"three"})
            self.assertTrue((target / "scripts" / "audit_local_only.py").is_file())
            self.assertTrue((target / "scripts" / "inspect-threejs-canvas.mjs").is_file())
            self.assertTrue((target / "src" / "game" / "Game.ts").is_file())
            self.assertTrue((target / "docs" / "content-provenance.md").is_file())
            self.assertTrue((target / "docs" / "game-report.md").is_file())

    def test_refuses_to_overlay_nonempty_target(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            target = Path(directory) / "existing"
            target.mkdir()
            marker = target / "keep.txt"
            marker.write_text("owned", encoding="utf-8")
            result = subprocess.run(
                [sys.executable, str(SCRIPT), str(target)],
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(marker.read_text(encoding="utf-8"), "owned")
            self.assertIn("not empty", result.stderr + result.stdout)


if __name__ == "__main__":
    unittest.main()

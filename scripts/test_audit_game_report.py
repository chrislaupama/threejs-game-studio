#!/usr/bin/env python3
"""Focused tests for audit_game_report.py."""

from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("audit_game_report.py")

BASE_REPORT = [
    "Phase ledger", "Local content plan", "Local content sources: procedural, project-local",
    "Game design brief", "Core loop", "Level/encounter plan", "Gameplay", "Visual", "UI",
    "Debug/performance", "QA/release", "Controls", "Build: pass",
    "Local-only audit: pass", "Sustained human play: full short session",
    "Checks not run: none", "Remaining risks: none",
]


class AuditGameReportTest(unittest.TestCase):
    def run_audit(self, report: str, *args: str) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "report.md"
            path.write_text(report, encoding="utf-8")
            return subprocess.run(
                [sys.executable, str(SCRIPT), *args, str(path)],
                text=True,
                capture_output=True,
                check=False,
            )

    def test_accepts_complete_base_report(self) -> None:
        report = "\n".join(BASE_REPORT)
        result = self.run_audit(report)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_rejects_unsupported_premium_claim(self) -> None:
        result = self.run_audit("Looks premium.", "--premium")
        self.assertEqual(result.returncode, 1)
        self.assertIn("missing parseable score", result.stdout)
        self.assertIn("automatic failures remaining", result.stdout)

    def test_physics_report_uses_dependency_free_collision_language(self) -> None:
        report = "\n".join(
            [*BASE_REPORT, "Collision model: custom fixed-step", "Timestep: 1/60", "Collider count: 12"]
        )
        result = self.run_audit(report, "--physics")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_rejects_failed_audit_and_remote_content_source(self) -> None:
        report = "\n".join(
            line
            for line in BASE_REPORT
            if not line.startswith(("Local-only audit", "Local content sources"))
        )
        report += "\nLocal-only audit: failed\nLocal content sources: remote"
        result = self.run_audit(report)
        self.assertEqual(result.returncode, 1)
        self.assertIn("local-only audit must explicitly pass", result.stdout)
        self.assertIn("invalid local content source", result.stdout)

    def test_difficulty_report_requires_two_reaction_delay_routes(self) -> None:
        missing = self.run_audit("\n".join(BASE_REPORT), "--difficulty")
        self.assertEqual(missing.returncode, 1)
        self.assertIn("two-reaction-delay bot comparison", missing.stdout)

        complete = self.run_audit(
            "\n".join([*BASE_REPORT, "Two-reaction-delay bot comparison: 0ms vs 300ms"]),
            "--difficulty",
        )
        self.assertEqual(complete.returncode, 0, complete.stdout + complete.stderr)

    def test_rejects_premium_score_above_scale(self) -> None:
        categories = [
            "art direction", "hero/player", "obstacles/enemies", "rewards/interactables",
            "world/environment", "materials/textures", "lighting/render", "vfx/motion",
            "ui/hud", "performance evidence",
        ]
        premium = [
            "Measured evidence", "Fresh-eyes review", "Automatic failures remaining: none",
            "Technical art", "Render budget", "Visual test harness",
            *[f"{category}: {3.9 if category == 'art direction' else 3}" for category in categories],
        ]
        result = self.run_audit("\n".join([*BASE_REPORT, *premium]), "--premium")
        self.assertEqual(result.returncode, 1)
        self.assertIn("score above 3: art direction=3.9", result.stdout)


if __name__ == "__main__":
    unittest.main()

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
    "Three.js revision: three@0.185.1 / r185",
    "Renderer/backend: WebGLRenderer / WebGL 2",
    "Documentation/version baseline: r185 official docs and installed package types",
    "Lifecycle/disposal: Game owns start, reset, dispose, and re-entry",
    "Resize/DPR: resize tested at capped DPR 2",
    "Loading/error behavior: local loading screen plus required-asset error and retry",
    "Game design brief", "Core loop", "Level/encounter plan", "Gameplay", "Visual", "UI",
    "Debug/performance", "QA/release", "Controls", "Build: pass",
    "Unit/focused tests: pass", "Production preview/base path: pass at /game/",
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

    def test_rejects_each_missing_technical_contract_marker(self) -> None:
        required_lines = {
            "Three.js revision": "three.js revision",
            "Renderer/backend": "renderer/backend",
            "Documentation/version baseline": "documentation/version baseline",
            "Lifecycle/disposal": "lifecycle/disposal",
            "Resize/DPR": "resize/dpr",
            "Loading/error behavior": "loading/error behavior",
        }
        for prefix, expected_failure in required_lines.items():
            with self.subTest(marker=prefix):
                report = "\n".join(
                    line for line in BASE_REPORT if not line.startswith(prefix)
                )
                result = self.run_audit(report)
                self.assertEqual(result.returncode, 1)
                self.assertIn(expected_failure, result.stdout)

    def test_accepts_clear_aliases_for_technical_contract_markers(self) -> None:
        replacements = {
            "Three.js revision": "ThreeJS revision",
            "Renderer/backend": "Renderer and backend",
            "Documentation/version baseline": "Documentation and version baseline",
            "Lifecycle/disposal": "Lifecycle and disposal",
            "Resize/DPR": "Resize and DPR",
            "Loading/error behavior": "Loading and error behavior",
        }
        report_lines = []
        for line in BASE_REPORT:
            prefix, separator, value = line.partition(":")
            replacement = replacements.get(prefix)
            report_lines.append(
                f"{replacement}:{value}" if replacement and separator else line
            )
        result = self.run_audit("\n".join(report_lines))
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_rejects_unsupported_premium_claim(self) -> None:
        result = self.run_audit("Looks premium.", "--premium")
        self.assertEqual(result.returncode, 1)
        self.assertIn("missing parseable score", result.stdout)
        self.assertIn("automatic failures remaining", result.stdout)

    def test_polished_requires_review_but_not_numeric_scores(self) -> None:
        missing = self.run_audit("\n".join(BASE_REPORT), "--polished")
        self.assertEqual(missing.returncode, 1)
        self.assertIn("measured evidence", missing.stdout)

        complete = self.run_audit(
            "\n".join(
                [
                    *BASE_REPORT,
                    "Claim tier: polished",
                    "Measured evidence: active capture and renderer diagnostics",
                    "Fresh-eyes review: complete capture set reviewed",
                    "Automatic failures remaining: none",
                ]
            ),
            "--polished",
        )
        self.assertEqual(complete.returncode, 0, complete.stdout + complete.stderr)

    def test_physics_report_uses_dependency_free_collision_language(self) -> None:
        report = "\n".join(
            [*BASE_REPORT, "Collision model: custom fixed-step", "Timestep: 1/60", "Collider count: 12"]
        )
        result = self.run_audit(report, "--physics")
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_audio_report_preserves_unlock_mute_and_restart_requirements(self) -> None:
        missing = self.run_audit("\n".join(BASE_REPORT), "--audio")
        self.assertEqual(missing.returncode, 1)
        self.assertIn("gesture unlock", missing.stdout)
        self.assertIn("mute", missing.stdout)
        self.assertIn("pause/restart", missing.stdout)

        complete = self.run_audit(
            "\n".join(
                [
                    *BASE_REPORT,
                    "Audio: local procedural Web Audio",
                    "Gesture unlock: verified after Start",
                    "Mute: verified",
                    "Pause/restart: voices stop and recover",
                ]
            ),
            "--audio",
        )
        self.assertEqual(complete.returncode, 0, complete.stdout + complete.stderr)

    def test_no_design_skips_only_design_markers(self) -> None:
        design_prefixes = (
            "Game design brief",
            "Core loop",
            "Level/encounter plan",
            "Sustained human play",
        )
        report_lines = [
            line for line in BASE_REPORT if not line.startswith(design_prefixes)
        ]
        complete = self.run_audit("\n".join(report_lines), "--no-design")
        self.assertEqual(complete.returncode, 0, complete.stdout + complete.stderr)

        without_revision = [
            line for line in report_lines if not line.startswith("Three.js revision")
        ]
        missing = self.run_audit("\n".join(without_revision), "--no-design")
        self.assertEqual(missing.returncode, 1)
        self.assertIn("three.js revision", missing.stdout)

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

    def test_rejects_failed_tests_and_production_preview(self) -> None:
        report = "\n".join(
            "Unit/focused tests: failed"
            if line.startswith("Unit/focused tests")
            else "Production preview/base path: failed"
            if line.startswith("Production preview/base path")
            else line
            for line in BASE_REPORT
        )
        result = self.run_audit(report)
        self.assertEqual(result.returncode, 1)
        self.assertIn("unit/focused tests must explicitly pass", result.stdout)
        self.assertIn("production preview/base path must explicitly pass", result.stdout)

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
            "Claim tier: premium",
            "Measured evidence", "Fresh-eyes review", "Automatic failures remaining: none",
            "Technical art", "Render budget", "Visual test harness",
            *[f"{category}: {3.9 if category == 'art direction' else 3}" for category in categories],
        ]
        result = self.run_audit("\n".join([*BASE_REPORT, *premium]), "--premium")
        self.assertEqual(result.returncode, 1)
        self.assertIn("score above 3: art direction=3.9", result.stdout)

    def test_showcase_enforces_six_top_scores_and_average(self) -> None:
        categories = [
            "art direction", "hero/player", "obstacles/enemies", "rewards/interactables",
            "world/environment", "materials/textures", "lighting/render", "vfx/motion",
            "ui/hud", "performance evidence",
        ]
        evidence = [
            "Measured evidence", "Fresh-eyes review", "Automatic failures remaining: none",
            "Technical art", "Render budget", "Visual test harness",
        ]
        premium_only = [
            "Claim tier: showcase",
            *[f"{category}: 2.5" for category in categories],
            *evidence,
        ]
        rejected = self.run_audit("\n".join([*BASE_REPORT, *premium_only]), "--showcase")
        self.assertEqual(rejected.returncode, 1)
        self.assertIn("at least six category scores of 3", rejected.stdout)
        self.assertIn("average below 2.7", rejected.stdout)

        showcase_scores = [
            "Claim tier: showcase",
            *[f"{category}: 3" for category in categories[:7]],
            *[f"{category}: 2" for category in categories[7:]],
            *evidence,
        ]
        accepted = self.run_audit("\n".join([*BASE_REPORT, *showcase_scores]), "--showcase")
        self.assertEqual(accepted.returncode, 0, accepted.stdout + accepted.stderr)

    def test_rejects_report_tier_and_flag_mismatch(self) -> None:
        categories = [
            "art direction", "hero/player", "obstacles/enemies", "rewards/interactables",
            "world/environment", "materials/textures", "lighting/render", "vfx/motion",
            "ui/hud", "performance evidence",
        ]
        report = "\n".join(
            [
                *BASE_REPORT,
                "Claim tier: showcase",
                "Measured evidence", "Fresh-eyes review", "Automatic failures remaining: none",
                "Technical art", "Render budget", "Visual test harness",
                *[f"{category}: 3" for category in categories],
            ]
        )
        result = self.run_audit(report, "--premium")
        self.assertEqual(result.returncode, 1)
        self.assertIn("claim tier must explicitly match --premium", result.stdout)

        missing_flag = self.run_audit(report)
        self.assertEqual(missing_flag.returncode, 1)
        self.assertIn("claim tier showcase requires the matching --showcase flag", missing_flag.stdout)

        invalid = self.run_audit(report.replace("Claim tier: showcase", "Claim tier: ultra"))
        self.assertEqual(invalid.returncode, 1)
        self.assertIn("invalid claim tier: ultra", invalid.stdout)


if __name__ == "__main__":
    unittest.main()

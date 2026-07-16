#!/usr/bin/env python3
"""Focused tests for audit_skill_local_only.py."""

from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("audit_skill_local_only.py")


class AuditSkillLocalOnlyTest(unittest.TestCase):
    def run_audit(self, files: dict[str, str]) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory) / "skill"
            for relative, content in files.items():
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding="utf-8")
            return subprocess.run(
                [sys.executable, str(SCRIPT), str(root)],
                text=True,
                capture_output=True,
                check=False,
            )

    def test_accepts_local_threejs_skill(self) -> None:
        result = self.run_audit(
            {
                "SKILL.md": "Use Three.js and local browser tools only.",
                "references/assets.md": "Load /assets/models/hero.glb.",
                "assets/game/main.ts": "import * as THREE from 'three'; void THREE;",
                "assets/game/playwright.config.ts": "const url = 'http://127.0.0.1:5188';",
                "assets/game/icon.svg": '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
            }
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_rejects_remote_url(self) -> None:
        result = self.run_audit({"references/assets.md": "Load https://example.com/hero.glb"})
        self.assertEqual(result.returncode, 1)
        self.assertIn("non-local URL", result.stdout)

    def test_accepts_official_threejs_research_urls_in_markdown(self) -> None:
        result = self.run_audit(
            {
                "SKILL.md": "Local only.",
                "references/rendering.md": (
                    "Read https://threejs.org/docs/pages/WebGLRenderer.html and "
                    "https://github.com/mrdoob/three.js/blob/dev/src/renderers/WebGLRenderer.js."
                ),
            }
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_rejects_arbitrary_or_nonofficial_markdown_urls(self) -> None:
        result = self.run_audit(
            {
                "SKILL.md": "Local only.",
                "references/research.md": (
                    "Reject https://example.com/guide and "
                    "https://github.com/someone/three.js and "
                    "https://threejs.org.example.com/phishing."
                ),
            }
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("non-local URL", result.stdout)
        self.assertEqual(result.stdout.count("non-local URL"), 3)

    def test_rejects_official_research_url_outside_markdown(self) -> None:
        result = self.run_audit(
            {
                "SKILL.md": "Local only.",
                "assets/game/main.ts": (
                    "const runtimeUrl = 'https://threejs.org/examples/models/hero.glb';"
                ),
            }
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("non-local URL", result.stdout)

    def test_rejects_credentials_and_mcp_invocation(self) -> None:
        result = self.run_audit(
            {"SKILL.md": "Read GEMINI_API_KEY then call mcp__assets__generate."}
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("provider credential", result.stdout)
        self.assertIn("MCP invocation syntax", result.stdout)

    def test_rejects_provider_helper_file(self) -> None:
        result = self.run_audit({"scripts/generate_image.py": "print('generator')"})
        self.assertEqual(result.returncode, 1)
        self.assertIn("provider helper file", result.stdout)

    def test_rejects_network_client_import(self) -> None:
        result = self.run_audit({"scripts/download.py": "import requests\n"})
        self.assertEqual(result.returncode, 1)
        self.assertIn("network client command/import", result.stdout)

    def test_ignores_legal_notice_and_lockfile_registry_urls(self) -> None:
        result = self.run_audit(
            {
                "NOTICE.md": "Source https://github.com/example/project and GEMINI_API_KEY excluded.",
                "assets/game/package-lock.json": '{"resolved":"https://registry.npmjs.org/three"}',
                "SKILL.md": "Local only.",
            }
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()

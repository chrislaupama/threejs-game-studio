#!/usr/bin/env python3
"""Focused tests for audit_skill_structure.py."""

from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("audit_skill_structure.py")


class AuditSkillStructureTest(unittest.TestCase):
    def base_files(self) -> dict[str, str]:
        package = {
            "name": "threejs-vite-game",
            "dependencies": {"three": "0.185.1"},
            "devDependencies": {"@types/three": "0.185.1"},
        }
        return {
            "SKILL.md": (
                "---\n"
                "name: threejs-game-studio\n"
                "description: A self-contained coordinator.\n"
                "---\n\n"
                "Use $threejs-game-studio as the coordinator.\n"
                "Its own installed path may be "
                "~/.codex/skills/threejs-game-studio/SKILL.md.\n"
                "Read [Core](references/core.md).\n"
            ),
            "references/core.md": "Read the [local guide](../assets/guide.md#start).\n",
            "assets/guide.md": "# Local guide\n",
            "assets/threejs-vite-game/package.json": json.dumps(package, indent=2),
            "assets/threejs-vite-game/src/main.ts": (
                "import * as THREE from 'three';\n"
                "declare const renderer: THREE.WebGLRenderer;\n"
                "const timer = new THREE.Timer();\n"
                "renderer.setAnimationLoop(() => timer.update());\n"
            ),
        }

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

    def test_accepts_one_self_contained_coordinator_and_r185_scaffold(self) -> None:
        result = self.run_audit(self.base_files())
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_rejects_duplicate_or_nonroot_skill_files(self) -> None:
        files = self.base_files()
        files["nested/SKILL.md"] = "---\nname: another-skill\n---\n"
        result = self.run_audit(files)
        self.assertEqual(result.returncode, 1)
        self.assertIn("expected exactly one SKILL.md", result.stdout)

        files = self.base_files()
        del files["SKILL.md"]
        files["nested/SKILL.md"] = "---\nname: nested-only\n---\n"
        result = self.run_audit(files)
        self.assertEqual(result.returncode, 1)
        self.assertIn("root coordinator SKILL.md is missing", result.stdout)

    def test_rejects_reference_not_named_in_root_skill(self) -> None:
        files = self.base_files()
        files["references/unlisted.md"] = "# Hidden manual\n"
        result = self.run_audit(files)
        self.assertEqual(result.returncode, 1)
        self.assertIn("reference is not directly named in root SKILL.md", result.stdout)
        self.assertIn("references/unlisted.md", result.stdout)

    def test_rejects_broken_or_escaping_relative_markdown_links(self) -> None:
        files = self.base_files()
        files["README.md"] = (
            "[Missing](references/missing.md)\n"
            "[Escape](../../outside.md)\n"
        )
        result = self.run_audit(files)
        self.assertEqual(result.returncode, 1)
        self.assertIn("unresolved relative Markdown link", result.stdout)
        self.assertIn("relative Markdown link escapes the skill package", result.stdout)

    def test_ignores_link_examples_inside_fenced_code(self) -> None:
        files = self.base_files()
        files["README.md"] = "```md\n[Illustration](not-a-real-file.md)\n```\n"
        result = self.run_audit(files)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_rejects_cross_skill_invocations_and_installed_paths(self) -> None:
        files = self.base_files()
        files["references/core.md"] = (
            "Use $external-render-helper, then read "
            "~/.codex/skills/other-game/SKILL.md.\n"
        )
        result = self.run_audit(files)
        self.assertEqual(result.returncode, 1)
        self.assertIn("cross-skill invocation", result.stdout)
        self.assertIn("cross-skill installed path", result.stdout)

    def test_exempts_legal_attribution_from_operational_reference_checks(self) -> None:
        files = self.base_files()
        files["NOTICE.md"] = "Legal text naming $external-research-source.\n"
        files["LICENSE"] = "Attribution with skill://historical-source.\n"
        result = self.run_audit(files)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_rejects_incorrect_three_package_baseline(self) -> None:
        files = self.base_files()
        files["assets/threejs-vite-game/package.json"] = json.dumps(
            {
                "dependencies": {"three": "^0.184.0"},
                "devDependencies": {"@types/three": "^0.184.1"},
            }
        )
        result = self.run_audit(files)
        self.assertEqual(result.returncode, 1)
        self.assertEqual(result.stdout.count("incorrect Three.js scaffold baseline"), 2)
        self.assertIn("0.185.1", result.stdout)

    def test_requires_timer_and_renderer_animation_loop(self) -> None:
        files = self.base_files()
        files["assets/threejs-vite-game/src/main.ts"] = (
            "import * as THREE from 'three';\n"
            "const scene = new THREE.Scene();\n"
            "void scene;\n"
        )
        result = self.run_audit(files)
        self.assertEqual(result.returncode, 1)
        self.assertIn("scaffold must use THREE.Timer", result.stdout)
        self.assertIn("scaffold must use renderer.setAnimationLoop", result.stdout)

    def test_rejects_stale_threejs_typescript_apis(self) -> None:
        files = self.base_files()
        files["assets/threejs-vite-game/src/legacy.ts"] = (
            "import * as THREE from 'three';\n"
            "declare const renderer: THREE.WebGLRenderer;\n"
            "const clock = new THREE.Clock();\n"
            "requestAnimationFrame(() => clock.getDelta());\n"
            "renderer.outputEncoding = THREE.sRGBEncoding;\n"
        )
        result = self.run_audit(files)
        self.assertEqual(result.returncode, 1)
        self.assertIn("deprecated THREE.Clock timing", result.stdout)
        self.assertIn("manual requestAnimationFrame loop", result.stdout)
        self.assertIn("removed renderer.outputEncoding", result.stdout)
        self.assertIn("removed color encoding constant", result.stdout)

    def test_does_not_treat_comments_or_strings_as_stale_api_usage(self) -> None:
        files = self.base_files()
        files["assets/threejs-vite-game/src/notes.ts"] = (
            "// new THREE.Clock(); requestAnimationFrame(loop);\n"
            "const note = 'renderer.outputEncoding = THREE.sRGBEncoding';\n"
            "void note;\n"
        )
        result = self.run_audit(files)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)


if __name__ == "__main__":
    unittest.main()

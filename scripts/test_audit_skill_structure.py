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

    def test_rejects_stale_api_in_executable_markdown_fence(self) -> None:
        files = self.base_files()
        files["references/core.md"] += (
            "\n```ts\n"
            "const loader = new RGBELoader();\n"
            "await renderer.renderAsync(scene, camera);\n"
            "```\n"
        )
        result = self.run_audit(files)
        self.assertEqual(result.returncode, 1)
        self.assertIn("deprecated RGBELoader compatibility alias", result.stdout)
        self.assertIn("deprecated renderer or pipeline renderAsync", result.stdout)

    def test_ignores_prose_non_executable_fences_comments_and_strings(self) -> None:
        files = self.base_files()
        files["references/core.md"] += (
            "\n`RGBELoader` is historical prose.\n"
            "```text\nnew RGBELoader(); renderer.renderAsync();\n```\n"
            "```ts\n"
            "// new RGBELoader();\n"
            "const note = 'renderer.renderAsync()';\n"
            "void note;\n"
            "```\n"
        )
        result = self.run_audit(files)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_rejects_webgpu_example_with_webgl_only_customization(self) -> None:
        files = self.base_files()
        files["references/core.md"] += (
            "\n```ts\n"
            "const renderer = new THREE.WebGPURenderer();\n"
            "const composer = new EffectComposer(renderer);\n"
            "```\n"
        )
        result = self.run_audit(files)
        self.assertEqual(result.returncode, 1)
        self.assertIn("WebGPU example mixes in EffectComposer", result.stdout)

    def test_accepts_current_compute_and_webgl_tsl_migration_bridge(self) -> None:
        files = self.base_files()
        files["references/core.md"] += (
            "\n```ts\n"
            "const webgpu = new THREE.WebGPURenderer();\n"
            "await webgpu.computeAsync(computeNode);\n"
            "```\n"
            "```ts\n"
            "const webgl = new THREE.WebGLRenderer();\n"
            "webgl.setNodesHandler(new WebGLNodesHandler());\n"
            "webgl.setEffects([bloomPass]);\n"
            "```\n"
        )
        result = self.run_audit(files)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_requires_xr_bypass_in_scaffold_render_pipeline(self) -> None:
        files = self.base_files()
        files["assets/threejs-vite-game/src/webgpu.ts"] = (
            "import * as THREE from 'three/webgpu';\n"
            "declare const renderer: THREE.WebGPURenderer;\n"
            "declare const scene: THREE.Scene;\n"
            "declare const camera: THREE.Camera;\n"
            "const pipeline = new THREE.RenderPipeline(renderer);\n"
            "pipeline.render();\n"
        )
        result = self.run_audit(files)
        self.assertEqual(result.returncode, 1)
        self.assertIn(
            "scaffold RenderPipeline must bypass post while XR is presenting",
            result.stdout,
        )

        files["assets/threejs-vite-game/src/webgpu.ts"] = (
            "import * as THREE from 'three/webgpu';\n"
            "declare const renderer: THREE.WebGPURenderer;\n"
            "declare const scene: THREE.Scene;\n"
            "declare const camera: THREE.Camera;\n"
            "const pipeline = new THREE.RenderPipeline(renderer);\n"
            "if (renderer.xr.isPresenting) renderer.render(scene, camera);\n"
            "else pipeline.render();\n"
        )
        result = self.run_audit(files)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_rejects_renderer_mixing_across_fences_in_one_section(self) -> None:
        files = self.base_files()
        files["references/core.md"] += (
            "\n## One renderer recipe\n"
            "```ts\nconst renderer = new THREE.WebGPURenderer();\n```\n"
            "Continue the same recipe:\n"
            "```ts\nconst composer = new EffectComposer(renderer);\n```\n"
        )
        result = self.run_audit(files)
        self.assertEqual(result.returncode, 1)
        self.assertIn("WebGPU example mixes in EffectComposer", result.stdout)

    def test_rejects_root_absolute_asset_url_in_executable_fence(self) -> None:
        files = self.base_files()
        files["references/core.md"] += (
            "\n```ts\nawait loader.loadAsync('/assets/hero.glb');\n```\n"
        )
        result = self.run_audit(files)
        self.assertEqual(result.returncode, 1)
        self.assertIn("root-absolute asset URL bypasses the Vite base", result.stdout)

    def test_accepts_current_gltf_exporter_parse(self) -> None:
        files = self.base_files()
        files["references/core.md"] += (
            "\n```ts\n"
            "const exporter = new GLTFExporter();\n"
            "exporter.parse(scene, onDone, onError);\n"
            "```\n"
        )
        result = self.run_audit(files)
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_rejects_deprecated_tsl_constant_without_call(self) -> None:
        files = self.base_files()
        files["references/core.md"] += (
            "\n```ts\nconst size = viewportResolution;\nvoid size;\n```\n"
        )
        result = self.run_audit(files)
        self.assertEqual(result.returncode, 1)
        self.assertIn("deprecated TSL constant alias", result.stdout)

    def test_rejects_draco_exporter_parse_with_arbitrary_identifier(self) -> None:
        files = self.base_files()
        files["references/core.md"] += (
            "\n## Export recipe\n"
            "```ts\nconst writer = new DRACOExporter();\n```\n"
            "```ts\nwriter.parse(mesh);\n```\n"
        )
        result = self.run_audit(files)
        self.assertEqual(result.returncode, 1)
        self.assertIn("deprecated DRACOExporter.parse", result.stdout)


if __name__ == "__main__":
    unittest.main()

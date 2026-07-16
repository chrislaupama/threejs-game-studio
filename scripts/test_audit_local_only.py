#!/usr/bin/env python3
"""Focused tests for audit_local_only.py."""

from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT = Path(__file__).with_name("audit_local_only.py")


class AuditLocalOnlyTest(unittest.TestCase):
    def run_audit(
        self,
        files: dict[str, str],
        *args: str,
        baseline: str | None = None,
    ) -> subprocess.CompletedProcess[str]:
        with tempfile.TemporaryDirectory() as directory:
            base = Path(directory)
            root = base / "project"
            for relative, content in files.items():
                path = root / relative
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(content, encoding="utf-8")
            command = [sys.executable, str(SCRIPT), str(root), *args]
            if baseline is not None:
                baseline_path = base / "baseline-package.json"
                baseline_path.write_text(baseline, encoding="utf-8")
                command.extend(["--baseline-package-json", str(baseline_path)])
            return subprocess.run(
                command,
                text=True,
                capture_output=True,
                check=False,
            )

    def test_accepts_three_and_relative_assets(self) -> None:
        result = self.run_audit(
            {
                "package.json": '{"homepage":"https://example.com/source","dependencies":{"three":"^0.184.0"},"devDependencies":{"vite":"^8.0.0"}}',
                "index.html": '<script type="module" src="/src/main.ts"></script>',
                "src/main.ts": "import * as THREE from 'three'; import './style.css';",
                "src/style.css": "body { background: #000; }",
                "public/favicon.svg": '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
                "vite.config.ts": "import { defineConfig } from 'vite'; export default defineConfig({});",
            }
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_rejects_remote_fetch_and_runtime_package(self) -> None:
        result = self.run_audit(
            {
                "package.json": '{"dependencies":{"three":"^0.184.0","axios":"^1.0.0"}}',
                "src/main.ts": "fetch('https://example.com/model.glb');",
            }
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("remote URL", result.stdout)
        self.assertIn("fetch call", result.stdout)
        self.assertIn("unapproved runtime package", result.stdout)

    def test_allows_only_dependency_recorded_in_baseline(self) -> None:
        result = self.run_audit(
            {
                "package.json": '{"dependencies":{"three":"^0.184.0","local-physics":"file:../local-physics"}}',
                "src/main.ts": "import physics from 'local-physics'; void physics;",
            },
            baseline='{"dependencies":{"local-physics":"file:../local-physics"}}',
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_rejects_optional_and_bracket_network_calls_in_common_roots(self) -> None:
        result = self.run_audit(
            {
                "package.json": '{"dependencies":{"three":"^0.184.0"}}',
                "app/main.ts": "globalThis.fetch?.(url); window['fetch'](url); navigator.sendBeacon?.('/x');",
                "workers/sync.js": "importScripts(endpoint); new WebTransport(endpoint);",
            }
        )
        self.assertEqual(result.returncode, 1)
        self.assertGreaterEqual(result.stdout.count("fetch call"), 2)
        self.assertIn("sendBeacon", result.stdout)
        self.assertIn("importScripts", result.stdout)
        self.assertIn("WebTransport", result.stdout)

    def test_rejects_remote_in_config_and_protocol_relative_ip(self) -> None:
        result = self.run_audit(
            {
                "package.json": '{"dependencies":{"three":"^0.184.0"},"devDependencies":{"vite":"^8.0.0"}}',
                "vite.config.ts": "import { defineConfig } from 'vite'; const endpoint = '//10.0.0.8/collect'; export default defineConfig({});",
            }
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("protocol-relative URL", result.stdout)

    def test_rejects_commonjs_runtime_import(self) -> None:
        result = self.run_audit(
            {
                "package.json": '{"dependencies":{"three":"^0.184.0"}}',
                "server/main.cjs": "const cloud = require('cloud-sdk'); void cloud;",
            }
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("unapproved bare runtime import", result.stdout)

    def test_ignores_provenance_urls_and_network_words_in_comments(self) -> None:
        result = self.run_audit(
            {
                "package.json": '{"homepage":"https://example.com/source","dependencies":{"three":"^0.184.0"}}',
                "src/main.ts": "// Source: https://example.com/paper; do not fetch at runtime\nconst shader = `// https://example.com/shader-paper\\nvoid main(){}`; import * as THREE from 'three'; void shader; void THREE;",
            }
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_built_bundle_allows_local_polyfill_and_shader_source_comment(self) -> None:
        result = self.run_audit(
            {
                "package.json": '{"dependencies":{"three":"^0.184.0"}}',
                "dist/app.js": "fetch('/chunk.js'); const shader = `// https://example.com/paper\\nvoid main(){}`;",
            }
        )
        self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_built_bundle_still_rejects_remote_literal(self) -> None:
        result = self.run_audit(
            {
                "package.json": '{"dependencies":{"three":"^0.184.0"}}',
                "dist/app.js": "const endpoint = 'https://example.com/collect';",
            }
        )
        self.assertEqual(result.returncode, 1)
        self.assertIn("remote URL", result.stdout)


if __name__ == "__main__":
    unittest.main()

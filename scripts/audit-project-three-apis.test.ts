/** Tests for audit-project-three-apis.ts denylist matching. */

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  auditProjectThreeApis,
  stripCommentsAndStrings,
} from "./audit-project-three-apis.ts";

function writeProject(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "audit-apis-"));
  for (const [relativeName, content] of Object.entries(files)) {
    const path = join(root, ...relativeName.split("/"));
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, content, "utf8");
  }
  return root;
}

test("stripCommentsAndStrings ignores commented Clock usage", () => {
  const code = stripCommentsAndStrings(
    "// new THREE.Clock();\nconst note = 'RGBELoader';\n",
  );
  assert.doesNotMatch(code, /Clock/);
  assert.doesNotMatch(code, /RGBELoader/);
});

test("flags stale APIs in project sources", () => {
  const root = writeProject({
    "src/legacy.ts":
      "import * as THREE from 'three';\n" +
      "const clock = new THREE.Clock();\n" +
      "renderer.outputEncoding = THREE.sRGBEncoding;\n" +
      "const loader = new RGBELoader();\n",
  });
  try {
    const findings = auditProjectThreeApis(root);
    const reasons = findings.map((item) => item.reason).join("\n");
    assert.match(reasons, /Clock/);
    assert.match(reasons, /outputEncoding/);
    assert.match(reasons, /RGBELoader/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("allows EffectComposer on WebGL-only files", () => {
  const root = writeProject({
    "src/webgl-post.ts":
      "import * as THREE from 'three';\n" +
      "import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';\n" +
      "const renderer = new THREE.WebGLRenderer({ alpha: false });\n" +
      "const composer = new EffectComposer(renderer);\n",
  });
  try {
    const findings = auditProjectThreeApis(root);
    assert.equal(findings.length, 0, findings.map((item) => item.reason).join(", "));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("flags EffectComposer when WebGPU is in the same file", () => {
  const root = writeProject({
    "src/bad-webgpu.ts":
      "import * as THREE from 'three/webgpu';\n" +
      "const renderer = new THREE.WebGPURenderer({ alpha: false });\n" +
      "const composer = new EffectComposer(renderer);\n",
  });
  try {
    const findings = auditProjectThreeApis(root);
    assert.ok(findings.some((item) => /EffectComposer/.test(item.reason)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

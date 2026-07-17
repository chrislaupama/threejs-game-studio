/** Tests for audit-project-three-apis.ts denylist matching. */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
  auditProjectThreeApis,
  stripCommentsAndStrings,
} from "./audit-project-three-apis.ts";

const SCRIPT = fileURLToPath(new URL("./audit-project-three-apis.ts", import.meta.url));

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

test("stripCommentsAndStrings preserves executable template substitutions", () => {
  const code = stripCommentsAndStrings(
    "const literal = `new THREE.Clock()`;\n" +
    "const live = `clock=${new THREE.Clock()}`;\n",
  );
  assert.equal(code.match(/THREE\.Clock/g)?.length, 1);
});

test("flags stale APIs in project sources", () => {
  const root = writeProject({
    "src/legacy.ts":
      "import * as THREE from 'three';\n" +
      "import { RGBELoader } from 'three/addons/loaders/RGBELoader.js';\n" +
      "const renderer = new THREE.WebGLRenderer();\n" +
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

test("flags removed texture encoding and PointerLockControls accessors", () => {
  const root = writeProject({
    "src/legacy-controls.ts":
      "import { PerspectiveCamera, Texture as LegacyTexture } from 'three';\n" +
      "import { PointerLockControls } from 'three/addons/controls/PointerLockControls.js';\n" +
      "const camera = new PerspectiveCamera();\n" +
      "const albedoMap = new LegacyTexture();\n" +
      "const controls = new PointerLockControls(camera, document.body);\n" +
      "albedoMap.encoding = 3001;\n" +
      "controls.getObject();\n",
  });
  try {
    const findings = auditProjectThreeApis(root);
    assert.equal(findings.length, 2);
    assert.deepEqual(
      findings.map(({ path, line, reason }) => ({ path, line, reason })),
      [
        {
          path: "src/legacy-controls.ts",
          line: 6,
          reason: "removed Texture.encoding; use colorSpace",
        },
        {
          path: "src/legacy-controls.ts",
          line: 7,
          reason: "removed PointerLockControls.getObject(); use object",
        },
      ],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("does not confuse WebGPU node encodings with removed Texture.encoding", () => {
  const root = writeProject({
    "src/current-node.ts":
      "import { PackFloatNode } from 'three/webgpu';\n" +
      "const node = new PackFloatNode(null);\n" +
      "node.encoding = 'RGBA8';\n",
  });
  try {
    assert.deepEqual(auditProjectThreeApis(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("flags common TextureLoader results without pretending to infer return types", () => {
  const root = writeProject({
    "src/loader.ts":
      "import { TextureLoader } from 'three';\n" +
      "const texture = new TextureLoader().load('/albedo.webp');\n" +
      "texture.encoding = 3001;\n",
  });
  try {
    const findings = auditProjectThreeApis(root);
    assert.equal(findings.length, 1);
    assert.deepEqual(
      {
        path: findings[0]?.path,
        line: findings[0]?.line,
        reason: findings[0]?.reason,
      },
      {
        path: "src/loader.ts",
        line: 3,
        reason: "removed Texture.encoding; use colorSpace",
      },
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("does not audit the generated auditor's own denylist", () => {
  const root = writeProject({
    "scripts/audit-project-three-apis.ts":
      "const reasons = ['deprecated THREE.Clock timing', 'removed renderer.outputEncoding'];\n",
    "src/current.ts":
      "import { Timer } from 'three';\nconst timer = new Timer();\nvoid timer;\n",
  });
  try {
    assert.deepEqual(auditProjectThreeApis(root), []);
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
      "import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';\n" +
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

test("scans app and other project source roots even when src exists", () => {
  const root = writeProject({
    "src/current.ts": "import { Timer } from 'three';\nnew Timer();\n",
    "app/legacy.ts":
      "import { WebGLRenderer } from 'three';\n" +
      "const renderer = new WebGLRenderer();\n" +
      "renderer.physicallyCorrectLights = true;\n" +
      "renderer.clearAsync();\n",
  });
  try {
    const findings = auditProjectThreeApis(root);
    assert.ok(findings.some((item) => item.path === "app/legacy.ts" && /lighting/.test(item.reason)));
    assert.ok(findings.some((item) => item.path === "app/legacy.ts" && /async method/.test(item.reason)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("does not flag same-named APIs in files unrelated to Three.js", () => {
  const root = writeProject({
    "src/scheduler.ts":
      "class Clock {}\n" +
      "const renderer = { outputEncoding: 'custom' };\n" +
      "new Clock();\nrenderer.outputEncoding = 'legacy';\n",
    "src/commented.ts":
      "// import * as THREE from 'three';\n" +
      "const RGBELoader = class {};\nnew RGBELoader();\n",
  });
  try {
    assert.deepEqual(auditProjectThreeApis(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("still audits global THREE builds and renamed BufferGeometryUtils helpers", () => {
  const root = writeProject({
    "legacy/global.js":
      "const geometry = new THREE.Geometry();\n" +
      "const merged = THREE.BufferGeometryUtils.mergeBufferAttributes([]);\n",
  });
  try {
    const reasons = auditProjectThreeApis(root).map((item) => item.reason).join("\n");
    assert.match(reasons, /Geometry\/Face3/);
    assert.match(reasons, /mergeBufferAttributes/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("tracks destructured global THREE symbols, including aliases", () => {
  const root = writeProject({
    "legacy/destructured.js":
      "const { Clock: LegacyClock, Geometry } = THREE;\n" +
      "const { Face3: LegacyFace } = globalThis.THREE;\n" +
      "const clock = new LegacyClock();\n" +
      "const geometry = new Geometry();\n" +
      "const face = new LegacyFace();\n" +
      "void clock; void geometry; void face;\n",
  });
  try {
    const reasons = auditProjectThreeApis(root).map((item) => item.reason).join("\n");
    assert.match(reasons, /Clock/);
    assert.match(reasons, /Geometry\/Face3/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("tracks direct require members and awaited dynamic-import bindings", () => {
  const root = writeProject({
    "legacy/commonjs.cjs":
      "const LegacyClock = require('three').Clock;\n" +
      "const clock = new LegacyClock();\nvoid clock;\n",
    "src/dynamic.mts": [
      "export async function makeClock() {",
      "  const { Clock } = await import('three');",
      "  return new Clock();",
      "}",
    ].join("\n"),
  });
  try {
    const findings = auditProjectThreeApis(root);
    assert.ok(findings.some((item) => item.path === "legacy/commonjs.cjs" && /Clock/.test(item.reason)));
    assert.ok(findings.some((item) => item.path === "src/dynamic.mts" && /Clock/.test(item.reason)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("audits executable expressions inside template literals", () => {
  const root = writeProject({
    "src/template.ts": [
      "import * as THREE from 'three';",
      "const documentation = `new THREE.Clock()`;",
      "const runtime = `clock=${new THREE.Clock()}`;",
      "void documentation; void runtime;",
    ].join("\n"),
  });
  try {
    const clocks = auditProjectThreeApis(root).filter((item) => /Clock/.test(item.reason));
    assert.equal(clocks.length, 1);
    assert.equal(clocks[0]?.path, "src/template.ts");
    assert.equal(clocks[0]?.line, 3);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("propagates Three provenance through relative re-export barrels", () => {
  const root = writeProject({
    "src/vendor/three-base.ts": "export * from 'three';\n",
    "src/vendor/three-clock.ts":
      "export { Clock } from './three-base.js';\n",
    "src/game.ts":
      "import { Clock as LegacyClock } from './vendor/three-clock.js';\n" +
      "const clock = new LegacyClock();\nvoid clock;\n",
    "src/global-style.ts":
      "import * as T from './vendor/three-base.js';\n" +
      "const geometry = new T.Geometry();\nvoid geometry;\n",
  });
  try {
    const findings = auditProjectThreeApis(root);
    assert.ok(findings.some((item) => item.path === "src/game.ts" && /Clock/.test(item.reason)));
    assert.ok(findings.some((item) => item.path === "src/global-style.ts" && /Geometry/.test(item.reason)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("does not treat unrelated unqualified identifiers as Three APIs", () => {
  const root = writeProject({
    "src/custom.ts":
      "import { WebGLRenderer } from 'three';\n" +
      "class Clock {}\n" +
      "class RGBELoader {}\n" +
      "const custom = { PCFSoftShadowMap: 1, Geometry: class {} };\n" +
      "const cache = { clearAsync() {}, outputEncoding: 'custom' };\n" +
      "const serializer = { encoding: 'utf8', getObject() { return {}; } };\n" +
      "new Clock(); new RGBELoader(); new custom.Geometry();\n" +
      "cache.clearAsync();\n" +
      "serializer.getObject();\n" +
      "void WebGLRenderer; void custom.PCFSoftShadowMap; void cache.outputEncoding; void serializer.encoding;\n",
  });
  try {
    assert.deepEqual(auditProjectThreeApis(root), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("scans component scripts but ignores Vue, Svelte, and Astro markup/styles", () => {
  const root = writeProject({
    "src/Clean.vue": [
      "<script lang=\"ts\">",
      "import { WebGLRenderer } from 'three';",
      "void WebGLRenderer;",
      "</script>",
      "<template><div class=\"outputEncoding PCFSoftShadowMap\">Clock</div></template>",
      "<style>.outputEncoding { color: red; }</style>",
    ].join("\n"),
    "src/Clean.svelte": [
      "<script>import { Timer } from 'three'; void Timer;</script>",
      "<main class=\"gammaOutput\">Geometry</main>",
      "<style>.physicallyCorrectLights { color: red; }</style>",
    ].join("\n"),
    "src/Clean.astro": [
      "---",
      "import { Timer } from 'three';",
      "void Timer;",
      "---",
      "<div class=\"outputEncoding\">Face3</div>",
      "<style>.gammaFactor { color: red; }</style>",
    ].join("\n"),
    "src/Legacy.vue": [
      "<script lang=\"ts\">",
      "import { Clock } from 'three';",
      "const clock = new Clock();",
      "void clock;",
      "</script>",
    ].join("\n"),
    "src/TemplateLegacy.vue": [
      "<script>import * as THREE from 'three';</script>",
      "<template>{{ new THREE.Geometry() }}</template>",
      "<style>.Geometry { color: red; }</style>",
    ].join("\n"),
  });
  try {
    const findings = auditProjectThreeApis(root);
    assert.ok(findings.some((item) => item.path === "src/Legacy.vue" && /Clock/.test(item.reason)));
    assert.ok(findings.some((item) => item.path === "src/TemplateLegacy.vue" && /Geometry/.test(item.reason)));
    assert.equal(findings.some((item) => item.path === "src/Clean.vue"), false);
    assert.equal(findings.some((item) => item.path === "src/Clean.svelte"), false);
    assert.equal(findings.some((item) => item.path === "src/Clean.astro"), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("explicitly rejects source file and directory symbolic links", () => {
  const root = writeProject({
    "src/real.ts": "import { Timer } from 'three';\nvoid Timer;\n",
    "shared/current.ts": "export const current = true;\n",
  });
  try {
    symlinkSync("real.ts", join(root, "src/linked.ts"));
    symlinkSync("../shared", join(root, "src/linked-directory"));
    const findings = auditProjectThreeApis(root).filter((item) => /symbolic link/.test(item.reason));
    assert.equal(findings.length, 2);
    assert.deepEqual(
      findings.map((item) => item.path).sort(),
      ["src/linked-directory", "src/linked.ts"],
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("runs the CLI main guard when invoked through a symbolic link", () => {
  const root = writeProject({
    "src/current.ts": "import { Timer } from 'three';\nvoid Timer;\n",
  });
  const linkedScript = join(root, "audit-apis-linked.ts");
  try {
    symlinkSync(SCRIPT, linkedScript);
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", linkedScript, root],
      { encoding: "utf8" },
    );
    assert.equal(result.status, 1, result.stdout + result.stderr);
    // The linked entry itself is inside the audited root, proving main ran and
    // applied the explicit source-symlink policy instead of silently exiting.
    assert.match(result.stdout, /source symbolic link is not allowed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

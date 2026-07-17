/** Focused regressions for audit-skill-structure.ts. */

import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { isModernThreeRange } from "./audit-skill-structure.ts";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "audit-skill-structure.ts");

interface AuditResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function baseFiles(): Record<string, string> {
  const packageJson = {
    name: "threejs-vite-game",
    scripts: {
      "audit:local": "node --import tsx scripts/audit-local-only.ts",
      "setup:browsers": "playwright install chromium",
    },
    dependencies: { three: "^0.185.0" },
    devDependencies: { "@types/three": "^0.185.0" },
  };
  return {
    "SKILL.md":
      "---\n" +
      "name: threejs-game-studio\n" +
      "description: A self-contained coordinator.\n" +
      "---\n\n" +
      "Use $threejs-game-studio as the coordinator.\n" +
      "Its own installed path may be ~/.codex/skills/threejs-game-studio/SKILL.md.\n" +
      "Read [Core](references/core.md).\n",
    "references/core.md": "Read the [local guide](../assets/guide.md#start).\n",
    "assets/guide.md": "# Local guide\n",
    "assets/threejs-vite-game/package.json": JSON.stringify(packageJson, null, 2),
    "assets/threejs-vite-game/scripts/audit-local-only.ts":
      "export function auditLocalOnly(): void {}\n",
    "assets/threejs-vite-game/src/main.ts":
      "import * as THREE from 'three';\n" +
      "declare const renderer: THREE.WebGLRenderer;\n" +
      "const timer = new THREE.Timer();\n" +
      "renderer.setAnimationLoop((time) => {\n" +
      "  timer.update(time);\n" +
      "  timer.getDelta();\n" +
      "});\n",
  };
}

function runAudit(files: Record<string, string>): AuditResult {
  const directory = mkdtempSync(join(tmpdir(), "audit-skill-structure-"));
  try {
    const root = join(directory, "skill");
    for (const [relativeName, content] of Object.entries(files)) {
      const path = join(root, ...relativeName.split("/"));
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, "utf8");
    }
    const result = spawnSync(
      process.execPath,
      ["--import", "tsx", SCRIPT, root],
      { encoding: "utf8", cwd: dirname(SCRIPT) },
    );
    if (result.error) throw result.error;
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function diagnostic(result: AuditResult): string {
  return result.stdout + result.stderr;
}

test("accepts one self-contained coordinator and r185 scaffold", () => {
  const result = runAudit(baseFiles());
  assert.equal(result.status, 0, diagnostic(result));
});

test("runs the structure CLI through a symlinked entry path", () => {
  const directory = mkdtempSync(join(tmpdir(), "audit-structure-link-"));
  try {
    const link = join(directory, "audit-skill-structure.ts");
    symlinkSync(SCRIPT, link);
    const result = spawnSync(process.execPath, ["--import", "tsx", link, "--help"], {
      encoding: "utf8",
      cwd: dirname(SCRIPT),
    });
    assert.equal(result.status, 0, diagnostic(result));
    assert.match(result.stdout, /usage: audit-skill-structure/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("validates the skill frontmatter contract without Python", () => {
  const malformed = baseFiles();
  malformed["SKILL.md"] = "# No frontmatter\n";
  const malformedResult = runAudit(malformed);
  assert.equal(malformedResult.status, 1);
  assert.match(malformedResult.stdout, /missing or malformed skill frontmatter/);

  const unsupported = baseFiles();
  unsupported["SKILL.md"] = unsupported["SKILL.md"]!.replace(
    "description: A self-contained coordinator.\n",
    "description: A self-contained coordinator.\nmetadata: forbidden\n",
  );
  const unsupportedResult = runAudit(unsupported);
  assert.equal(unsupportedResult.status, 1);
  assert.match(unsupportedResult.stdout, /unsupported skill frontmatter field/);

  const invalidName = baseFiles();
  invalidName["SKILL.md"] = invalidName["SKILL.md"]!.replace(
    "name: threejs-game-studio",
    "name: Three JS Studio",
  );
  const invalidNameResult = runAudit(invalidName);
  assert.equal(invalidNameResult.status, 1);
  assert.match(invalidNameResult.stdout, /invalid skill frontmatter name/);
});

test("rejects duplicate or non-root skill files", () => {
  const duplicate = baseFiles();
  duplicate["nested/SKILL.md"] = "---\nname: another-skill\n---\n";
  const duplicateResult = runAudit(duplicate);
  assert.equal(duplicateResult.status, 1);
  assert.match(duplicateResult.stdout, /expected exactly one SKILL\.md/);

  const nestedOnly = baseFiles();
  delete nestedOnly["SKILL.md"];
  nestedOnly["nested/SKILL.md"] = "---\nname: nested-only\n---\n";
  const nestedResult = runAudit(nestedOnly);
  assert.equal(nestedResult.status, 1);
  assert.match(nestedResult.stdout, /root coordinator SKILL\.md is missing/);
});

test("rejects a reference not named in root skill", () => {
  const files = baseFiles();
  files["references/unlisted.md"] = "# Hidden manual\n";
  const result = runAudit(files);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /reference is not directly named in root SKILL\.md/);
  assert.match(result.stdout, /references\/unlisted\.md/);
});

test("enforces progressive disclosure for the coordinator and long references", () => {
  const files = baseFiles();
  files["SKILL.md"] += `${"Keep task detail routed through references.\n".repeat(500)}`;
  files["references/core.md"] = `# Core\n\n${"Guidance.\n".repeat(100)}`;
  const result = runAudit(files);
  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /root coordinator exceeds the progressive-disclosure line budget/,
  );
  assert.match(result.stdout, /long reference is missing a top-level contents map/);

  files["SKILL.md"] = baseFiles()["SKILL.md"]!;
  files["references/core.md"] =
    `# Core\n\n## Contents\n\n- Guidance\n\n${"Guidance.\n".repeat(100)}`;
  const corrected = runAudit(files);
  assert.equal(corrected.status, 0, diagnostic(corrected));
});

test("rejects broken or escaping relative Markdown links", () => {
  const files = baseFiles();
  files["README.md"] =
    "[Missing](references/missing.md)\n" + "[Escape](../../outside.md)\n";
  const result = runAudit(files);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /unresolved relative Markdown link/);
  assert.match(result.stdout, /relative Markdown link escapes the skill package/);
});

test("ignores link examples inside fenced code", () => {
  const files = baseFiles();
  files["README.md"] = "```md\n[Illustration](not-a-real-file.md)\n```\n";
  const result = runAudit(files);
  assert.equal(result.status, 0, diagnostic(result));
});

test("rejects cross-skill invocations and installed paths", () => {
  const files = baseFiles();
  files["references/core.md"] =
    "Use $external-render-helper, then read " +
    "~/.codex/skills/other-game/SKILL.md.\n";
  const result = runAudit(files);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /cross-skill invocation/);
  assert.match(result.stdout, /cross-skill installed path/);
});

test("exempts legal attribution from operational reference checks", () => {
  const files = baseFiles();
  files["NOTICE.md"] = "Legal text naming $external-research-source.\n";
  files.LICENSE = "Attribution with skill://historical-source.\n";
  const result = runAudit(files);
  assert.equal(result.status, 0, diagnostic(result));
});

test("rejects a Three.js range below the r185 floor", () => {
  const files = baseFiles();
  files["assets/threejs-vite-game/package.json"] = JSON.stringify({
    scripts: {
      "audit:local": "node --import tsx scripts/audit-local-only.ts",
      "setup:browsers": "playwright install chromium",
    },
    dependencies: { three: "^0.184.0" },
    devDependencies: { "@types/three": "^0.184.1" },
  });
  const result = runAudit(files);
  assert.equal(result.status, 1);
  assert.equal(
    result.stdout.split("Three.js scaffold dependency must start at r185 or newer").length - 1,
    2,
  );
  assert.match(result.stdout, /0\.185\.0/);
});

test("rejects contradictory and mixed-old npm ranges", () => {
  assert.equal(isModernThreeRange("0.190.0 <0.185.0", "three"), false);
  assert.equal(isModernThreeRange("^0.186.0 || ^0.184.0", "three"), false);
  assert.equal(isModernThreeRange(">=0.185.0 <0.190.0", "three"), true);
  assert.equal(isModernThreeRange("^0.186.0", "@types/three"), true);
  assert.equal(isModernThreeRange("latest", "@types/three"), false);
});

test("handles equal comparator bounds and npm hyphen ranges", () => {
  assert.equal(isModernThreeRange(">=0.185.0 <=0.185.0", "three"), true);
  assert.equal(isModernThreeRange(">=0.185.0 <0.185.0", "three"), false);
  assert.equal(isModernThreeRange(">=0.185.0 >0.185.0 <=0.185.0", "three"), false);
  assert.equal(isModernThreeRange(">0.185.0 >=0.185.0 <=0.185.0", "three"), false);
  assert.equal(isModernThreeRange("0.185.0 - 0.186.0", "three"), true);
  assert.equal(isModernThreeRange("0.185 - 0.186", "three"), true);
  assert.equal(isModernThreeRange("0.184.9 - 0.186.0", "three"), false);
  assert.equal(isModernThreeRange("0.190.0 - 0.185.0", "three"), false);
});

test("accepts a supported declaration starting above the r185 baseline", () => {
  const files = baseFiles();
  files["assets/threejs-vite-game/package.json"] = JSON.stringify({
    scripts: {
      "audit:local": "node --import tsx scripts/audit-local-only.ts",
      "setup:browsers": "playwright install chromium",
    },
    dependencies: { three: "^0.186.0" },
    devDependencies: { "@types/three": "^0.186.0" },
  });
  const result = runAudit(files);
  assert.equal(result.status, 0, diagnostic(result));
});

test("requires a TypeScript/npm scaffold audit with no Python dependency", () => {
  const files = baseFiles();
  const packageJson = JSON.parse(
    files["assets/threejs-vite-game/package.json"]!,
  ) as { scripts: Record<string, string> };
  packageJson.scripts["audit:local"] = "python3 scripts/audit_local_only.py .";
  files["assets/threejs-vite-game/package.json"] = JSON.stringify(packageJson, null, 2);
  delete files["assets/threejs-vite-game/scripts/audit-local-only.ts"];
  const result = runAudit(files);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /incorrect TypeScript scaffold audit command/);
  assert.match(result.stdout, /scaffold TypeScript local-only audit is missing/);
});

test("requires an npm browser bootstrap for novice Playwright use", () => {
  const files = baseFiles();
  const packageJson = JSON.parse(
    files["assets/threejs-vite-game/package.json"]!,
  ) as { scripts: Record<string, string> };
  delete packageJson.scripts["setup:browsers"];
  files["assets/threejs-vite-game/package.json"] = JSON.stringify(packageJson, null, 2);
  const result = runAudit(files);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /missing scaffold browser bootstrap command/);
});

test("requires Timer and renderer animation loop", () => {
  const files = baseFiles();
  files["assets/threejs-vite-game/src/main.ts"] =
    "import * as THREE from 'three';\n" +
    "const scene = new THREE.Scene();\n" +
    "void scene;\n";
  const result = runAudit(files);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /scaffold must use THREE\.Timer/);
  assert.match(result.stdout, /scaffold must use renderer\.setAnimationLoop/);
});

test("rejects stale Three.js TypeScript APIs", () => {
  const files = baseFiles();
  files["assets/threejs-vite-game/src/legacy.ts"] =
    "import * as THREE from 'three';\n" +
    "declare const renderer: THREE.WebGLRenderer;\n" +
    "declare const albedoMap: THREE.Texture;\n" +
    "const clock = new THREE.Clock();\n" +
    "requestAnimationFrame(() => clock.getDelta());\n" +
    "renderer.outputEncoding = THREE.sRGBEncoding;\n" +
    "albedoMap.encoding = THREE.sRGBEncoding;\n";
  const result = runAudit(files);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /deprecated THREE\.Clock timing/);
  assert.match(result.stdout, /removed renderer\.outputEncoding/);
  assert.match(result.stdout, /removed Texture\.encoding/);
  assert.match(result.stdout, /removed color encoding constant/);
});

test("allows an intentionally owned manual animation frame loop", () => {
  const files = baseFiles();
  files["assets/threejs-vite-game/src/preview-loop.ts"] =
    "let frame = 0;\n" +
    "function tick() { frame = requestAnimationFrame(tick); }\n" +
    "export function stop() { cancelAnimationFrame(frame); }\n";
  const result = runAudit(files);
  assert.equal(result.status, 0, diagnostic(result));
});

test("does not treat comments or strings as stale API usage", () => {
  const files = baseFiles();
  files["assets/threejs-vite-game/src/notes.ts"] =
    "// new THREE.Clock(); requestAnimationFrame(loop);\n" +
    "const note = 'renderer.outputEncoding = THREE.sRGBEncoding';\n" +
    "void note;\n";
  const result = runAudit(files);
  assert.equal(result.status, 0, diagnostic(result));
});

test("rejects a stale API in an executable Markdown fence", () => {
  const files = baseFiles();
  files["references/core.md"] +=
    "\n```ts\n" +
    "const loader = new RGBELoader();\n" +
    "await renderer.renderAsync(scene, camera);\n" +
    "```\n";
  const result = runAudit(files);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /deprecated RGBELoader compatibility alias/);
  assert.match(result.stdout, /deprecated renderer or pipeline renderAsync/);
});

test("ignores prose, non-executable fences, comments, and strings", () => {
  const files = baseFiles();
  files["references/core.md"] +=
    "\n`RGBELoader` is historical prose.\n" +
    "```text\nnew RGBELoader(); renderer.renderAsync();\n```\n" +
    "```ts\n" +
    "// new RGBELoader();\n" +
    "const note = 'renderer.renderAsync()';\n" +
    "void note;\n" +
    "```\n";
  const result = runAudit(files);
  assert.equal(result.status, 0, diagnostic(result));
});

test("rejects a WebGPU example with WebGL-only customization", () => {
  const files = baseFiles();
  files["references/core.md"] +=
    "\n```ts\n" +
    "const renderer = new THREE.WebGPURenderer({ alpha: false });\n" +
    "const composer = new EffectComposer(renderer);\n" +
    "```\n";
  const result = runAudit(files);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /WebGPU example mixes in EffectComposer/);
});

test("accepts current compute and WebGL TSL migration bridge", () => {
  const files = baseFiles();
  files["references/core.md"] +=
    "\n```ts\n" +
    "const webgpu = new THREE.WebGPURenderer({ alpha: false });\n" +
    "await webgpu.computeAsync(computeNode);\n" +
    "```\n" +
    "```ts\n" +
    "const webgl = new THREE.WebGLRenderer();\n" +
    "webgl.setNodesHandler(new WebGLNodesHandler());\n" +
    "webgl.setEffects([bloomPass]);\n" +
    "```\n";
  const result = runAudit(files);
  assert.equal(result.status, 0, diagnostic(result));
});

test("reports current VTK/LWO loaders as deprecated rather than removed at r185", () => {
  const files = baseFiles();
  files["assets/threejs-vite-game/src/loaders.ts"] =
    "import { VTKLoader } from 'three/addons/loaders/VTKLoader.js';\n" +
    "import { LWOLoader } from 'three/addons/loaders/LWOLoader.js';\n" +
    "void VTKLoader; void LWOLoader;\n";
  const result = runAudit(files);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /deprecated VTKLoader \(present in r185/);
  assert.match(result.stdout, /deprecated LWOLoader \(present in r185/);
});

test("requires an XR bypass in a scaffold RenderPipeline", () => {
  const files = baseFiles();
  files["assets/threejs-vite-game/src/webgpu.ts"] =
    "import * as THREE from 'three/webgpu';\n" +
    "declare const renderer: THREE.WebGPURenderer;\n" +
    "declare const scene: THREE.Scene;\n" +
    "declare const camera: THREE.Camera;\n" +
    "const pipeline = new THREE.RenderPipeline(renderer);\n" +
    "pipeline.render();\n";
  const missing = runAudit(files);
  assert.equal(missing.status, 1);
  assert.match(
    missing.stdout,
    /scaffold RenderPipeline must bypass post while XR is presenting/,
  );

  files["assets/threejs-vite-game/src/webgpu.ts"] =
    "import * as THREE from 'three/webgpu';\n" +
    "declare const renderer: THREE.WebGPURenderer;\n" +
    "declare const scene: THREE.Scene;\n" +
    "declare const camera: THREE.Camera;\n" +
    "const pipeline = new THREE.RenderPipeline(renderer);\n" +
    "if (renderer.xr.isPresenting) renderer.render(scene, camera);\n" +
    "else pipeline.render();\n";
  const complete = runAudit(files);
  assert.equal(complete.status, 0, diagnostic(complete));
});

test("flags WebGPURenderer fences missing alpha: false", () => {
  const files = baseFiles();
  files["references/core.md"] +=
    "\n```ts\nconst renderer = new THREE.WebGPURenderer({ antialias: true });\n```\n";
  const result = runAudit(files);
  assert.equal(result.status, 1);
  assert.match(
    result.stdout,
    /WebGPURenderer example should set alpha: false unless annotated transparent/,
  );
});

test("rejects renderer mixing across fences in one section", () => {
  const files = baseFiles();
  files["references/core.md"] +=
    "\n## One renderer recipe\n" +
    "```ts\nconst renderer = new THREE.WebGPURenderer({ alpha: false });\n```\n" +
    "Continue the same recipe:\n" +
    "```ts\nconst composer = new EffectComposer(renderer);\n```\n";
  const result = runAudit(files);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /WebGPU example mixes in EffectComposer/);
});

test("rejects a root-absolute asset URL in an executable fence", () => {
  const files = baseFiles();
  files["references/core.md"] +=
    "\n```ts\nawait loader.loadAsync('/assets/hero.glb');\n```\n";
  const result = runAudit(files);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /root-absolute asset URL bypasses the Vite base/);
});

test("accepts current GLTFExporter.parse", () => {
  const files = baseFiles();
  files["references/core.md"] +=
    "\n```ts\n" +
    "const exporter = new GLTFExporter();\n" +
    "exporter.parse(scene, onDone, onError);\n" +
    "```\n";
  const result = runAudit(files);
  assert.equal(result.status, 0, diagnostic(result));
});

test("rejects a deprecated TSL constant without a call", () => {
  const files = baseFiles();
  files["references/core.md"] +=
    "\n```ts\nconst size = viewportResolution;\nvoid size;\n```\n";
  const result = runAudit(files);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /deprecated TSL constant alias/);
});

test("rejects DRACOExporter.parse with an arbitrary identifier", () => {
  const files = baseFiles();
  files["references/core.md"] +=
    "\n## Export recipe\n" +
    "```ts\nconst writer = new DRACOExporter();\n```\n" +
    "```ts\nwriter.parse(mesh);\n```\n";
  const result = runAudit(files);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /deprecated DRACOExporter\.parse/);
});

/** Focused tests for audit-game-report.ts. */

import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "audit-game-report.ts");

const BASE_REPORT = [
  "Phase ledger",
  "Local content plan",
  "Local content sources: procedural, project-local",
  "Three.js revision: three@0.185.1 / r185",
  "Renderer/backend: WebGLRenderer / WebGL 2",
  "Documentation/version baseline: r185 official docs and installed package types",
  "Lifecycle/disposal: Game owns start, reset, dispose, and re-entry",
  "Resize/DPR: resize tested at capped DPR 2",
  "Loading/error behavior: local loading screen plus required-asset error and retry",
  "Game design brief",
  "Core loop",
  "Level/encounter plan",
  "Gameplay",
  "Visual",
  "UI",
  "Debug/performance",
  "QA/release",
  "Controls",
  "Build: pass",
  "Unit/focused tests: pass",
  "Production preview/base path: pass at /game/",
  "Local-only audit: pass",
  "Sustained human play: full short session",
  "Checks not run: none",
  "Remaining risks: none",
];

interface AuditResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

function runAudit(report: string, ...args: string[]): AuditResult {
  const directory = mkdtempSync(join(tmpdir(), "audit-game-report-"));
  try {
    const path = join(directory, "report.md");
    writeFileSync(path, report, "utf8");
    const result = spawnSync(process.execPath, ["--import", "tsx", SCRIPT, ...args, path], {
      encoding: "utf8",
    });
    if (result.error) throw result.error;
    return { status: result.status, stdout: result.stdout, stderr: result.stderr };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function diagnostic(result: AuditResult): string {
  return result.stdout + result.stderr;
}

test("accepts a complete base report", () => {
  const result = runAudit(BASE_REPORT.join("\n"));
  assert.equal(result.status, 0, diagnostic(result));
});

test("rejects each missing technical contract marker", async (t) => {
  const requiredLines = new Map([
    ["Three.js revision", "three.js revision"],
    ["Renderer/backend", "renderer/backend"],
    ["Documentation/version baseline", "documentation/version baseline"],
    ["Lifecycle/disposal", "lifecycle/disposal"],
    ["Resize/DPR", "resize/dpr"],
    ["Loading/error behavior", "loading/error behavior"],
  ]);

  for (const [prefix, expectedFailure] of requiredLines) {
    await t.test(prefix, () => {
      const report = BASE_REPORT.filter((line) => !line.startsWith(prefix)).join("\n");
      const result = runAudit(report);
      assert.equal(result.status, 1);
      assert.match(result.stdout, new RegExp(expectedFailure.replace("/", "\\/")));
    });
  }
});

test("accepts clear aliases for technical contract markers", () => {
  const replacements = new Map([
    ["Three.js revision", "ThreeJS revision"],
    ["Renderer/backend", "Renderer and backend"],
    ["Documentation/version baseline", "Documentation and version baseline"],
    ["Lifecycle/disposal", "Lifecycle and disposal"],
    ["Resize/DPR", "Resize and DPR"],
    ["Loading/error behavior", "Loading and error behavior"],
  ]);
  const report = BASE_REPORT.map((line) => {
    const separator = line.indexOf(":");
    if (separator < 0) return line;
    const prefix = line.slice(0, separator);
    const replacement = replacements.get(prefix);
    return replacement ? replacement + line.slice(separator) : line;
  }).join("\n");

  const result = runAudit(report);
  assert.equal(result.status, 0, diagnostic(result));
});

test("rejects an unsupported premium claim", () => {
  const result = runAudit("Looks premium.", "--premium");
  assert.equal(result.status, 1);
  assert.match(result.stdout, /missing parseable score/);
  assert.match(result.stdout, /automatic failures remaining/);
});

test("polished requires review but not numeric scores", () => {
  const missing = runAudit(BASE_REPORT.join("\n"), "--polished");
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /measured evidence/);

  const complete = runAudit(
    [
      ...BASE_REPORT,
      "Claim tier: polished",
      "Measured evidence: active capture and renderer diagnostics",
      "Fresh-eyes review: complete capture set reviewed",
      "Automatic failures remaining: none",
    ].join("\n"),
    "--polished",
  );
  assert.equal(complete.status, 0, diagnostic(complete));
});

test("physics report uses dependency-free collision language", () => {
  const result = runAudit(
    [
      ...BASE_REPORT,
      "Collision model: custom fixed-step",
      "Timestep: 1/60",
      "Collider count: 12",
    ].join("\n"),
    "--physics",
  );
  assert.equal(result.status, 0, diagnostic(result));
});

test("audio report preserves unlock, mute, and restart requirements", () => {
  const missing = runAudit(BASE_REPORT.join("\n"), "--audio");
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /gesture unlock/);
  assert.match(missing.stdout, /mute/);
  assert.match(missing.stdout, /pause\/restart/);

  const complete = runAudit(
    [
      ...BASE_REPORT,
      "Audio: local procedural Web Audio",
      "Gesture unlock: verified after Start",
      "Mute: verified",
      "Pause/restart: voices stop and recover",
    ].join("\n"),
    "--audio",
  );
  assert.equal(complete.status, 0, diagnostic(complete));
});

test("--no-design skips only design markers", () => {
  const designPrefixes = [
    "Game design brief",
    "Core loop",
    "Level/encounter plan",
    "Sustained human play",
  ];
  const reportLines = BASE_REPORT.filter(
    (line) => !designPrefixes.some((prefix) => line.startsWith(prefix)),
  );
  const complete = runAudit(reportLines.join("\n"), "--no-design");
  assert.equal(complete.status, 0, diagnostic(complete));

  const withoutRevision = reportLines.filter((line) => !line.startsWith("Three.js revision"));
  const missing = runAudit(withoutRevision.join("\n"), "--no-design");
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /three\.js revision/);
});

test("rejects a failed audit and remote content source", () => {
  const report = BASE_REPORT.filter(
    (line) =>
      !line.startsWith("Local-only audit") && !line.startsWith("Local content sources"),
  ).join("\n");
  const result = runAudit(
    `${report}\nLocal-only audit: failed\nLocal content sources: remote`,
  );
  assert.equal(result.status, 1);
  assert.match(result.stdout, /local-only audit must explicitly pass/);
  assert.match(result.stdout, /invalid local content source/);
});

test("rejects failed tests and production preview", () => {
  const report = BASE_REPORT.map((line) =>
    line.startsWith("Unit/focused tests")
      ? "Unit/focused tests: failed"
      : line.startsWith("Production preview/base path")
        ? "Production preview/base path: failed"
        : line,
  ).join("\n");
  const result = runAudit(report);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /unit\/focused tests must explicitly pass/);
  assert.match(result.stdout, /production preview\/base path must explicitly pass/);
});

test("difficulty report requires two reaction-delay routes", () => {
  const missing = runAudit(BASE_REPORT.join("\n"), "--difficulty");
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /two-reaction-delay bot comparison/);

  const complete = runAudit(
    [...BASE_REPORT, "Two-reaction-delay bot comparison: 0ms vs 300ms"].join("\n"),
    "--difficulty",
  );
  assert.equal(complete.status, 0, diagnostic(complete));
});

test("rejects a premium score above the scale", () => {
  const categories = [
    "art direction",
    "hero/player",
    "obstacles/enemies",
    "rewards/interactables",
    "world/environment",
    "materials/textures",
    "lighting/render",
    "vfx/motion",
    "ui/hud",
    "performance evidence",
  ];
  const premium = [
    "Claim tier: premium",
    "Measured evidence",
    "Fresh-eyes review",
    "Automatic failures remaining: none",
    "Technical art",
    "Render budget",
    "Visual test harness",
    ...categories.map((category) => `${category}: ${category === "art direction" ? 3.9 : 3}`),
  ];
  const result = runAudit([...BASE_REPORT, ...premium].join("\n"), "--premium");
  assert.equal(result.status, 1);
  assert.match(result.stdout, /score above 3: art direction=3\.9/);
});

test("showcase enforces six top scores and average", () => {
  const categories = [
    "art direction",
    "hero/player",
    "obstacles/enemies",
    "rewards/interactables",
    "world/environment",
    "materials/textures",
    "lighting/render",
    "vfx/motion",
    "ui/hud",
    "performance evidence",
  ];
  const evidence = [
    "Measured evidence",
    "Fresh-eyes review",
    "Automatic failures remaining: none",
    "Technical art",
    "Render budget",
    "Visual test harness",
  ];
  const premiumOnly = [
    "Claim tier: showcase",
    ...categories.map((category) => `${category}: 2.5`),
    ...evidence,
  ];
  const rejected = runAudit(
    [...BASE_REPORT, ...premiumOnly].join("\n"),
    "--showcase",
  );
  assert.equal(rejected.status, 1);
  assert.match(rejected.stdout, /at least six category scores of 3/);
  assert.match(rejected.stdout, /average below 2\.7/);

  const showcaseScores = [
    "Claim tier: showcase",
    ...categories.slice(0, 7).map((category) => `${category}: 3`),
    ...categories.slice(7).map((category) => `${category}: 2`),
    ...evidence,
  ];
  const accepted = runAudit(
    [...BASE_REPORT, ...showcaseScores].join("\n"),
    "--showcase",
  );
  assert.equal(accepted.status, 0, diagnostic(accepted));
});

test("rejects report-tier and flag mismatches", () => {
  const categories = [
    "art direction",
    "hero/player",
    "obstacles/enemies",
    "rewards/interactables",
    "world/environment",
    "materials/textures",
    "lighting/render",
    "vfx/motion",
    "ui/hud",
    "performance evidence",
  ];
  const report = [
    ...BASE_REPORT,
    "Claim tier: showcase",
    "Measured evidence",
    "Fresh-eyes review",
    "Automatic failures remaining: none",
    "Technical art",
    "Render budget",
    "Visual test harness",
    ...categories.map((category) => `${category}: 3`),
  ].join("\n");

  const result = runAudit(report, "--premium");
  assert.equal(result.status, 1);
  assert.match(result.stdout, /claim tier must explicitly match --premium/);

  const missingFlag = runAudit(report);
  assert.equal(missingFlag.status, 1);
  assert.match(missingFlag.stdout, /claim tier showcase requires the matching --showcase flag/);

  const invalid = runAudit(report.replace("Claim tier: showcase", "Claim tier: ultra"));
  assert.equal(invalid.status, 1);
  assert.match(invalid.stdout, /invalid claim tier: ultra/);
});

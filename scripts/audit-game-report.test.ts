/** Focused tests for audit-game-report.ts. */

import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { normalize } from "./audit-game-report.ts";

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), "audit-game-report.ts");

const BASE_REPORT = [
  "## Phase ledger",
  "Discovery/design: approved brief and implementation route",
  "## Local content plan",
  "Local content sources: procedural, project-local",
  "Claim tier: none",
  "## Three.js and runtime contract",
  "Three.js revision: three@0.185.0 / r185",
  "Renderer/backend: WebGLRenderer / WebGL 2",
  "Documentation/version baseline: installed r185 official docs and package types",
  "Lifecycle/disposal: Game owns start, reset, dispose, and re-entry",
  "Resize/DPR: resize tested at capped DPR 2",
  "Loading/error behavior: local loading screen plus required-asset error and retry",
  "## Game design brief",
  "Core loop: collect, evade, finish, and retry",
  "Level/encounter plan: one authored arena with escalating threats",
  "## Implementation evidence",
  "Gameplay: objective, fail state, and restart verified",
  "Visual: baseline captures reviewed",
  "UI: HUD and state messaging verified",
  "Debug/performance: production diagnostics and frame capture reviewed",
  "QA/release: release checklist completed",
  "Controls: keyboard and pointer controls verified",
  "## Verification",
  "Build: pass",
  "Unit/focused tests: pass",
  "Production preview/base path: pass at /game/",
  "Desktop/mobile: desktop 1280x720 and mobile Pixel 7 passed",
  "Local-only audit: pass",
  "Sustained human play: full short session",
  "Checks not run: none",
  "Remaining risks: none",
];

function baseReportForTier(tier: "none" | "polished" | "premium" | "showcase"): string[] {
  return BASE_REPORT.map((line) =>
    line.startsWith("Claim tier:") ? `Claim tier: ${tier}` : line,
  );
}

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

test("runs the report CLI through a symlinked entry path", () => {
  const directory = mkdtempSync(join(tmpdir(), "audit-game-report-link-"));
  try {
    const link = join(directory, "audit-game-report.ts");
    symlinkSync(SCRIPT, link);
    const result = spawnSync(process.execPath, ["--import", "tsx", link, "--help"], {
      encoding: "utf8",
      cwd: dirname(SCRIPT),
    });
    assert.equal(result.status, 0, diagnostic(result));
    assert.match(result.stdout, /usage: audit-game-report/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("normalizes aliases token-wise and idempotently", () => {
  const canonical = "Game design brief\nLevel/encounter plan: approved";
  assert.equal(normalize(normalize(canonical)), normalize(canonical));
  assert.match(normalize("Design brief"), /^game design brief$/);
  assert.match(normalize("Encounter plan: approved"), /^level\/encounter plan:/);
  assert.doesNotMatch(normalize(canonical), /game game|level\/level/);
});

test("requires exactly one claim-tier field", () => {
  const missing = runAudit(
    BASE_REPORT.filter((line) => !line.startsWith("Claim tier:")).join("\n"),
  );
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /claim tier must appear exactly once: found 0/);

  const duplicated = runAudit([...BASE_REPORT, "Claim tier: premium"].join("\n"));
  assert.equal(duplicated.status, 1);
  assert.match(duplicated.stdout, /claim tier must appear exactly once: found 2/);
});

test("rejects a minimally edited bundled report template", () => {
  const template = readFileSync(
    join(dirname(SCRIPT), "../assets/game-report.template.md"),
    "utf8",
  )
    .replace(
      /Local content sources:[\s\S]*?deferred\]/,
      "Local content sources: procedural",
    )
    .replace("- Build: [pass/fail]", "- Build: pass")
    .replace("- Unit/focused tests: [commands and pass/fail]", "- Unit/focused tests: pass")
    .replace(
      "- Production preview/base path: [URL, configured base, pass/fail]",
      "- Production preview/base path: pass at /game/",
    )
    .replace("- Local-only audit: [pass/fail]", "- Local-only audit: pass")
    .replace(
      "- Claim tier: [none/polished/premium/showcase; visual claims must match the audit flag]",
      "- Claim tier: none",
    );

  const result = runAudit(template);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /phase ledger/);
  assert.match(result.stdout, /three\.js revision/);
  assert.match(result.stdout, /gameplay/);
});

test("does not count fenced, quoted, or commented sample evidence", () => {
  const realSingletons = [
    "Local content sources: procedural",
    "Claim tier: none",
    "Desktop/mobile: desktop and mobile in scope",
    "Build: pass",
    "Unit/focused tests: pass",
    "Production preview/base path: pass at /game/",
    "Local-only audit: pass",
  ].join("\n");
  const samples = [
    `\`\`\`md\n${BASE_REPORT.join("\n")}\n\`\`\``,
    BASE_REPORT.map((line) => `> ${line}`).join("\n"),
    `<!--\n${BASE_REPORT.join("\n")}\n-->`,
  ];
  for (const sample of samples) {
    const result = runAudit(`${realSingletons}\n${sample}`);
    assert.equal(result.status, 1, diagnostic(result));
    assert.match(result.stdout, /gameplay/);
    assert.match(result.stdout, /three\.js revision/);
  }
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
      ...baseReportForTier("polished"),
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
    "## Game design brief",
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

test("rejects duplicate local-content-source fields", () => {
  const result = runAudit([
    ...BASE_REPORT,
    "Local content sources: deferred",
  ].join("\n"));
  assert.equal(result.status, 1);
  assert.match(result.stdout, /local content sources must appear exactly once: found 2/);
});

test("requires one desktop/mobile policy and a reasoned desktop-only waiver", () => {
  const duplicated = runAudit([
    ...BASE_REPORT,
    "Desktop/mobile: not applicable — desktop-only kiosk deployment",
  ].join("\n"));
  assert.equal(duplicated.status, 1);
  assert.match(duplicated.stdout, /desktop\/mobile must appear exactly once: found 2/);

  const vague = runAudit(BASE_REPORT.map((line) =>
    line.startsWith("Desktop/mobile:")
      ? "Desktop/mobile: not applicable — desktop-only reason"
      : line,
  ).join("\n"));
  assert.equal(vague.status, 1);
  assert.match(vague.stdout, /desktop\/mobile waiver must be/);

  const waived = runAudit(BASE_REPORT.map((line) =>
    line.startsWith("Desktop/mobile:")
      ? "Desktop/mobile: not applicable — desktop-only fixed museum kiosk without touch input"
      : line,
  ).join("\n"));
  assert.equal(waived.status, 0, diagnostic(waived));
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

test("rejects contradictory pass statuses instead of accepting a pass prefix", () => {
  const report = BASE_REPORT.map((line) =>
    line.startsWith("Build")
      ? "Build: pass, but failed during the production build"
      : line.startsWith("Local-only audit")
        ? "Local-only audit: 0 findings, but nested app was skipped"
        : line,
  ).join("\n");
  const result = runAudit(report);
  assert.equal(result.status, 1);
  assert.match(result.stdout, /build must explicitly pass/);
  assert.match(result.stdout, /local-only audit must explicitly pass/);
});

test("rejects plural failure suffixes and duplicate result fields", () => {
  const pluralFailure = BASE_REPORT.map((line) =>
    line.startsWith("Build") ? "Build: pass; 2 failures remain" : line,
  ).join("\n");
  const failedPlural = runAudit(pluralFailure);
  assert.equal(failedPlural.status, 1);
  assert.match(failedPlural.stdout, /build must explicitly pass/);

  const duplicated = runAudit(
    [...BASE_REPORT, "Build: failed"].join("\n"),
  );
  assert.equal(duplicated.status, 1);
  assert.match(duplicated.stdout, /build must explicitly pass/);
});

test("accepts bounded command-first and pass-first result evidence", () => {
  const report = BASE_REPORT.map((line) =>
    line.startsWith("Build")
      ? "Build: npm run build — pass"
      : line.startsWith("Unit/focused tests")
        ? "Unit/focused tests: npm test: passed"
        : line.startsWith("Production preview/base path")
          ? "Production preview/base path: pass at /game/"
          : line.startsWith("Local-only audit")
            ? "Local-only audit: npm run audit:local - 0 findings"
            : line,
  ).join("\n");
  const result = runAudit(report);
  assert.equal(result.status, 0, diagnostic(result));
});

test("rejects qualified or pending pass claims", () => {
  const ambiguousValues = [
    "pass if the pending rebuild succeeds",
    "pass, but incomplete",
    "pass; pending deployment",
    "pass except one waiver",
  ];
  for (const value of ambiguousValues) {
    const report = BASE_REPORT.map((line) =>
      line.startsWith("Build") ? `Build: ${value}` : line,
    ).join("\n");
    const result = runAudit(report);
    assert.equal(result.status, 1, `${value}\n${diagnostic(result)}`);
    assert.match(result.stdout, /build must explicitly pass/);
  }
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
    "Measured evidence: renderer capture and browser timings",
    "Fresh-eyes review: independent capture review completed",
    "Automatic failures remaining: none",
    "Technical art: silhouettes and material values reviewed",
    "Render budget: desktop and mobile budgets passed",
    "Visual test harness: deterministic screenshots passed",
    ...categories.map((category) => `${category}: ${category === "art direction" ? 3.9 : 3}`),
  ];
  const result = runAudit([...baseReportForTier("premium"), ...premium].join("\n"), "--premium");
  assert.equal(result.status, 1);
  assert.match(result.stdout, /score above 3: art direction=3\.9/);
});

test("parses the complete numeric score token instead of truncating 30 to 3", () => {
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
    ...baseReportForTier("premium"),
    "Measured evidence: renderer capture and browser timings",
    "Fresh-eyes review: independent capture review completed",
    "Automatic failures remaining: none",
    "Technical art: silhouettes and material values reviewed",
    "Render budget: desktop and mobile budgets passed",
    "Visual test harness: deterministic screenshots passed",
    ...categories.map((category) => `${category}: ${category === "art direction" ? 30 : 3}`),
  ].join("\n");
  const result = runAudit(report, "--premium");
  assert.equal(result.status, 1);
  assert.match(result.stdout, /score above 3: art direction=30/);
});

test("rejects scientific-notation prefixes and duplicate score rows", () => {
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
    "Measured evidence: renderer capture and browser timings",
    "Fresh-eyes review: independent capture review completed",
    "Automatic failures remaining: none",
    "Technical art: silhouettes and material values reviewed",
    "Render budget: desktop and mobile budgets passed",
    "Visual test harness: deterministic screenshots passed",
  ];

  const scientific = runAudit([
    ...baseReportForTier("premium"),
    ...evidence,
    ...categories.map((category) => `${category}: 3e99`),
  ].join("\n"), "--premium");
  assert.equal(scientific.status, 1);
  assert.match(scientific.stdout, /missing parseable score: art direction/);

  const duplicate = runAudit([
    ...baseReportForTier("premium"),
    ...evidence,
    ...categories.map((category) => `${category}: 3`),
    "art direction: 2",
  ].join("\n"), "--premium");
  assert.equal(duplicate.status, 1);
  assert.match(duplicate.stdout, /missing parseable score: art direction/);

  const invalidDenominator = runAudit([
    ...baseReportForTier("premium"),
    ...evidence,
    ...categories.map((category) => `${category}: 3/999`),
  ].join("\n"), "--premium");
  assert.equal(invalidDenominator.status, 1);
  assert.match(invalidDenominator.stdout, /missing parseable score: art direction/);

  const scaleNotation = runAudit([
    ...baseReportForTier("premium"),
    ...evidence,
    ...categories.map((category) => `${category}: 3/3`),
  ].join("\n"), "--premium");
  assert.equal(scaleNotation.status, 0, diagnostic(scaleNotation));

  const unpunctuatedSuffix = runAudit([
    ...baseReportForTier("premium"),
    ...evidence,
    ...categories.map((category) => `${category}: 3/3 unsupported suffix`),
  ].join("\n"), "--premium");
  assert.equal(unpunctuatedSuffix.status, 1);
  assert.match(unpunctuatedSuffix.stdout, /missing parseable score: art direction/);

  const punctuatedEvidence = runAudit([
    ...baseReportForTier("premium"),
    ...evidence,
    ...categories.map((category) => `${category}: 3/3 — capture reviewed`),
  ].join("\n"), "--premium");
  assert.equal(punctuatedEvidence.status, 0, diagnostic(punctuatedEvidence));
});

test("requires an exact zero automatic-failure status", () => {
  const report = [
    ...baseReportForTier("polished"),
    "Measured evidence: captured",
    "Fresh-eyes review: complete",
    "Automatic failures remaining: none; 2 failures are waived",
  ].join("\n");
  const result = runAudit(report, "--polished");
  assert.equal(result.status, 1);
  assert.match(result.stdout, /automatic failures remaining must be none or 0/);

  const duplicated = runAudit([
    ...baseReportForTier("polished"),
    "Measured evidence: captured",
    "Fresh-eyes review: complete",
    "Automatic failures remaining: none",
    "Automatic failures remaining: 0",
  ].join("\n"), "--polished");
  assert.equal(duplicated.status, 1);
  assert.match(
    duplicated.stdout,
    /automatic failures remaining must appear exactly once: found 2/,
  );
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
    "Measured evidence: renderer capture and browser timings",
    "Fresh-eyes review: independent capture review completed",
    "Automatic failures remaining: none",
    "Technical art: silhouettes and material values reviewed",
    "Render budget: desktop and mobile budgets passed",
    "Visual test harness: deterministic screenshots passed",
  ];
  const premiumOnly = [
    ...categories.map((category) => `${category}: 2.5`),
    ...evidence,
  ];
  const rejected = runAudit(
    [...baseReportForTier("showcase"), ...premiumOnly].join("\n"),
    "--showcase",
  );
  assert.equal(rejected.status, 1);
  assert.match(rejected.stdout, /at least six category scores of 3/);
  assert.match(rejected.stdout, /average below 2\.7/);

  const showcaseScores = [
    ...categories.slice(0, 7).map((category) => `${category}: 3`),
    ...categories.slice(7).map((category) => `${category}: 2`),
    ...evidence,
  ];
  const accepted = runAudit(
    [...baseReportForTier("showcase"), ...showcaseScores].join("\n"),
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
    ...baseReportForTier("showcase"),
    "Measured evidence: renderer capture and browser timings",
    "Fresh-eyes review: independent capture review completed",
    "Automatic failures remaining: none",
    "Technical art: silhouettes and material values reviewed",
    "Render budget: desktop and mobile budgets passed",
    "Visual test harness: deterministic screenshots passed",
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

#!/usr/bin/env node
/** Audit a Three.js game evidence report for scope-appropriate completion markers. */

import { readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

const BASE_REQUIRED = [
  "phase ledger",
  "local content plan",
  "gameplay",
  "visual",
  "ui",
  "debug/performance",
  "qa/release",
  "controls",
  "unit/focused tests",
  "production preview/base path",
  "checks not run",
  "remaining risks",
];

const TECHNICAL_REQUIRED = [
  "three.js revision",
  "renderer/backend",
  "documentation/version baseline",
  "lifecycle/disposal",
  "resize/dpr",
  "loading/error behavior",
];

const DESIGN_REQUIRED = [
  "game design brief",
  "core loop",
  "level/encounter plan",
  "sustained human play",
];

const PREMIUM_CATEGORIES = [
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

const PREMIUM_REQUIRED = [
  "measured evidence",
  "fresh-eyes review",
  "automatic failures remaining",
  "technical art",
  "render budget",
  "visual test harness",
];

const POLISHED_REQUIRED = [
  "measured evidence",
  "fresh-eyes review",
  "automatic failures remaining",
];

const PHYSICS_REQUIRED = ["collision model", "timestep", "collider"];
const AUDIO_REQUIRED = ["audio", "gesture unlock", "mute", "pause/restart"];
const DIFFICULTY_REQUIRED = ["two-reaction-delay bot comparison"];

const PASS_PATTERNS = new Map<string, RegExp>([
  [
    "build must explicitly pass",
    /^\s*(?:[-*]\s*)?build(?:\/typecheck)?(?:\s+result)?\s*[:=-]\s*(?:pass|passed|clean)\b/m,
  ],
  [
    "local-only audit must explicitly pass",
    /^\s*(?:[-*]\s*)?local-only audit\s*[:=-]\s*(?:pass|passed|clean|0 findings|0 failures)\b/m,
  ],
  [
    "unit/focused tests must explicitly pass",
    /^\s*(?:[-*]\s*)?unit\/focused tests\s*[:=-]\s*(?:pass|passed|clean)\b/m,
  ],
  [
    "production preview/base path must explicitly pass",
    /^\s*(?:[-*]\s*)?production preview\/base path\s*[:=-]\s*(?:pass|passed|clean)\b/m,
  ],
]);

const CONTENT_SOURCE_PATTERN =
  /^\s*(?:[-*]\s*)?local content sources\s*[:=-]\s*([^\n]+)$/m;
const ALLOWED_CONTENT_SOURCES = new Set([
  "procedural",
  "project-local",
  "user-supplied",
  "deferred",
]);
const CLAIM_TIER_PATTERN = /^\s*(?:[-*]\s*)?claim tier\s*[:=-]\s*([^\n]+)$/m;
const ALLOWED_CLAIM_TIERS = new Set(["none", "polished", "premium", "showcase"]);

interface Options {
  report: string;
  polished: boolean;
  premium: boolean;
  showcase: boolean;
  physics: boolean;
  audio: boolean;
  difficulty: boolean;
  noDesign: boolean;
}

const HELP = `usage: audit-game-report.ts [-h] [--polished | --premium | --showcase]
                            [--physics] [--audio] [--difficulty]
                            [--no-design]
                            report

Check a Three.js game report for design, implementation, and QA evidence.

positional arguments:
  report        Markdown/text report path.

options:
  -h, --help    show this help message and exit
  --polished    Enforce polished evidence, fresh-eyes, and automatic-failure gates.
  --premium     Enforce premium scorecard gates.
  --showcase    Enforce the stricter showcase scorecard gates.
  --physics     Require physics evidence.
  --audio       Require audio evidence.
  --difficulty  Require two seeded reaction-delay bot routes for difficulty/fairness work.
  --no-design   Skip design markers for a debug/performance/QA-only task.`;

function cliError(message: string): never {
  console.error(`audit-game-report.ts: error: ${message}`);
  process.exit(2);
}

function parseArgs(argv: string[]): Options {
  const flags = {
    polished: false,
    premium: false,
    showcase: false,
    physics: false,
    audio: false,
    difficulty: false,
    noDesign: false,
  };
  const positionals: string[] = [];
  let parseOptions = true;

  for (const argument of argv) {
    if (parseOptions && argument === "--") {
      parseOptions = false;
    } else if (parseOptions && (argument === "-h" || argument === "--help")) {
      console.log(HELP);
      process.exit(0);
    } else if (parseOptions && argument === "--polished") {
      flags.polished = true;
    } else if (parseOptions && argument === "--premium") {
      flags.premium = true;
    } else if (parseOptions && argument === "--showcase") {
      flags.showcase = true;
    } else if (parseOptions && argument === "--physics") {
      flags.physics = true;
    } else if (parseOptions && argument === "--audio") {
      flags.audio = true;
    } else if (parseOptions && argument === "--difficulty") {
      flags.difficulty = true;
    } else if (parseOptions && argument === "--no-design") {
      flags.noDesign = true;
    } else if (parseOptions && argument.startsWith("-")) {
      cliError(`unrecognized arguments: ${argument}`);
    } else {
      positionals.push(argument);
    }
  }

  if (positionals.length === 0) cliError("the following arguments are required: report");
  if (positionals.length > 1) {
    cliError(`unrecognized arguments: ${positionals.slice(1).join(" ")}`);
  }

  const selectedTiers = [flags.polished, flags.premium, flags.showcase].filter(Boolean).length;
  if (selectedTiers > 1) {
    cliError("argument --polished/--premium/--showcase: not allowed with another claim-tier flag");
  }

  return { report: positionals[0]!, ...flags };
}

export function normalize(text: string): string {
  const replacements = new Map([
    ["phase evidence", "phase ledger"],
    ["content strategy", "local content plan"],
    ["asset plan", "local content plan"],
    ["design brief", "game design brief"],
    ["playable loop", "core loop"],
    ["level plan", "level/encounter plan"],
    ["encounter plan", "level/encounter plan"],
    ["technical-art", "technical art"],
    ["fresh eyes", "fresh-eyes"],
    ["local only audit", "local-only audit"],
    ["unrun checks", "checks not run"],
    ["residual risks", "remaining risks"],
    ["debug and performance", "debug/performance"],
    ["qa and release", "qa/release"],
    ["physics engine", "collision model"],
    ["threejs revision", "three.js revision"],
    ["three revision", "three.js revision"],
    ["renderer / backend", "renderer/backend"],
    ["renderer and backend", "renderer/backend"],
    ["render backend", "renderer/backend"],
    ["documentation / version baseline", "documentation/version baseline"],
    ["documentation and version baseline", "documentation/version baseline"],
    ["documentation/version check", "documentation/version baseline"],
    ["documentation / version check", "documentation/version baseline"],
    ["docs/version baseline", "documentation/version baseline"],
    ["docs/version check", "documentation/version baseline"],
    ["version/documentation baseline", "documentation/version baseline"],
    ["version/documentation check", "documentation/version baseline"],
    ["lifecycle / disposal", "lifecycle/disposal"],
    ["lifecycle and disposal", "lifecycle/disposal"],
    ["resize / dpr", "resize/dpr"],
    ["resize and dpr", "resize/dpr"],
    ["resize/device pixel ratio", "resize/dpr"],
    ["loading / error behavior", "loading/error behavior"],
    ["loading and error behavior", "loading/error behavior"],
    ["loading/error handling", "loading/error behavior"],
  ]);

  let normalized = text.toLowerCase();
  for (const [before, after] of replacements) {
    normalized = normalized.split(before).join(after);
  }
  return normalized;
}

function missingMarkers(text: string, markers: readonly string[]): string[] {
  return markers.filter((marker) => !text.includes(marker));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scoreFor(text: string, category: string): number | undefined {
  const escaped = escapeRegExp(category);
  const patterns = [
    new RegExp(`${escaped}[^\\n]*?after\\s*[:=]?\\s*([0-3](?:\\.\\d+)?)`),
    new RegExp(`${escaped}\\s*[:=-]\\s*([0-3](?:\\.\\d+)?)`),
  ];
  for (const pattern of patterns) {
    const match = pattern.exec(text);
    if (match) return Number.parseFloat(match[1]!);
  }
  return undefined;
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function auditReport(rawText: string, options: Options): string[] {
  const text = normalize(rawText);
  const missing = missingMarkers(text, [...BASE_REQUIRED, ...TECHNICAL_REQUIRED]);
  if (!options.noDesign) missing.push(...missingMarkers(text, DESIGN_REQUIRED));
  if (options.physics) missing.push(...missingMarkers(text, PHYSICS_REQUIRED));
  if (options.audio) missing.push(...missingMarkers(text, AUDIO_REQUIRED));
  if (options.difficulty) missing.push(...missingMarkers(text, DIFFICULTY_REQUIRED));

  const semanticFailures = [...PASS_PATTERNS]
    .filter(([, pattern]) => !pattern.test(text))
    .map(([label]) => label);

  const sourceMatch = CONTENT_SOURCE_PATTERN.exec(text);
  if (!sourceMatch) {
    semanticFailures.push(
      "local content sources must list procedural, project-local, user-supplied, and/or deferred",
    );
  } else {
    const sourceValues = new Set(
      sourceMatch[1]!
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    );
    const unknownSources = [...sourceValues]
      .filter((value) => !ALLOWED_CONTENT_SOURCES.has(value))
      .sort();
    if (sourceValues.size === 0 || unknownSources.length > 0) {
      semanticFailures.push(
        `invalid local content source value(s): ${
          unknownSources.length > 0 ? unknownSources.join(", ") : "none supplied"
        }`,
      );
    }
  }

  const scoreFailures: string[] = [];
  const visualClaim = options.polished || options.premium || options.showcase;
  const scoredClaim = options.premium || options.showcase;
  const expectedTier = options.polished
    ? "polished"
    : options.premium
      ? "premium"
      : options.showcase
        ? "showcase"
        : undefined;
  const tierMatch = CLAIM_TIER_PATTERN.exec(text);
  const reportedTier = tierMatch?.[1]?.trim();

  if (reportedTier !== undefined && !ALLOWED_CLAIM_TIERS.has(reportedTier)) {
    semanticFailures.push(
      `invalid claim tier: ${reportedTier}; expected none, polished, premium, or showcase`,
    );
  } else if (expectedTier !== undefined && reportedTier !== expectedTier) {
    semanticFailures.push(
      `claim tier must explicitly match --${expectedTier}: found ${reportedTier ?? "missing"}`,
    );
  } else if (
    expectedTier === undefined &&
    reportedTier !== undefined &&
    ["polished", "premium", "showcase"].includes(reportedTier)
  ) {
    semanticFailures.push(
      `claim tier ${reportedTier} requires the matching --${reportedTier} flag`,
    );
  }

  if (visualClaim) missing.push(...missingMarkers(text, POLISHED_REQUIRED));
  if (scoredClaim) {
    missing.push(...missingMarkers(text, PREMIUM_REQUIRED));
    const scores: number[] = [];
    for (const category of PREMIUM_CATEGORIES) {
      const score = scoreFor(text, category);
      if (score === undefined) {
        scoreFailures.push(`missing parseable score: ${category}`);
      } else {
        scores.push(score);
        if (score < 2) scoreFailures.push(`score below 2: ${category}=${score}`);
        if (score > 3) scoreFailures.push(`score above 3: ${category}=${score}`);
      }
    }

    if (scores.length === PREMIUM_CATEGORIES.length) {
      const average = scores.reduce((total, score) => total + score, 0) / scores.length;
      if (average < 2.3) {
        scoreFailures.push(`scorecard average below 2.3: ${average.toFixed(2)}`);
      }
      if (options.showcase) {
        const topScores = scores.filter((score) => score === 3).length;
        if (topScores < 6) {
          scoreFailures.push(
            `showcase requires at least six category scores of 3: found ${topScores}`,
          );
        }
        if (average < 2.7) {
          scoreFailures.push(`showcase scorecard average below 2.7: ${average.toFixed(2)}`);
        }
      }
    }
  }

  if (
    visualClaim &&
    !/automatic failures remaining\s*[:=-]\s*(?:none|0)\b/.test(text)
  ) {
    scoreFailures.push("automatic failures remaining must be none or 0");
  }

  return [...new Set([...missing, ...semanticFailures, ...scoreFailures])];
}

export function main(argv = process.argv.slice(2)): number {
  const options = parseArgs(argv);
  const report = resolve(process.env.INIT_CWD ?? process.cwd(), options.report);
  if (!isFile(report)) {
    console.error(`Missing report file: ${report}`);
    return 2;
  }

  const failures = auditReport(readFileSync(report, "utf8"), options);
  if (failures.length > 0) {
    console.log("Game report audit failed:");
    for (const failure of failures) console.log(`- ${failure}`);
    return 1;
  }

  console.log("Game report evidence-structure audit passed; inspect cited artifacts separately.");
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  process.exitCode = main();
}

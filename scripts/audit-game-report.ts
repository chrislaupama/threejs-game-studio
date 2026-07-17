#!/usr/bin/env node
/** Audit a Three.js game evidence report for scope-appropriate completion markers. */

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
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
  "desktop/mobile",
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
const REQUIRED_SECTIONS = new Set([
  "phase ledger",
  "local content plan",
  "game design brief",
]);

const RESULT_FIELDS = new Map<string, RegExp>([
  [
    "build must explicitly pass",
    /^\s*(?:[-*]\s*)?build(?:\/typecheck)?(?:\s+result)?\s*[:=-]\s*([^\n]+)$/m,
  ],
  [
    "local-only audit must explicitly pass",
    /^\s*(?:[-*]\s*)?local-only audit\s*[:=-]\s*([^\n]+)$/m,
  ],
  [
    "unit/focused tests must explicitly pass",
    /^\s*(?:[-*]\s*)?unit\/focused tests\s*[:=-]\s*([^\n]+)$/m,
  ],
  [
    "production preview/base path must explicitly pass",
    /^\s*(?:[-*]\s*)?production preview\/base path\s*[:=-]\s*([^\n]+)$/m,
  ],
]);
const PASS_TOKEN = "(?:pass(?:ed)?|clean|0\\s+(?:findings|failures))";
const LEADING_PASS_STATUS = new RegExp(
  `^${PASS_TOKEN}(?:\\s+(?:at|via|using)\\s+[^\\n;,]+)?[.!]?$`,
);
const TRAILING_PASS_STATUS = new RegExp(
  `^[^\\n;,]+(?:—|–|-|:)\\s*${PASS_TOKEN}[.!]?$`,
);

const CONTENT_SOURCE_PATTERN =
  /^\s*(?:[-*]\s*)?local content sources\s*[:=-]\s*([^\n]+)$/m;
const ALLOWED_CONTENT_SOURCES = new Set([
  "procedural",
  "project-local",
  "user-supplied",
  "deferred",
]);
const CLAIM_TIER_PATTERN = /^\s*(?:[-*]\s*)?claim tier\s*[:=-]\s*([^\n]+)$/m;
const AUTOMATIC_FAILURES_PATTERN =
  /^\s*(?:[-*]\s*)?automatic failures remaining\s*[:=-]\s*([^\n]+)$/m;
const DESKTOP_MOBILE_PATTERN =
  /^\s*(?:[-*]\s*)?desktop\/mobile\s*[:=-]\s*(.*)$/m;
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
  // Protect already-canonical phrases, then replace aliases in one token-wise
  // pass. A replacement can therefore never be consumed by a later alias
  // (`game design brief` must not become `game game design brief`).
  const protectedValues = [...new Set(replacements.values())]
    .sort((left, right) => right.length - left.length)
    .map((value, index) => ({ value, token: `\u0000canonical-${index}\u0000` }));
  for (const { value, token } of protectedValues) {
    normalized = normalized.split(value).join(token);
  }
  const aliases = [...replacements.keys()].sort((left, right) => right.length - left.length);
  const aliasPattern = new RegExp(
    `(?<![a-z0-9])(?:${aliases.map(escapeRegExp).join("|")})(?![a-z0-9])`,
    "g",
  );
  normalized = normalized.replace(aliasPattern, (alias) => replacements.get(alias)!);
  for (const { value, token } of protectedValues) {
    normalized = normalized.split(token).join(value);
  }
  return normalized;
}

function blankExceptNewlines(value: string): string {
  return value.replace(/[^\r\n]/g, " ");
}

/** Remove quoted/sample Markdown while preserving line numbers and layout. */
export function maskNonEvidenceMarkdown(text: string): string {
  const commentMasked = text.split("");
  let inComment = false;
  for (let index = 0; index < text.length; index += 1) {
    if (!inComment && text.startsWith("<!--", index)) inComment = true;
    if (inComment && text[index] !== "\n" && text[index] !== "\r") {
      commentMasked[index] = " ";
    }
    if (inComment && text.startsWith("-->", index)) {
      for (let cursor = index; cursor < Math.min(index + 3, text.length); cursor += 1) {
        if (text[cursor] !== "\n" && text[cursor] !== "\r") commentMasked[cursor] = " ";
      }
      inComment = false;
      index += 2;
    }
  }

  const output: string[] = [];
  let fenceKind: string | undefined;
  for (const line of commentMasked.join("").match(/.*(?:\r?\n|$)/g) ?? []) {
    if (!line) continue;
    const fence = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) {
      const kind = fence[1]![0]!;
      if (fenceKind === undefined) fenceKind = kind;
      else if (fenceKind === kind) fenceKind = undefined;
      output.push(blankExceptNewlines(line));
    } else if (fenceKind !== undefined || /^\s*>/.test(line)) {
      output.push(blankExceptNewlines(line));
    } else {
      output.push(line);
    }
  }
  return output.join("");
}

function cleanLabel(value: string): string {
  return value
    .replace(/^\s*(?:[-*]\s*)?/, "")
    .replace(/[*_`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function hasSubstantiveValue(rawValue: string): boolean {
  const value = rawValue
    .replace(/<!--.*?-->/g, "")
    .replace(/[*_`]/g, "")
    .trim();
  if (!value || /^[-—–]+$/.test(value)) return false;
  if (/^\[[^\]]*\]$/.test(value) || /^<[^>]*>$/.test(value)) return false;
  if (/\[(?:replace|enter|describe|todo|tbd)\b/i.test(value)) return false;
  if (/^(?:todo|tbd|pending|placeholder|replace(?: me)?|unknown|n\/a\s*—?\s*reason)$/i.test(value)) {
    return false;
  }
  if (/^not applicable\s*(?:—|–|-|:)\s*(?:reason|explanation)?\s*[.!]?$/i.test(value)) {
    return false;
  }
  return true;
}

function parseEvidenceFields(text: string): Array<{ label: string; value: string }> {
  const fields: Array<{ label: string; value: string }> = [];
  for (const rawLine of text.split("\n")) {
    if (/^\s*#{1,6}\s+/.test(rawLine)) continue;
    const line = rawLine.replace(/^\s*(?:[-*]\s*)?/, "");
    const match = /^(.*?)(?::|=|\s+[—–-]\s+)(.*)$/.exec(line);
    if (!match) continue;
    const label = cleanLabel(match[1]!);
    const value = match[2]!.trim();
    if (label) fields.push({ label, value });
  }
  return fields;
}

function labelMatches(label: string, marker: string): boolean {
  if (label === marker) return true;
  if (marker.length <= 3) return false;
  return (
    label.startsWith(`${marker} `) ||
    label.startsWith(`${marker} (`) ||
    label.endsWith(` ${marker}`)
  );
}

function sectionHasEvidence(text: string, marker: string): boolean {
  const lines = text.split("\n");
  for (let index = 0; index < lines.length; index += 1) {
    const heading = /^\s*(#{1,6})\s+(.+?)\s*$/.exec(lines[index]!);
    if (!heading || cleanLabel(heading[2]!) !== marker) continue;
    const level = heading[1]!.length;
    const body: string[] = [];
    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const nextHeading = /^\s*(#{1,6})\s+/.exec(lines[cursor]!);
      if (nextHeading && nextHeading[1]!.length <= level) break;
      body.push(lines[cursor]!);
    }
    return parseEvidenceFields(body.join("\n"))
      .some(({ value }) => hasSubstantiveValue(value));
  }
  return false;
}

function missingEvidence(text: string, markers: readonly string[]): string[] {
  const fields = parseEvidenceFields(text);
  return markers.filter((marker) => {
    if (REQUIRED_SECTIONS.has(marker)) return !sectionHasEvidence(text, marker);
    return !fields.some(
      ({ label, value }) => labelMatches(label, marker) && hasSubstantiveValue(value),
    );
  });
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function scoreFor(text: string, category: string): number | undefined {
  const escaped = escapeRegExp(category);
  const lines = [...text.matchAll(new RegExp(
    `^\\s*(?:[-*]\\s*)?(?:\\*\\*)?${escaped}(?:\\*\\*)?\\s*([^\\n]*)$`,
    "gm",
  ))];
  if (lines.length !== 1) return undefined;
  const tail = lines[0]![1] ?? "";
  const number =
    "([-+]?(?:\\d+(?:\\.\\d+)?|\\.\\d+))(?:\\s*\\/\\s*3)?(?![\\dea-z_\\/])";
  const after = new RegExp(`\\bafter\\s*[:=]?\\s*${number}`).exec(tail);
  const direct = new RegExp(`^\\s*[:=|/-]\\s*${number}`).exec(tail);
  const match = after ?? direct;
  if (!match) return undefined;
  const remainder = tail.slice(match.index + match[0].length).trim();
  if (remainder && !/^(?:[.!;,]|[—–-]|\||\))/.test(remainder)) return undefined;
  const parsed = Number.parseFloat(match[1]!);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function hasPassingStatus(text: string, pattern: RegExp): boolean {
  const matches = [...text.matchAll(new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
  ))];
  if (matches.length !== 1) return false;
  const value = matches[0]?.[1]?.trim();
  return value !== undefined && (
    LEADING_PASS_STATUS.test(value) || TRAILING_PASS_STATUS.test(value)
  );
}

function fieldValues(text: string, pattern: RegExp): string[] {
  return [...text.matchAll(new RegExp(
    pattern.source,
    pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`,
  ))].map((match) => match[1]!.trim());
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

export function auditReport(rawText: string, options: Options): string[] {
  const text = normalize(maskNonEvidenceMarkdown(rawText));
  const missing = missingEvidence(text, [...BASE_REQUIRED, ...TECHNICAL_REQUIRED]);
  if (!options.noDesign) missing.push(...missingEvidence(text, DESIGN_REQUIRED));
  if (options.physics) missing.push(...missingEvidence(text, PHYSICS_REQUIRED));
  if (options.audio) missing.push(...missingEvidence(text, AUDIO_REQUIRED));
  if (options.difficulty) missing.push(...missingEvidence(text, DIFFICULTY_REQUIRED));

  const semanticFailures = [...RESULT_FIELDS]
    .filter(([, pattern]) => !hasPassingStatus(text, pattern))
    .map(([label]) => label);

  const contentSourceValues = fieldValues(text, CONTENT_SOURCE_PATTERN);
  if (contentSourceValues.length !== 1) {
    semanticFailures.push(
      `local content sources must appear exactly once: found ${contentSourceValues.length}`,
    );
  } else {
    const sourceValues = new Set(
      contentSourceValues[0]!
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

  const desktopMobileValues = fieldValues(text, DESKTOP_MOBILE_PATTERN);
  if (desktopMobileValues.length !== 1) {
    semanticFailures.push(
      `desktop/mobile must appear exactly once: found ${desktopMobileValues.length}`,
    );
  } else {
    const value = desktopMobileValues[0]!;
    if (/^not applicable\b/i.test(value)) {
      const waiver = /^not applicable\s*(?:—|–|-)\s*desktop-only\s+(.+)$/i.exec(value);
      if (!waiver || /^(?:reason|explanation|tbd|todo)[.!]?$/i.test(waiver[1]!.trim())) {
        semanticFailures.push(
          "desktop/mobile waiver must be 'not applicable — desktop-only <specific reason>'",
        );
      }
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
  const tierValues = fieldValues(text, CLAIM_TIER_PATTERN);
  const reportedTier = tierValues.length === 1 ? tierValues[0] : undefined;

  if (tierValues.length !== 1) {
    semanticFailures.push(
      `claim tier must appear exactly once: found ${tierValues.length}`,
    );
  } else if (!ALLOWED_CLAIM_TIERS.has(reportedTier!)) {
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

  if (visualClaim) missing.push(...missingEvidence(text, POLISHED_REQUIRED));
  if (scoredClaim) {
    missing.push(...missingEvidence(text, PREMIUM_REQUIRED));
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

  const automaticFailureValues = fieldValues(text, AUTOMATIC_FAILURES_PATTERN);
  if (visualClaim && automaticFailureValues.length !== 1) {
    scoreFailures.push(
      `automatic failures remaining must appear exactly once: found ${automaticFailureValues.length}`,
    );
  } else if (!visualClaim && automaticFailureValues.length > 1) {
    scoreFailures.push(
      `automatic failures remaining must not be duplicated: found ${automaticFailureValues.length}`,
    );
  }
  if (
    visualClaim &&
    automaticFailureValues.length === 1 &&
    !/^(?:none|0)\s*[.!]?$/.test(automaticFailureValues[0]!)
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

const invokedAsMain = Boolean(
  process.argv[1] &&
  existsSync(resolve(process.argv[1])) &&
  realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url)),
);
if (invokedAsMain) {
  process.exitCode = main();
}

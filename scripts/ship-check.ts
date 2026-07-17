#!/usr/bin/env node
/**
 * Unified release/verification pipeline for a Three.js game project.
 */

import { existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export type ShipCheckOptions = {
  project: string;
  url: string;
  skipCanvas: boolean;
  polished: boolean;
  premium: boolean;
  showcase: boolean;
  runStep?: (command: string, args: string[], cwd?: string) => number;
};

export function parseShipCheckArgs(argv: string[]): ShipCheckOptions | "help" {
  const options: ShipCheckOptions = {
    project: ".",
    url: "http://127.0.0.1:5188",
    skipCanvas: false,
    polished: false,
    premium: false,
    showcase: false,
  };
  const positionals: string[] = [];

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "-h" || argument === "--help") return "help";
    if (argument === "--skip-canvas") {
      options.skipCanvas = true;
      continue;
    }
    if (argument === "--polished") {
      options.polished = true;
      continue;
    }
    if (argument === "--premium") {
      options.premium = true;
      continue;
    }
    if (argument === "--showcase") {
      options.showcase = true;
      continue;
    }
    if (argument === "--url") {
      const value = argv[++index];
      if (!value) throw new Error("--url requires a value");
      options.url = value;
      continue;
    }
    if (argument.startsWith("--url=")) {
      options.url = argument.slice("--url=".length);
      continue;
    }
    if (argument.startsWith("-")) {
      throw new Error(`unrecognized arguments: ${argument}`);
    }
    positionals.push(argument);
  }

  if (positionals.length > 1) {
    throw new Error(`unrecognized arguments: ${positionals.slice(1).join(" ")}`);
  }
  if (positionals[0]) options.project = positionals[0];
  return options;
}

function defaultRunStep(command: string, args: string[], cwd?: string): number {
  const result = spawnSync(command, args, {
    cwd,
    encoding: "utf8",
    stdio: "inherit",
  });
  return result.status ?? 1;
}

export function plannedShipCheckSteps(options: ShipCheckOptions): string[] {
  const steps = [
    "probe-three-revision",
    "audit-project-three-apis",
    "audit-local-only",
    "npm run build",
  ];
  if (options.skipCanvas) steps.push("inspect-threejs-canvas (skipped)");
  else steps.push("inspect-threejs-canvas");
  const report = resolve(options.project, "docs/game-report.md");
  if (existsSync(report) || options.polished || options.premium || options.showcase) {
    steps.push("audit-game-report");
  }
  return steps;
}

export function runShipCheck(
  options: ShipCheckOptions,
  runStep: NonNullable<ShipCheckOptions["runStep"]> = defaultRunStep,
): number {
  const project = resolve(options.project);
  if (!existsSync(project)) {
    console.error(`ship-check: project not found: ${project}`);
    return 2;
  }

  const tsx = ["--import", "tsx"];
  const steps: Array<{ name: string; run: () => number }> = [
    {
      name: "probe-three-revision",
      run: () =>
        runStep(process.execPath, [
          ...tsx,
          resolve(SKILL_DIR, "scripts/probe-three-revision.ts"),
          "--no-npm",
          project,
        ]),
    },
    {
      name: "audit-project-three-apis",
      run: () =>
        runStep(process.execPath, [
          ...tsx,
          resolve(SKILL_DIR, "scripts/audit-project-three-apis.ts"),
          project,
        ]),
    },
    {
      name: "audit-local-only",
      run: () =>
        runStep(process.execPath, [
          ...tsx,
          resolve(SKILL_DIR, "scripts/audit-local-only.ts"),
          project,
        ]),
    },
    {
      name: "npm run build",
      run: () => runStep("npm", ["run", "build"], project),
    },
  ];

  if (options.skipCanvas) {
    console.log(
      "ship-check: skipping canvas inspect (--skip-canvas). Start preview then re-run without the flag:",
    );
    console.log(`  cd ${project} && npm run preview`);
    console.log(
      `  npm --prefix ${SKILL_DIR} run inspect:canvas -- --url ${options.url}`,
    );
  } else {
    steps.push({
      name: "inspect-threejs-canvas",
      run: () =>
        runStep(process.execPath, [
          ...tsx,
          resolve(SKILL_DIR, "scripts/inspect-threejs-canvas.ts"),
          "--url",
          options.url,
        ]),
    });
  }

  const reportPath = resolve(project, "docs/game-report.md");
  if (existsSync(reportPath)) {
    const reportArgs = [
      ...tsx,
      resolve(SKILL_DIR, "scripts/audit-game-report.ts"),
      reportPath,
    ];
    if (options.showcase) reportArgs.push("--showcase");
    else if (options.premium) reportArgs.push("--premium");
    else if (options.polished) reportArgs.push("--polished");
    steps.push({
      name: "audit-game-report",
      run: () => runStep(process.execPath, reportArgs),
    });
  }

  console.log(`ship-check: project=${project}`);
  for (const step of steps) {
    console.log(`ship-check: ▶ ${step.name}`);
    const code = step.run();
    if (code !== 0) {
      console.error(`ship-check: ✖ ${step.name} failed with exit ${code}`);
      return code;
    }
    console.log(`ship-check: ✓ ${step.name}`);
  }
  console.log("ship-check: all steps passed");
  return 0;
}

const HELP = `usage: ship-check.ts <project> [--url URL] [--skip-canvas] [--polished|--premium|--showcase]

Run probe → API audit → local-only audit → build → canvas inspect → report audit.`;

export function main(argv = process.argv.slice(2)): number {
  try {
    const parsed = parseShipCheckArgs(argv);
    if (parsed === "help") {
      console.log(HELP);
      return 0;
    }
    return runShipCheck(parsed);
  } catch (error) {
    console.error(
      `ship-check.ts: error: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 2;
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  process.exitCode = main();
}

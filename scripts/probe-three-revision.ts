#!/usr/bin/env node
/**
 * Probe installed Three.js revision against the r185 floor and npm latest.
 * Fails only when installed revision is below 185. Warns when newer than the
 * skill last-verify note (informational, not a pin).
 */

import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Informational last-check note for maintainers — not an equality pin. */
export const SKILL_LAST_VERIFIED_REVISION = 185;
export const MIN_SUPPORTED_REVISION = 185;

export interface ProbeResult {
  projectRoot: string;
  installedPackage: string | null;
  installedRevision: number | null;
  npmLatest: string | null;
  belowFloor: boolean;
  newerThanLastVerify: boolean;
  messages: string[];
}

function packageJsonVersion(projectRoot: string): string | null {
  const path = join(projectRoot, "package.json");
  if (!existsSync(path)) return null;
  try {
    const data = JSON.parse(readFileSync(path, "utf8")) as {
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
    };
    return data.dependencies?.three ?? data.devDependencies?.three ?? null;
  } catch {
    return null;
  }
}

function resolveInstalledRevision(projectRoot: string): {
  packageVersion: string | null;
  revision: number | null;
} {
  const nestedPackage = join(projectRoot, "node_modules", "three", "package.json");
  if (existsSync(nestedPackage)) {
    try {
      const pkg = JSON.parse(readFileSync(nestedPackage, "utf8")) as { version?: string };
      const version = pkg.version ?? null;
      let revision: number | null = null;
      try {
        const require = createRequire(nestedPackage);
        const mod = require("three") as { REVISION?: string };
        const parsed = Number.parseInt(String(mod.REVISION ?? ""), 10);
        if (Number.isFinite(parsed)) revision = parsed;
      } catch {
        // ESM-only loads can fail under require; fall back to package minor.
      }
      if (revision === null && version) {
        const minor = Number.parseInt(version.split(".")[1] ?? "", 10);
        revision = Number.isFinite(minor) ? minor : null;
      }
      return { packageVersion: version, revision };
    } catch {
      // Continue to declared-range fallback.
    }
  }

  const declared = packageJsonVersion(projectRoot);
  if (!declared) return { packageVersion: null, revision: null };
  const match = /0\.(\d+)\./.exec(declared);
  return {
    packageVersion: declared,
    revision: match ? Number.parseInt(match[1]!, 10) : null,
  };
}

function npmViewThreeVersion(cwd: string): string | null {
  const result = spawnSync("npm", ["view", "three", "version"], {
    cwd,
    encoding: "utf8",
    timeout: 20_000,
  });
  if (result.status !== 0) return null;
  const version = (result.stdout ?? "").trim().split(/\s+/).pop();
  return version || null;
}

export function probeThreeRevision(
  projectRootInput: string,
  options: { checkNpmLatest?: boolean } = {},
): ProbeResult {
  const projectRoot = resolve(projectRootInput);
  const installed = resolveInstalledRevision(projectRoot);
  const npmLatest =
    options.checkNpmLatest === false ? null : npmViewThreeVersion(projectRoot);
  const messages: string[] = [];
  const belowFloor =
    installed.revision !== null && installed.revision < MIN_SUPPORTED_REVISION;
  const newerThanLastVerify =
    installed.revision !== null &&
    installed.revision > SKILL_LAST_VERIFIED_REVISION;

  if (installed.packageVersion === null && installed.revision === null) {
    messages.push("three is not installed or resolvable in this project");
  } else {
    messages.push(
      `installed package=${installed.packageVersion ?? "unknown"} revision=${
        installed.revision ?? "unknown"
      }`,
    );
  }
  if (npmLatest) messages.push(`npm latest three@${npmLatest}`);
  else if (options.checkNpmLatest !== false) {
    messages.push("npm latest: unavailable (offline or npm view failed)");
  }
  if (belowFloor) {
    messages.push(
      `FAIL: installed revision ${installed.revision} is below minimum r${MIN_SUPPORTED_REVISION}`,
    );
  }
  if (newerThanLastVerify) {
    messages.push(
      `WARN: installed revision ${installed.revision} is newer than skill last-verify note r${SKILL_LAST_VERIFIED_REVISION}; re-check migration guide before copying recipes`,
    );
  }

  return {
    projectRoot,
    installedPackage: installed.packageVersion,
    installedRevision: installed.revision,
    npmLatest,
    belowFloor,
    newerThanLastVerify,
    messages,
  };
}

const HELP = `usage: probe-three-revision.ts [-h] [--no-npm] [project]

Report installed Three.js revision vs r185 floor and npm latest.

positional arguments:
  project     Game project root (default: .)

options:
  --no-npm    Skip npm view three version
  -h, --help  show this help message and exit`;

function parseArgs(argv: string[]): { project: string; checkNpmLatest: boolean } {
  let checkNpmLatest = true;
  const positionals: string[] = [];
  for (const argument of argv) {
    if (argument === "-h" || argument === "--help") {
      console.log(HELP);
      process.exit(0);
    } else if (argument === "--no-npm") checkNpmLatest = false;
    else if (argument.startsWith("-")) {
      console.error(`probe-three-revision.ts: error: unrecognized arguments: ${argument}`);
      process.exit(2);
    } else positionals.push(argument);
  }
  if (positionals.length > 1) {
    console.error(
      `probe-three-revision.ts: error: unrecognized arguments: ${positionals.slice(1).join(" ")}`,
    );
    process.exit(2);
  }
  return { project: positionals[0] ?? ".", checkNpmLatest };
}

export function main(argv = process.argv.slice(2)): number {
  const args = parseArgs(argv);
  const result = probeThreeRevision(args.project, {
    checkNpmLatest: args.checkNpmLatest,
  });
  for (const message of result.messages) console.log(message);
  if (result.installedPackage === null && result.installedRevision === null) return 2;
  if (result.belowFloor) return 1;
  return 0;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  process.exitCode = main();
}

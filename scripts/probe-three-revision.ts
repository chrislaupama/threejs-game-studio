#!/usr/bin/env node
/**
 * Probe installed Three.js revision against the r185 floor and npm latest.
 * Fails only when installed revision is below 185. Warns when newer than the
 * skill last-verify note (informational, not a pin).
 */

import { existsSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, parse, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

/** Informational last-check note for maintainers — not an equality pin. */
export const SKILL_LAST_VERIFIED_REVISION = 185;
export const MIN_SUPPORTED_REVISION = 185;

export interface ProbeResult {
  projectRoot: string;
  declaredPackage: string | null;
  declaredMinimumRevision: number | null;
  declarationBelowFloor: boolean;
  declarationUnknown: boolean;
  installedPackage: string | null;
  installedRevision: number | null;
  installedPrerelease: boolean;
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

function exactVersionMetadata(version: string): {
  revision: number;
  prerelease: boolean;
} | null {
  const match = /^0\.(\d+)\.\d+(-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/.exec(
    version.trim(),
  );
  return match
    ? { revision: Number.parseInt(match[1]!, 10), prerelease: match[2] !== undefined }
    : null;
}

/**
 * Return a conservative lower revision bound for ordinary npm semver ranges.
 * Tags, aliases, and workspace protocols remain unknown. An upper-bound-only
 * branch admits pre-r185 releases, so its lower bound is revision zero.
 */
export function declaredMinimumRevision(specifier: string | null): number | null {
  if (!specifier) return null;
  type Version = readonly [number, number, number];
  type Bound = { version: Version; inclusive: boolean };
  const compare = (left: Version, right: Version): number => {
    for (let index = 0; index < 3; index += 1) {
      const difference = left[index]! - right[index]!;
      if (difference !== 0) return difference;
    }
    return 0;
  };
  const strongerLower = (current: Bound | null, candidate: Bound): Bound => {
    if (!current) return candidate;
    const relation = compare(candidate.version, current.version);
    if (relation > 0 || (relation === 0 && !candidate.inclusive && current.inclusive)) {
      return candidate;
    }
    return current;
  };
  const strongerUpper = (current: Bound | null, candidate: Bound): Bound => {
    if (!current) return candidate;
    const relation = compare(candidate.version, current.version);
    if (relation < 0 || (relation === 0 && !candidate.inclusive && current.inclusive)) {
      return candidate;
    }
    return current;
  };

  const branchFloors: number[] = [];
  for (const rawBranch of specifier.split("||")) {
    const branch = rawBranch.trim();
    if (!branch || /^(?:\*|x|latest|next)$/i.test(branch)) return null;
    if (/^(?:workspace|file|link|git|https?|npm):/i.test(branch)) return null;

    let lower: Bound | null = null;
    let upper: Bound | null = null;
    const tokens = [...branch.matchAll(
      /(?:^|\s)(\^|~|>=|<=|>|<|=)?\s*v?0\.(\d+)(?:\.(\d+|[x*]))?(?=\s|$)/gi,
    )];
    if (tokens.length === 0) return null;

    let cursor = 0;
    const hyphenGaps: number[] = [];
    for (let index = 0; index < tokens.length; index += 1) {
      const token = tokens[index]!;
      const gap = branch.slice(cursor, token.index).trim();
      if (gap) {
        if (gap !== "-") return null;
        hyphenGaps.push(index);
      }
      cursor = token.index + token[0].length;
    }
    if (branch.slice(cursor).trim()) return null;

    if (hyphenGaps.length > 0) {
      if (
        hyphenGaps.length !== 1 ||
        hyphenGaps[0] !== 1 ||
        tokens.length !== 2 ||
        tokens.some((token) => token[1] !== undefined)
      ) return null;
      const startPatch = tokens[0]![3];
      const endPatch = tokens[1]![3];
      if (
        startPatch === undefined ||
        endPatch === undefined ||
        /[x*]/i.test(startPatch) ||
        /[x*]/i.test(endPatch)
      ) return null;
      const start: Version = [
        0,
        Number.parseInt(tokens[0]![2]!, 10),
        Number.parseInt(startPatch, 10),
      ];
      const end: Version = [
        0,
        Number.parseInt(tokens[1]![2]!, 10),
        Number.parseInt(endPatch, 10),
      ];
      if (compare(start, end) > 0) return null;
      branchFloors.push(start[1]);
      continue;
    }

    for (const token of tokens) {
      const operator = token[1] ?? "";
      const revision = Number.parseInt(token[2]!, 10);
      const patchValue = token[3];
      if (!Number.isFinite(revision)) return null;
      const complete = patchValue !== undefined && !/[x*]/i.test(patchValue);
      const version: Version = [
        0,
        revision,
        complete ? Number.parseInt(patchValue!, 10) : 0,
      ];
      const followingMinor: Version = [0, revision + 1, 0];
      if (operator === "<") {
        upper = strongerUpper(upper, { version, inclusive: false });
      } else if (operator === "<=") {
        upper = strongerUpper(
          upper,
          complete
            ? { version, inclusive: true }
            : { version: followingMinor, inclusive: false },
        );
      } else if (operator === ">") {
        lower = strongerLower(
          lower,
          complete
            ? { version, inclusive: false }
            : { version: followingMinor, inclusive: true },
        );
      } else if (operator === ">=") {
        lower = strongerLower(lower, { version, inclusive: true });
      } else if (operator === "^" || operator === "~" || !complete) {
        lower = strongerLower(lower, { version, inclusive: true });
        upper = strongerUpper(upper, { version: followingMinor, inclusive: false });
      } else {
        lower = strongerLower(lower, { version, inclusive: true });
        upper = strongerUpper(upper, { version, inclusive: true });
      }
    }
    if (upper && lower) {
      const relation = compare(lower.version, upper.version);
      if (relation > 0 || (relation === 0 && (!lower.inclusive || !upper.inclusive))) {
        return null;
      }
    }
    branchFloors.push(lower?.version[1] ?? 0);
  }
  return branchFloors.length > 0 ? Math.min(...branchFloors) : null;
}

function findThreePackageJson(entryPath: string): string | null {
  let directory = dirname(entryPath);
  const root = parse(directory).root;
  while (directory !== root) {
    const candidate = join(directory, "package.json");
    if (existsSync(candidate)) {
      try {
        const data = JSON.parse(readFileSync(candidate, "utf8")) as { name?: unknown };
        if (data.name === "three") return candidate;
      } catch {
        // Keep walking. A malformed unrelated parent manifest is not Three.js.
      }
    }
    directory = dirname(directory);
  }
  return null;
}

function resolveInstalledRevision(projectRoot: string): {
  packageVersion: string | null;
  revision: number | null;
  prerelease: boolean;
} {
  // Resolve the entry point only. Never import/require code from the project
  // being audited: an audit must not execute a compromised dependency.
  let packagePath: string | null = null;
  try {
    const requireFromProject = createRequire(join(projectRoot, "package.json"));
    packagePath = findThreePackageJson(requireFromProject.resolve("three"));
  } catch {
    const nested = join(projectRoot, "node_modules", "three", "package.json");
    if (existsSync(nested)) packagePath = nested;
  }
  if (!packagePath) return { packageVersion: null, revision: null, prerelease: false };

  try {
    const pkg = JSON.parse(readFileSync(packagePath, "utf8")) as { version?: unknown };
    const version = typeof pkg.version === "string" ? pkg.version : null;
    const metadata = version === null ? null : exactVersionMetadata(version);
    return {
      packageVersion: version,
      revision: metadata?.revision ?? null,
      prerelease: metadata?.prerelease ?? false,
    };
  } catch {
    return { packageVersion: null, revision: null, prerelease: false };
  }
}

function npmViewThreeVersion(cwd: string): string | null {
  const npmExecPath = process.env.npm_execpath;
  const command = npmExecPath ? process.execPath : process.platform === "win32" ? "npm.cmd" : "npm";
  const prefix = npmExecPath ? [npmExecPath] : [];
  const result = spawnSync(command, [...prefix, "view", "three", "version", "--json"], {
    cwd,
    encoding: "utf8",
    timeout: 20_000,
  });
  if (result.status !== 0) return null;
  const output = (result.stdout ?? "").trim();
  try {
    const parsed: unknown = JSON.parse(output);
    return typeof parsed === "string" ? parsed : null;
  } catch {
    return output.split(/\s+/).pop() || null;
  }
}

export function probeThreeRevision(
  projectRootInput: string,
  options: { checkNpmLatest?: boolean } = {},
): ProbeResult {
  const projectRoot = resolve(projectRootInput);
  const declaredPackage = packageJsonVersion(projectRoot);
  const declaredFloor = declaredMinimumRevision(declaredPackage);
  const installed = resolveInstalledRevision(projectRoot);
  const npmLatest =
    options.checkNpmLatest === false ? null : npmViewThreeVersion(projectRoot);
  const messages: string[] = [];
  const belowFloor =
    installed.revision !== null &&
    (
      installed.revision < MIN_SUPPORTED_REVISION ||
      (installed.revision === MIN_SUPPORTED_REVISION && installed.prerelease)
    );
  const newerThanLastVerify =
    installed.revision !== null &&
    installed.revision > SKILL_LAST_VERIFIED_REVISION;
  const declarationBelowFloor =
    declaredFloor !== null && declaredFloor < MIN_SUPPORTED_REVISION;
  const declarationUnknown = declaredPackage !== null && declaredFloor === null;

  if (declaredPackage !== null) {
    messages.push(
      `declared package=${declaredPackage} minimum revision=${declaredFloor ?? "unknown"}`,
    );
  }
  if (installed.packageVersion === null || installed.revision === null) {
    messages.push("three is not installed with a parseable exact version in this project");
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
    messages.push(installed.prerelease && installed.revision === MIN_SUPPORTED_REVISION
      ? `FAIL: installed ${installed.packageVersion} is a prerelease below the stable r${MIN_SUPPORTED_REVISION} floor`
      : `FAIL: installed revision ${installed.revision} is below minimum r${MIN_SUPPORTED_REVISION}`,
    );
  }
  if (declarationBelowFloor) {
    messages.push(
      `FAIL: declared range admits revision r${declaredFloor}, below minimum r${MIN_SUPPORTED_REVISION}`,
    );
  }
  if (declarationUnknown) {
    messages.push(
      `FAIL: declared range ${declaredPackage} has no safely parseable minimum revision`,
    );
  }
  if (newerThanLastVerify) {
    messages.push(
      `WARN: installed revision ${installed.revision} is newer than skill last-verify note r${SKILL_LAST_VERIFIED_REVISION}; re-check migration guide before copying recipes`,
    );
  }

  return {
    projectRoot,
    declaredPackage,
    declaredMinimumRevision: declaredFloor,
    declarationBelowFloor,
    declarationUnknown,
    installedPackage: installed.packageVersion,
    installedRevision: installed.revision,
    installedPrerelease: installed.prerelease,
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
  const invocationDirectory = process.env.INIT_CWD ?? process.cwd();
  const result = probeThreeRevision(resolve(invocationDirectory, args.project), {
    checkNpmLatest: args.checkNpmLatest,
  });
  for (const message of result.messages) console.log(message);
  if (result.installedPackage === null || result.installedRevision === null) return 2;
  if (result.belowFloor || result.declarationBelowFloor || result.declarationUnknown) return 1;
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

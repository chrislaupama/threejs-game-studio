#!/usr/bin/env node
/** Create a Three.js Vite game from the packaged skill scaffold. */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXCLUDE_DIRS = new Set([
  'node_modules',
  'dist',
  '.e2e-dist',
  '.vite',
  'artifacts',
  'test-results',
  'playwright-report',
  'coverage',
  '__pycache__',
]);
const EXCLUDE_FILES = new Set(['.DS_Store']);

export const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SCAFFOLD_DIR = resolve(SKILL_DIR, 'assets/threejs-vite-game');
const CONTENT_PROVENANCE_TEMPLATE = resolve(
  SKILL_DIR,
  'assets/content-provenance.template.md',
);
const GAME_REPORT_TEMPLATE = resolve(SKILL_DIR, 'assets/game-report.template.md');

export function resolveInvocationPath(
  value: string,
  invocationDirectory = process.env.INIT_CWD ?? process.cwd(),
): string {
  return resolve(invocationDirectory, value);
}

export function normalizedProjectName(target: string): string {
  const name = basename(resolve(target))
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^[._-]+|[._-]+$/g, '')
    .slice(0, 214);
  return name || 'threejs-vite-game';
}

export const GENERATED_SCRIPT_COMMANDS: Readonly<Record<string, string>> = {
  'audit:local': 'node --import tsx scripts/audit-local-only.ts',
  'inspect:canvas': 'node --import tsx scripts/inspect-threejs-canvas.ts',
  'probe:three': 'node --import tsx scripts/probe-three-revision.ts',
  'audit:apis': 'node --import tsx scripts/audit-project-three-apis.ts',
  'audit:assets': 'node --import tsx scripts/audit-gltf-assets.ts',
  'audit:report': 'node --import tsx scripts/audit-game-report.ts',
  'ship-check': 'node --import tsx scripts/ship-check.ts',
};

export const GENERATED_SCRIPTS = [
  'audit-local-only.ts',
  'inspect-threejs-canvas.ts',
  'probe-three-revision.ts',
  'audit-project-three-apis.ts',
  'audit-gltf-assets.ts',
  'audit-game-report.ts',
  'ship-check.ts',
] as const;

function rewriteProjectPackage(path: string, name: string): void {
  if (!existsSync(path)) return;
  const data = JSON.parse(readFileSync(path, 'utf8')) as {
    name?: string;
    scripts?: Record<string, string>;
  };
  data.name = name;
  data.scripts = { ...data.scripts, ...GENERATED_SCRIPT_COMMANDS };
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function rewriteLockfileName(path: string, name: string): void {
  if (!existsSync(path)) return;
  const data = JSON.parse(readFileSync(path, 'utf8')) as {
    name?: string;
    packages?: Record<string, { name?: string }>;
  };
  data.name = name;
  if (data.packages?.['']) data.packages[''].name = name;
  writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

function copyAllowed(source: string): boolean {
  const name = basename(source);
  return !EXCLUDE_DIRS.has(name) && !EXCLUDE_FILES.has(name);
}

export const GENRES = ["arena", "runner", "shooter", "platformer"] as const;
export type GameGenre = (typeof GENRES)[number];

export const OVERLAY_DIR = resolve(SKILL_DIR, "assets/genre-overlays");

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Validate every directly-required source before creating or copying into the
 * target. A broken skill package therefore fails atomically instead of leaving
 * behind a project that looks complete but is missing release tooling.
 */
function assertGeneratorSources(genre: GameGenre): void {
  const problems: string[] = [];
  const requiredDirectories = [SCAFFOLD_DIR];
  if (genre !== "arena") requiredDirectories.push(resolve(OVERLAY_DIR, genre));
  for (const path of requiredDirectories) {
    if (!isDirectory(path)) problems.push(`required directory is missing: ${path}`);
  }

  const requiredFiles = [
    resolve(SCAFFOLD_DIR, 'package.json'),
    resolve(SCAFFOLD_DIR, 'package-lock.json'),
    CONTENT_PROVENANCE_TEMPLATE,
    GAME_REPORT_TEMPLATE,
    ...GENERATED_SCRIPTS.map((script) => resolve(SKILL_DIR, 'scripts', script)),
  ];
  for (const path of requiredFiles) {
    if (!isFile(path)) problems.push(`required file is missing: ${path}`);
  }

  if (problems.length > 0) {
    throw new Error(`Cannot create game; generator preflight failed:\n- ${problems.join('\n- ')}`);
  }
}

function applyGenreOverlay(target: string, genre: GameGenre): void {
  if (genre === "arena") return;
  const overlayRoot = resolve(OVERLAY_DIR, genre);
  if (!existsSync(overlayRoot) || !statSync(overlayRoot).isDirectory()) {
    throw new Error(`Genre overlay not found: ${overlayRoot}`);
  }
  cpSync(overlayRoot, target, { recursive: true });
}

export function createGame(
  targetInput: string,
  options: { name?: string; genre?: GameGenre } = {},
): string {
  const genre = options.genre ?? "arena";
  if (!GENRES.includes(genre)) {
    throw new Error(`Unsupported genre: ${genre}. Expected one of ${GENRES.join(", ")}`);
  }

  const target = resolve(targetInput);
  if (existsSync(target) && readdirSync(target).length > 0) {
    throw new Error(
      `Target is not empty: ${target}\n` +
        "Choose an empty directory so existing project files are never overlaid.",
    );
  }

  // This must remain before mkdirSync/cpSync: failure must not leave a partial
  // generated project at an otherwise absent or empty target.
  assertGeneratorSources(genre);

  mkdirSync(target, { recursive: true });
  cpSync(SCAFFOLD_DIR, target, {
    recursive: true,
    filter: copyAllowed,
  });

  const targetScripts = resolve(target, "scripts");
  mkdirSync(targetScripts, { recursive: true });
  for (const script of GENERATED_SCRIPTS) {
    const source = resolve(SKILL_DIR, 'scripts', script);
    cpSync(source, resolve(targetScripts, script));
  }

  const docs = resolve(target, "docs");
  mkdirSync(docs, { recursive: true });
  cpSync(
    CONTENT_PROVENANCE_TEMPLATE,
    resolve(docs, "content-provenance.md"),
  );
  cpSync(
    GAME_REPORT_TEMPLATE,
    resolve(docs, "game-report.md"),
  );

  applyGenreOverlay(target, genre);

  const projectName = options.name
    ? normalizedProjectName(options.name)
    : normalizedProjectName(target);
  rewriteProjectPackage(resolve(target, "package.json"), projectName);
  rewriteLockfileName(resolve(target, "package-lock.json"), projectName);
  return target;
}

function printPostCreateChecklist(target: string, genre: GameGenre): void {
  console.log(`Created Three.js game scaffold at ${target} (genre=${genre})`);
  console.log("");
  console.log("Post-create checklist:");
  console.log(`  1. cd ${target}`);
  console.log("  2. npm ci               # installs the verified lockfile baseline");
  console.log("  3. npm run setup:browsers");
  console.log("  4. npm run probe:three    # bounded npm-latest check; reports offline explicitly");
  console.log("  5. npm run dev");
  console.log("");
  console.log(
    "Authority: installed THREE.REVISION → official docs/migration → skill recipes.",
  );
  console.log(
    "The scaffold is verified at r185; upgrading to current stable requires its migration notes, build/tests, and browser baselines.",
  );
}

export function main(argv = process.argv.slice(2)): number {
  let name: string | undefined;
  let genre: GameGenre = "arena";
  const positionals: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index]!;
    if (argument === "-h" || argument === "--help") {
      console.log(
        "Usage: npm run create:game -- <target-directory> [--name <package-name>] [--genre arena|runner|shooter|platformer]\n" +
          "  Creates a Vite + TypeScript Three.js scaffold from the verified r185 lockfile baseline.\n" +
          "  Query current stable separately, then upgrade intentionally with matching migration review.",
      );
      return 0;
    }
    if (argument === "--name") {
      name = argv[++index];
      if (!name) {
        console.error("create-threejs-game.ts: error: --name requires a value");
        return 2;
      }
      continue;
    }
    if (argument.startsWith("--name=")) {
      name = argument.slice("--name=".length);
      continue;
    }
    if (argument === "--genre") {
      const value = argv[++index];
      if (!value || !(GENRES as readonly string[]).includes(value)) {
        console.error(
          `create-threejs-game.ts: error: --genre requires one of ${GENRES.join(", ")}`,
        );
        return 2;
      }
      genre = value as GameGenre;
      continue;
    }
    if (argument.startsWith("--genre=")) {
      const value = argument.slice("--genre=".length);
      if (!(GENRES as readonly string[]).includes(value)) {
        console.error(
          `create-threejs-game.ts: error: --genre requires one of ${GENRES.join(", ")}`,
        );
        return 2;
      }
      genre = value as GameGenre;
      continue;
    }
    if (argument.startsWith("-")) {
      console.error(`create-threejs-game.ts: error: unrecognized arguments: ${argument}`);
      return 2;
    }
    positionals.push(argument);
  }

  if (positionals.length !== 1) {
    console.error(
      "Usage: npm run create:game -- <target-directory> [--name <package-name>] [--genre arena|runner|shooter|platformer]",
    );
    return 2;
  }

  const target = createGame(resolveInvocationPath(positionals[0]!), { name, genre });
  printPostCreateChecklist(target, genre);
  return 0;
}

const invokedAsMain = (() => {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(resolve(process.argv[1])) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
})();
if (invokedAsMain) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

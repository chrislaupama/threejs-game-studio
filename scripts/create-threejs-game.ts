#!/usr/bin/env node
/** Create a Three.js Vite game from the packaged skill scaffold. */

import {
  cpSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXCLUDE_DIRS = new Set([
  'node_modules',
  'dist',
  'artifacts',
  'test-results',
  'playwright-report',
  'coverage',
  '__pycache__',
]);
const EXCLUDE_FILES = new Set(['.DS_Store']);

export const SKILL_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SCAFFOLD_DIR = resolve(SKILL_DIR, 'assets/threejs-vite-game');

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
    .replace(/^-+|-+$/g, '');
  return name || 'threejs-vite-game';
}

function rewriteJsonName(path: string, name: string): void {
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
  if (!existsSync(SCAFFOLD_DIR) || !statSync(SCAFFOLD_DIR).isDirectory()) {
    throw new Error(`Scaffold not found: ${SCAFFOLD_DIR}`);
  }

  if (existsSync(target) && readdirSync(target).length > 0) {
    throw new Error(
      `Target is not empty: ${target}\n` +
        "Choose an empty directory so existing project files are never overlaid.",
    );
  }

  mkdirSync(target, { recursive: true });
  cpSync(SCAFFOLD_DIR, target, {
    recursive: true,
    filter: copyAllowed,
  });

  const targetScripts = resolve(target, "scripts");
  mkdirSync(targetScripts, { recursive: true });
  cpSync(
    resolve(SKILL_DIR, "scripts/audit-local-only.ts"),
    resolve(targetScripts, "audit-local-only.ts"),
  );
  cpSync(
    resolve(SKILL_DIR, "scripts/inspect-threejs-canvas.ts"),
    resolve(targetScripts, "inspect-threejs-canvas.ts"),
  );

  const docs = resolve(target, "docs");
  mkdirSync(docs, { recursive: true });
  cpSync(
    resolve(SKILL_DIR, "assets/content-provenance.template.md"),
    resolve(docs, "content-provenance.md"),
  );
  cpSync(
    resolve(SKILL_DIR, "assets/game-report.template.md"),
    resolve(docs, "game-report.md"),
  );

  applyGenreOverlay(target, genre);

  const projectName = options.name
    ? normalizedProjectName(options.name)
    : normalizedProjectName(target);
  rewriteJsonName(resolve(target, "package.json"), projectName);
  rewriteJsonName(resolve(target, "package-lock.json"), projectName);
  return target;
}

function printPostCreateChecklist(target: string, genre: GameGenre): void {
  console.log(`Created Three.js game scaffold at ${target} (genre=${genre})`);
  console.log("");
  console.log("Post-create checklist:");
  console.log(`  1. cd ${target}`);
  console.log("  2. npm install          # installs current three (r185+ range)");
  console.log("  3. npm run setup:browsers");
  console.log("  4. npm run probe:three  # optional; or from skill: npm run probe:three -- <game>");
  console.log("  5. npm run dev");
  console.log("");
  console.log(
    "Authority: installed THREE.REVISION → official docs/migration → skill recipes.",
  );
  console.log("Prefer current npm latest for greenfield; minimum floor is r185.");
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
          "  Creates a Vite + TypeScript Three.js (r185+) scaffold.\n" +
          "  After create, run npm install so three resolves to current compatible latest.",
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

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  try {
    process.exitCode = main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}

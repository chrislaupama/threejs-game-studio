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

export function createGame(targetInput: string): string {
  const target = resolve(targetInput);
  if (!existsSync(SCAFFOLD_DIR) || !statSync(SCAFFOLD_DIR).isDirectory()) {
    throw new Error(`Scaffold not found: ${SCAFFOLD_DIR}`);
  }

  if (existsSync(target) && readdirSync(target).length > 0) {
    throw new Error(
      `Target is not empty: ${target}\n` +
        'Choose an empty directory so existing project files are never overlaid.',
    );
  }

  mkdirSync(target, { recursive: true });
  cpSync(SCAFFOLD_DIR, target, {
    recursive: true,
    filter: copyAllowed,
  });

  const targetScripts = resolve(target, 'scripts');
  mkdirSync(targetScripts, { recursive: true });
  cpSync(
    resolve(SKILL_DIR, 'scripts/audit-local-only.ts'),
    resolve(targetScripts, 'audit-local-only.ts'),
  );
  cpSync(
    resolve(SKILL_DIR, 'scripts/inspect-threejs-canvas.ts'),
    resolve(targetScripts, 'inspect-threejs-canvas.ts'),
  );

  const docs = resolve(target, 'docs');
  mkdirSync(docs, { recursive: true });
  cpSync(
    resolve(SKILL_DIR, 'assets/content-provenance.template.md'),
    resolve(docs, 'content-provenance.md'),
  );
  cpSync(
    resolve(SKILL_DIR, 'assets/game-report.template.md'),
    resolve(docs, 'game-report.md'),
  );

  const projectName = normalizedProjectName(target);
  rewriteJsonName(resolve(target, 'package.json'), projectName);
  rewriteJsonName(resolve(target, 'package-lock.json'), projectName);
  return target;
}

export function main(argv = process.argv.slice(2)): number {
  if (argv.length !== 1 || argv[0] === '-h' || argv[0] === '--help') {
    const stream = argv.includes('-h') || argv.includes('--help')
      ? process.stdout
      : process.stderr;
    stream.write('Usage: npm run create:game -- <target-directory>\n');
    return argv.includes('-h') || argv.includes('--help') ? 0 : 2;
  }

  const target = createGame(resolveInvocationPath(argv[0]));
  console.log(`Created Three.js game scaffold at ${target}`);
  console.log(
    `Next: cd ${target} && npm install && npm run setup:browsers && npm run dev`,
  );
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

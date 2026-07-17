import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { afterEach, test } from 'node:test';
import { rm, mkdtemp } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import {
  createGame,
  normalizedProjectName,
  resolveInvocationPath,
} from './create-threejs-game.ts';

const temporaryDirectories: string[] = [];
const SCRIPT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'create-threejs-game.ts',
);

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), 'threejs-game-studio-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

test('normalizes generated package names', () => {
  assert.equal(normalizedProjectName('/tmp/My Great Game!'), 'my-great-game');
  assert.equal(normalizedProjectName('/tmp/---'), 'threejs-vite-game');
});

test('resolves relative CLI targets from npm INIT_CWD', () => {
  assert.equal(
    resolveInvocationPath('./my-game', '/tmp/caller-project'),
    '/tmp/caller-project/my-game',
  );
});

test('advertises the actual npm create command', () => {
  const result = spawnSync(
    process.execPath,
    ['--import', 'tsx', SCRIPT, '--help'],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /npm run create:game -- <target-directory>/);
  assert.match(result.stdout, /--name/);
  assert.match(result.stdout, /r185/);
});

test('creates an npm-ready TypeScript scaffold without build artifacts', async () => {
  const parent = await temporaryDirectory();
  const target = resolve(parent, 'My Browser Game');
  const created = createGame(target);

  assert.equal(created, target);
  const packageJson = JSON.parse(
    readFileSync(resolve(target, 'package.json'), 'utf8'),
  ) as { name: string; scripts: Record<string, string> };
  assert.equal(packageJson.name, 'my-browser-game');
  assert.equal(
    packageJson.scripts['audit:local'],
    'node --import tsx scripts/audit-local-only.ts',
  );
  assert.equal(packageJson.scripts['setup:browsers'], 'playwright install chromium');
  assert.ok(existsSync(resolve(target, 'scripts/audit-local-only.ts')));
  assert.ok(existsSync(resolve(target, 'scripts/inspect-threejs-canvas.ts')));
  assert.ok(existsSync(resolve(target, 'docs/content-provenance.md')));
  assert.ok(existsSync(resolve(target, 'docs/game-report.md')));
  assert.ok(existsSync(resolve(target, 'docs/three-revision.md')));
  const viteConfig = readFileSync(resolve(target, 'vite.config.ts'), 'utf8');
  assert.equal(viteConfig.match(/port:\s*5188/g)?.length, 2);
  assert.equal(existsSync(resolve(target, 'dist')), false);
  assert.equal(existsSync(resolve(target, 'node_modules')), false);
});

test('refuses to overlay a non-empty directory', async () => {
  const parent = await temporaryDirectory();
  const target = resolve(parent, 'occupied');
  mkdirSync(target);
  writeFileSync(resolve(target, 'keep.txt'), 'user-owned\n', 'utf8');

  assert.throws(() => createGame(target), /Target is not empty/);
  assert.equal(readFileSync(resolve(target, 'keep.txt'), 'utf8'), 'user-owned\n');
  assert.equal(basename(target), 'occupied');
});

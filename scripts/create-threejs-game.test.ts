import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { basename, dirname, resolve } from 'node:path';
import { afterEach, test } from 'node:test';
import { rm, mkdtemp } from 'node:fs/promises';
import { fileURLToPath, pathToFileURL } from 'node:url';

import {
  createGame,
  GENERATED_SCRIPT_COMMANDS,
  GENERATED_SCRIPTS,
  normalizedProjectName,
  resolveInvocationPath,
} from './create-threejs-game.ts';

const temporaryDirectories: string[] = [];
const SCRIPT = resolve(
  dirname(fileURLToPath(import.meta.url)),
  'create-threejs-game.ts',
);
const TSX_IMPORT = pathToFileURL(createRequire(import.meta.url).resolve('tsx')).href;

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(resolve(tmpdir(), 'threejs-game-studio-'));
  const canonicalDirectory = realpathSync(directory);
  temporaryDirectories.push(canonicalDirectory);
  return canonicalDirectory;
}

async function temporarySkillDirectory(): Promise<string> {
  const directory = await mkdtemp(
    resolve(dirname(SCRIPT), '..', '.generator-smoke-'),
  );
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
  assert.equal(normalizedProjectName('/tmp/.hidden-game'), 'hidden-game');
  assert.ok(normalizedProjectName(`/tmp/${'a'.repeat(300)}`).length <= 214);
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
  assert.match(result.stdout, /--genre/);
  assert.match(result.stdout, /r185/);
  assert.match(result.stdout, /current stable/);
});

test('runs through a symlinked CLI entry path', async () => {
  const directory = await temporaryDirectory();
  const linkedScript = resolve(directory, 'create-threejs-game.ts');
  symlinkSync(SCRIPT, linkedScript);
  const result = spawnSync(
    process.execPath,
    ['--import', TSX_IMPORT, linkedScript, '--help'],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Usage: npm run create:game/);
});

test('applies runner genre overlay files', async () => {
  const parent = await temporaryDirectory();
  const target = resolve(parent, 'runner-game');
  createGame(target, { genre: 'runner' });
  assert.ok(existsSync(resolve(target, 'docs/genre-contract.md')));
  const gameSource = readFileSync(resolve(target, 'src/game/Game.ts'), 'utf8');
  assert.match(gameSource, /distance|runner|lane/i);
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
  for (const [command, expected] of Object.entries(GENERATED_SCRIPT_COMMANDS)) {
    assert.equal(packageJson.scripts[command], expected, command);
  }
  assert.equal(packageJson.scripts['setup:browsers'], 'playwright install chromium');
  assert.equal(Object.keys(GENERATED_SCRIPT_COMMANDS).length, GENERATED_SCRIPTS.length);
  for (const name of GENERATED_SCRIPTS) {
    const generated = resolve(target, 'scripts', name);
    assert.ok(existsSync(generated), name);
    assert.equal(
      readFileSync(generated, 'utf8'),
      readFileSync(resolve(dirname(SCRIPT), name), 'utf8'),
      `${name} must be copied from the maintained root script`,
    );
  }
  assert.ok(existsSync(resolve(target, 'docs/content-provenance.md')));
  assert.ok(existsSync(resolve(target, 'docs/game-report.md')));
  assert.ok(existsSync(resolve(target, 'docs/three-revision.md')));
  const viteConfig = readFileSync(resolve(target, 'vite.config.ts'), 'utf8');
  const playwrightConfig = readFileSync(resolve(target, 'playwright.config.ts'), 'utf8');
  assert.match(viteConfig, /THREE_GAME_PORT\s*\?\?\s*'5188'/);
  assert.match(playwrightConfig, /THREE_GAME_PORT\s*\?\?\s*'5188'/);
  assert.match(playwrightConfig, /baseURL:\s*loopbackUrl/);
  assert.equal(existsSync(resolve(target, 'dist')), false);
  assert.equal(existsSync(resolve(target, '.e2e-dist')), false);
  assert.equal(existsSync(resolve(target, '.vite')), false);
  assert.equal(existsSync(resolve(target, 'node_modules')), false);
});

test('every generated release command has an executable help smoke test', async () => {
  // Keep this fixture under the installed skill so generated ESM imports can
  // resolve the skill's already-installed dev dependencies without symlinks.
  const parent = await temporarySkillDirectory();
  const target = resolve(parent, 'command-smoke');
  createGame(target);

  const scriptForCommand = new Map<string, string>([
    ['audit:local', 'audit-local-only.ts'],
    ['inspect:canvas', 'inspect-threejs-canvas.ts'],
    ['probe:three', 'probe-three-revision.ts'],
    ['audit:apis', 'audit-project-three-apis.ts'],
    ['audit:assets', 'audit-gltf-assets.ts'],
    ['audit:report', 'audit-game-report.ts'],
    ['ship-check', 'ship-check.ts'],
  ]);
  assert.deepEqual(
    [...scriptForCommand.keys()].sort(),
    Object.keys(GENERATED_SCRIPT_COMMANDS).sort(),
  );

  for (const [command, script] of scriptForCommand) {
    const result = spawnSync(
      process.execPath,
      ['--import', TSX_IMPORT, resolve(target, 'scripts', script), '--help'],
      {
        cwd: target,
        encoding: 'utf8',
        env: {
          ...process.env,
          NODE_PATH: resolve(dirname(SCRIPT), '..', 'node_modules'),
        },
      },
    );
    assert.equal(result.status, 0, `${command}\n${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /usage|Usage/, `${command}\n${result.stdout}\n${result.stderr}`);
  }
});

test('preflights all required sources before creating the target', async () => {
  const parent = await temporaryDirectory();
  const isolatedSkill = resolve(parent, 'broken-skill');
  const isolatedScripts = resolve(isolatedSkill, 'scripts');
  const scaffold = resolve(isolatedSkill, 'assets/threejs-vite-game');
  mkdirSync(isolatedScripts, { recursive: true });
  mkdirSync(scaffold, { recursive: true });
  writeFileSync(
    resolve(isolatedScripts, 'create-threejs-game.ts'),
    readFileSync(SCRIPT, 'utf8'),
    'utf8',
  );
  writeFileSync(resolve(scaffold, 'package.json'), '{}\n', 'utf8');
  writeFileSync(resolve(scaffold, 'package-lock.json'), '{}\n', 'utf8');

  const target = resolve(parent, 'must-not-exist');
  const result = spawnSync(
    process.execPath,
    [
      '--import',
      TSX_IMPORT,
      resolve(isolatedScripts, 'create-threejs-game.ts'),
      target,
    ],
    { encoding: 'utf8' },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /generator preflight failed/);
  assert.equal(existsSync(target), false);
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

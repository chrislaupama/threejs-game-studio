/** Focused CLI tests for audit-local-only.ts. */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'audit-local-only.ts');

interface AuditResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface RunOptions {
  baseline?: string;
  args?: string[];
}

function runAudit(
  files: Readonly<Record<string, string>>,
  options: RunOptions = {},
): AuditResult {
  const directory = mkdtempSync(join(tmpdir(), 'audit-local-only-'));
  try {
    const root = join(directory, 'project');
    mkdirSync(root, { recursive: true });
    for (const [relativePath, content] of Object.entries(files)) {
      const path = join(root, relativePath);
      mkdirSync(dirname(path), { recursive: true });
      writeFileSync(path, content, 'utf8');
    }

    const command = ['--import', 'tsx', SCRIPT, root, ...(options.args ?? [])];
    if (options.baseline !== undefined) {
      const baselinePath = join(directory, 'baseline-package.json');
      writeFileSync(baselinePath, options.baseline, 'utf8');
      command.push('--baseline-package-json', baselinePath);
    }
    const result = spawnSync(process.execPath, command, { encoding: 'utf8' });
    if (result.error) throw result.error;
    return {
      status: result.status,
      stdout: result.stdout,
      stderr: result.stderr,
    };
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}

function diagnostic(result: AuditResult): string {
  return result.stdout + result.stderr;
}

test('accepts Three.js, relative assets, exact loopback URLs, and config tooling', () => {
  const result = runAudit({
    'package.json': JSON.stringify({
      homepage: 'https://example.com/source',
      dependencies: { three: '^0.184.0' },
      devDependencies: { vite: '^8.0.0' },
    }),
    'index.html': '<script type="module" src="/src/main.ts"></script>',
    'src/main.ts': [
      "import * as THREE from 'three';",
      "import './style.css';",
      "const preview = 'http://localhost:5173/game/';",
      'void THREE; void preview;',
    ].join('\n'),
    'src/style.css': 'body { background: #000; }',
    'public/favicon.svg': '<svg xmlns="http://www.w3.org/2000/svg"></svg>',
    'vite.config.ts': "import { defineConfig } from 'vite'; export default defineConfig({});",
  });
  assert.equal(result.status, 0, diagnostic(result));
});

test('accepts exact protocol-relative loopback URLs', () => {
  const result = runAudit({
    'package.json': JSON.stringify({ dependencies: { three: '^0.184.0' } }),
    'src/main.ts': [
      "const host = '//localhost:5188/game';",
      "const ipv4 = '//127.0.0.1:5188/game';",
      "const ipv6 = '//[::1]:5188/game';",
      'void host; void ipv4; void ipv6;',
    ].join('\n'),
  });
  assert.equal(result.status, 0, diagnostic(result));
});

test('rejects protocol-relative loopback suffix attacks', () => {
  const result = runAudit({
    'package.json': JSON.stringify({ dependencies: { three: '^0.184.0' } }),
    'src/main.ts': "const endpoint = '//localhost.evil/collect'; void endpoint;",
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /protocol-relative URL/);
});

test('rejects protocol-relative userinfo disguised as loopback', () => {
  const result = runAudit({
    'package.json': JSON.stringify({ dependencies: { three: '^0.184.0' } }),
    'src/main.ts': "const endpoint = '//localhost@evil.example/collect'; void endpoint;",
    'src/style.css': 'body { background: url(//127.0.0.1@evil.example/image.png); }',
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout.match(/protocol-relative URL/g)?.length, 2);
});

test('rejects remote fetches and unapproved runtime packages', () => {
  const result = runAudit({
    'package.json': JSON.stringify({
      dependencies: { three: '^0.184.0', axios: '^1.0.0' },
    }),
    'src/main.ts': "fetch('https://example.com/model.glb');",
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /remote URL/);
  assert.match(result.stdout, /fetch call/);
  assert.match(result.stdout, /unapproved runtime package/);
});

test('scans modern TypeScript module extensions', () => {
  const result = runAudit({
    'package.json': JSON.stringify({ dependencies: { three: '^0.184.0' } }),
    'src/main.mts': "fetch('https://example.com/model.glb');",
    'server/socket.cts': "import net from 'node:net';\nnet.connect(443);",
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /remote URL/);
  assert.match(result.stdout, /fetch call/);
  assert.match(result.stdout, /unapproved bare runtime import/);
});

test('does not treat localhost suffix attacks as loopback URLs', () => {
  const result = runAudit({
    'package.json': JSON.stringify({ dependencies: { three: '^0.184.0' } }),
    'src/main.ts': [
      "const direct = 'http://localhost.evil/collect';",
      "const port = 'http://localhost:5173.evil/collect';",
      'void direct; void port;',
    ].join('\n'),
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout.match(/remote URL/g)?.length, 2);
});

test('allows only dependencies recorded exactly in the baseline', () => {
  const result = runAudit(
    {
      'package.json': JSON.stringify({
        dependencies: {
          three: '^0.184.0',
          'local-physics': 'file:../local-physics',
        },
      }),
      'src/main.ts': "import physics from 'local-physics'; void physics;",
    },
    {
      baseline: JSON.stringify({
        dependencies: { 'local-physics': 'file:../local-physics' },
      }),
    },
  );
  assert.equal(result.status, 0, diagnostic(result));
});

test('rejects optional and bracket network calls across common source roots', () => {
  const result = runAudit({
    'package.json': JSON.stringify({ dependencies: { three: '^0.184.0' } }),
    'app/main.ts': "globalThis.fetch?.(url); window['fetch'](url); navigator.sendBeacon?.('/x');",
    'workers/sync.js': 'importScripts(endpoint); new WebTransport(endpoint);',
  });
  assert.equal(result.status, 1);
  assert.ok((result.stdout.match(/fetch call/g)?.length ?? 0) >= 2);
  assert.match(result.stdout, /sendBeacon/);
  assert.match(result.stdout, /importScripts/);
  assert.match(result.stdout, /WebTransport/);
});

test('rejects remote config values and protocol-relative IP URLs', () => {
  const result = runAudit({
    'package.json': JSON.stringify({
      dependencies: { three: '^0.184.0' },
      devDependencies: { vite: '^8.0.0' },
    }),
    'vite.config.ts': [
      "import { defineConfig } from 'vite';",
      "const endpoint = '//10.0.0.8/collect';",
      'export default defineConfig({});',
    ].join('\n'),
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /protocol-relative URL/);
});

test('rejects host-only protocol-relative CSS URLs', () => {
  const result = runAudit({
    'package.json': JSON.stringify({ dependencies: { three: '^0.184.0' } }),
    'src/style.css': 'body { background-image: url(//cdn.example.com); }',
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /protocol-relative URL/);
});

test('rejects single-label protocol-relative hosts with paths', () => {
  const result = runAudit({
    'package.json': JSON.stringify({ dependencies: { three: '^0.184.0' } }),
    'src/main.ts': "const endpoint = '//collector/ingest'; void endpoint;",
    'src/style.css': 'body { background-image: url(//cdn/image.png); }',
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout.match(/protocol-relative URL/g)?.length, 2);
});

test('rejects CommonJS bare runtime imports', () => {
  const result = runAudit({
    'package.json': JSON.stringify({ dependencies: { three: '^0.184.0' } }),
    'server/main.cjs': "const cloud = require('cloud-sdk'); void cloud;",
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /unapproved bare runtime import/);
});

test('ignores provenance URLs and network words in JavaScript comments', () => {
  const result = runAudit({
    'package.json': JSON.stringify({
      homepage: 'https://example.com/source',
      dependencies: { three: '^0.184.0' },
    }),
    'src/main.ts': [
      '// Source: https://example.com/paper; do not fetch at runtime',
      'const shader = `// https://example.com/shader-paper\\nvoid main(){}`;',
      "import * as THREE from 'three';",
      'void shader; void THREE;',
    ].join('\n'),
  });
  assert.equal(result.status, 0, diagnostic(result));
});

test('allows local polyfills and shader source comments in built bundles', () => {
  const result = runAudit({
    'package.json': JSON.stringify({ dependencies: { three: '^0.184.0' } }),
    'dist/app.js': "fetch('/chunk.js'); const shader = `// https://example.com/paper\\nvoid main(){}`;",
  });
  assert.equal(result.status, 0, diagnostic(result));
});

test('still rejects remote literals in built bundles', () => {
  const result = runAudit({
    'package.json': JSON.stringify({ dependencies: { three: '^0.184.0' } }),
    'dist/app.js': "const endpoint = 'https://example.com/collect';",
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /remote URL/);
});

test('returns exit code 2 for a malformed baseline package', () => {
  const result = runAudit(
    { 'package.json': JSON.stringify({ dependencies: { three: '^0.184.0' } }) },
    { baseline: '{not-json' },
  );
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Invalid baseline package\.json/);
});

test('returns exit code 2 for invalid CLI arguments', () => {
  const result = runAudit({}, { args: ['--unknown-option'] });
  assert.equal(result.status, 2);
  assert.match(result.stderr, /unrecognized argument/);
});

import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  checkOfficialLinks,
  collectOfficialLinks,
  parseArgs,
} from './audit-official-links.ts';

test('collects, filters, de-duplicates, and locates official links', () => {
  const root = mkdtempSync(join(tmpdir(), 'official-link-audit-'));
  try {
    mkdirSync(join(root, 'references'));
    writeFileSync(
      join(root, 'SKILL.md'),
      '# Skill\n\n[Renderer](https://threejs.org/docs/pages/WebGLRenderer.html#methods)\n',
    );
    writeFileSync(
      join(root, 'README.md'),
      '[Duplicate](https://threejs.org/docs/pages/WebGLRenderer.html)\n' +
      '[Third party](https://example.com/three)\n',
    );
    writeFileSync(
      join(root, 'references', 'official.md'),
      '[Source](https://github.com/mrdoob/three.js/blob/r185/src/core/Timer.js)\n' +
      '[npm](https://www.npmjs.com/package/three?activeTab=versions)\n',
    );

    const links = collectOfficialLinks(root);
    assert.equal(links.length, 3);
    const renderer = links.find((item) => item.url.includes('WebGLRenderer'));
    assert.equal(renderer?.sources.length, 2);
    assert.deepEqual(renderer?.sources.map((source) => source.line), [1, 3]);
    assert.ok(links.some((item) => item.url.includes('github.com/mrdoob/three.js')));
    assert.ok(links.some((item) => item.url.includes('activeTab=versions')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('checks links with bounded retries and reports HTTP failures', async () => {
  const attempts = new Map<string, number>();
  const fakeFetch = (async (input: string | URL | Request) => {
    const url = String(input);
    const count = (attempts.get(url) ?? 0) + 1;
    attempts.set(url, count);
    if (url.endsWith('/retry') && count === 1) return new Response('', { status: 503 });
    if (url.endsWith('/missing')) return new Response('', { status: 404 });
    return new Response('ok', { status: 200 });
  }) as typeof fetch;
  const source = [{ path: 'SKILL.md', line: 1, originalUrl: '' }];
  const results = await checkOfficialLinks(
    [
      { url: 'https://threejs.org/ok', sources: source },
      { url: 'https://threejs.org/retry', sources: source },
      { url: 'https://threejs.org/missing', sources: source },
    ],
    { concurrency: 2, timeoutMs: 1_000, retries: 1, fetchImpl: fakeFetch },
  );
  assert.deepEqual(results.map((result) => result.ok), [true, true, false]);
  assert.equal(attempts.get('https://threejs.org/retry'), 2);
  assert.equal(results[2]?.status, 404);
});

test('validates CLI bounds without requiring network access', () => {
  assert.equal(parseArgs(['--help']), 'help');
  const parsed = parseArgs(['.', '--concurrency', '4', '--timeout', '5000', '--retries', '0']);
  assert.notEqual(parsed, 'help');
  if (parsed !== 'help') {
    assert.equal(parsed.concurrency, 4);
    assert.equal(parsed.timeoutMs, 5_000);
    assert.equal(parsed.retries, 0);
  }
  assert.throws(() => parseArgs(['--concurrency', '0']), /positive integer/);
  assert.throws(() => parseArgs(['--retries', '-1']), /non-negative integer/);
  assert.throws(() => parseArgs(['--unknown']), /unrecognized argument/);
});

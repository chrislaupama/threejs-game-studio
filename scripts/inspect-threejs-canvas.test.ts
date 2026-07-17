import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { PNG } from 'pngjs';
import { chromium } from '@playwright/test';

import {
  applyDeterministicHooks,
  assertLocalUrl,
  computePixelMetrics,
  isCanonicallyWithin,
  isSpatiallyNonBlank,
  normalizeRendererDiagnostics,
  parseArgs,
  sampleCanvas,
} from './inspect-threejs-canvas.ts';

function image(left: [number, number, number], right = left): PNG {
  const png = new PNG({ width: 160, height: 90 });
  for (let y = 0; y < png.height; y += 1) {
    for (let x = 0; x < png.width; x += 1) {
      const color = x < png.width / 2 ? left : right;
      const offset = (y * png.width + x) * 4;
      png.data[offset] = color[0];
      png.data[offset + 1] = color[1];
      png.data[offset + 2] = color[2];
      png.data[offset + 3] = 255;
    }
  }
  return png;
}

function cleanCanvasPage(contextType: 'webgl2' | 'webgl' | 'webgpu' | null) {
  const dataUrl = `data:image/png;base64,${PNG.sync.write(
    image([8, 12, 20], [240, 180, 40]),
  ).toString('base64')}`;
  const locator = {
    first: () => locator,
    boundingBox: async () => ({ x: 0, y: 0, width: 160, height: 90 }),
    evaluate: async () => dataUrl,
  };
  return {
    locator: () => locator,
    evaluate: async () => ({
      drawingBuffer: { width: 160, height: 90 },
      game: null,
      contextType,
    }),
  } as unknown as Parameters<typeof sampleCanvas>[0];
}

test('spatial classifier rejects a uniform bright blue canvas', () => {
  const metrics = computePixelMetrics(image([0, 80, 255]));
  assert.equal(isSpatiallyNonBlank(metrics, 1), false);
  assert.equal(metrics.dominantColorShare, 1);
});

test('spatial classifier accepts an opaque canvas with a visible boundary', () => {
  const metrics = computePixelMetrics(image([8, 12, 20], [240, 180, 40]));
  assert.equal(isSpatiallyNonBlank(metrics, 1), true);
  assert.ok(metrics.edgeDensity > 0);
});

test('normalizes flat and renderer.info backend metrics', () => {
  const normalized = normalizeRendererDiagnostics({
    revision: '185',
    type: 'WebGPURenderer',
    info: {
      render: { calls: 99, drawCalls: 12, triangles: 3400 },
      memory: { geometries: 8, textures: 4 },
    },
  });
  assert.deepEqual(normalized, {
    drawCalls: 12,
    triangles: 3400,
    geometries: 8,
    textures: 4,
    revision: '185',
    type: 'WebGPURenderer',
    backend: 'webgpu',
    toneMapping: undefined,
    dpr: undefined,
  });
});

test('validates numeric and filename-like CLI values', () => {
  assert.throws(() => parseArgs(['--wait', 'NaN']), /finite number/);
  assert.throws(() => parseArgs(['--seed', '-1']), /non-negative safe integer/);
  assert.throws(() => parseArgs(['--state', '../escape']), /letters, digits/);
  assert.throws(() => parseArgs(['--url']), /requires a value/);
  assert.throws(() => parseArgs(['--allow-budget-overrun']), /budget-override/);
  assert.doesNotThrow(() => parseArgs([
    '--allow-budget-overrun',
    '--budget-override',
    'Approved in docs/performance.md after mobile profiling',
  ]));
  const clean = parseArgs(['--clean-smoke']);
  assert.notEqual(clean, 'help');
  if (clean !== 'help') assert.equal(clean.cleanSmoke, true);
  assert.throws(
    () => parseArgs(['--clean-smoke', '--state', 'active-play']),
    /cannot be combined/,
  );
  assert.throws(
    () => parseArgs(['--clean-smoke', '--seed', '42']),
    /cannot be combined/,
  );
});

test('deterministic hooks must acknowledge the requested state and seed', async () => {
  const page = {
    waitForFunction: async () => undefined,
    evaluate: async () => false,
  } as unknown as Parameters<typeof applyDeterministicHooks>[0];
  assert.equal(await applyDeterministicHooks(page, 'boss-fight', 42), false);
});

test('clean production smoke accepts spatial pixels only with a 3D canvas context', async () => {
  const rendered = await sampleCanvas(cleanCanvasPage('webgl2'), 'desktop', false);
  assert.equal(rendered.ok, true);
  assert.equal(rendered.contextType, 'webgl2');
  assert.equal(rendered.rendererWorkDetected, false);
  assert.equal(rendered.reason, 'spatial-render-work-detected');

  const twoDimensional = await sampleCanvas(cleanCanvasPage(null), 'desktop', false);
  assert.equal(twoDimensional.ok, false);
  assert.equal(twoDimensional.reason, 'missing-3d-canvas-context');
});

test('allows only loopback URLs and project-contained file URLs', () => {
  const root = mkdtempSync(join(tmpdir(), 'canvas-inspector-'));
  try {
    assert.doesNotThrow(() => assertLocalUrl('http://127.0.0.1:5188', root));
    assert.doesNotThrow(() => assertLocalUrl('http://[::1]:5188', root));
    assert.doesNotThrow(() => assertLocalUrl(pathToFileURL(join(root, 'index.html')).href, root));
    const remote = ['https:', '', 'example.com', 'game'].join('/');
    assert.throws(() => assertLocalUrl(remote, root), /non-local/);
    assert.throws(() => assertLocalUrl('ftp://localhost/game', root), /non-local/);
    assert.throws(() => assertLocalUrl(pathToFileURL(join(root, '..', 'outside.html')).href, root), /outside project/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('canonical containment rejects a symlink escape', () => {
  const root = mkdtempSync(join(tmpdir(), 'canvas-inspector-root-'));
  const outside = mkdtempSync(join(tmpdir(), 'canvas-inspector-outside-'));
  try {
    mkdirSync(join(root, 'artifacts'));
    symlinkSync(outside, join(root, 'artifacts', 'escape'));
    assert.equal(isCanonicallyWithin(root, join(root, 'artifacts', 'capture')), true);
    assert.equal(isCanonicallyWithin(root, join(root, 'artifacts', 'escape', 'capture')), false);
    assert.throws(
      () => assertLocalUrl(pathToFileURL(join(root, 'artifacts', 'escape', 'index.html')).href, root),
      /outside project/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(outside, { recursive: true, force: true });
  }
});

test('raw-canvas classifier ignores a CSS checkerboard behind an untouched transparent canvas', async () => {
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 320, height: 200 } });
    await page.setContent(`
      <style>
        body { margin: 0; background: repeating-conic-gradient(#fff 0 25%, #111 0 50%) 0 / 32px 32px; }
        canvas { width: 320px; height: 200px; }
      </style>
      <canvas width="320" height="200"></canvas>
      <script>
        window.__THREE_GAME_DIAGNOSTICS__ = {
          renderer: { revision: '185', type: 'WebGLRenderer', backend: 'webgl', drawCalls: 0, triangles: 0, geometries: 0, textures: 0 }
        };
      </script>
    `);
    const result = await sampleCanvas(page, 'desktop');
    assert.equal(result.ok, false);
    assert.match(result.reason, /uniform-or-transparent|zero-render-work/);
  } finally {
    await browser.close();
  }
});

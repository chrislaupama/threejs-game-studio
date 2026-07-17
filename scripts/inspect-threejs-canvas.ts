#!/usr/bin/env node
import { chromium, devices, type Page } from '@playwright/test';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { PNG } from 'pngjs';

// Starting-point render budgets (see references/technical-art.md in the skill).
// Over-budget rows are reported, not fatal.
type RenderMode = 'desktop' | 'mobile';

interface InspectorArguments {
  url: string;
  out: string;
  mobile: boolean;
  wait: number;
  state: string | null;
  seed?: number;
}

interface RendererDiagnostics {
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
  revision?: string;
  type?: string;
  backend?: string;
  toneMapping?: string | number;
  dpr?: number;
}

interface RenderBudgetMetrics {
  calls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

interface ThreeGameTestHooks {
  seed?(value: number): void;
  setState?(state: string): void;
}

interface InspectorGameWindow {
  __THREE_GAME_DIAGNOSTICS__?: {
    renderer?: RendererDiagnostics;
    canvas?: { dpr?: number };
  };
  __THREE_GAME_TEST_HOOKS__?: ThreeGameTestHooks;
}

const RENDER_BUDGETS: Record<RenderMode, Record<keyof RenderBudgetMetrics, number>> = {
  desktop: { calls: 300, triangles: 750_000, geometries: 300, textures: 60 },
  mobile: { calls: 150, triangles: 300_000, geometries: 200, textures: 40 },
};

function parseArgs(argv: string[]): InspectorArguments {
  const args: InspectorArguments = {
    url: 'http://127.0.0.1:5188',
    out: 'artifacts/canvas-inspection',
    mobile: false,
    wait: 750,
    state: null,
    seed: undefined,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--url') args.url = argv[++i];
    else if (value === '--out') args.out = argv[++i];
    else if (value === '--mobile') args.mobile = true;
    else if (value === '--wait') args.wait = Number(argv[++i]);
    else if (value === '--state') args.state = argv[++i];
    else if (value === '--seed') args.seed = Number(argv[++i]);
    else if (value === '-h' || value === '--help') {
      console.log(
        'Usage: inspect-threejs-canvas.ts [--url URL] [--out DIR] [--mobile] [--wait MS] [--state NAME] [--seed N]\n' +
          '  --state/--seed drive window.__THREE_GAME_TEST_HOOKS__ (setState/seed) before capture\n' +
          '  so specific game states can be measured deterministically.',
      );
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }

  return args;
}

function assertLocalUrl(value: string): void {
  const url = new URL(value);
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
  if (url.protocol !== 'file:' && !loopback) {
    throw new Error(`Refusing non-local URL: ${value}`);
  }
}

function isAllowedRequestUrl(value: string): boolean {
  const url = new URL(value);
  if (['about:', 'blob:', 'data:', 'file:'].includes(url.protocol)) return true;
  return ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
}

const round = (value: number, digits: number): number => Number(value.toFixed(digits));

// Objective pixel statistics used as "Measured Evidence" in the visual
// scorecard. Computed on a coarse luminance grid so cost stays trivial.
function computePixelMetrics(png: PNG) {
  const stepX = Math.max(1, Math.floor(png.width / 160));
  const stepY = Math.max(1, Math.floor(png.height / 90));
  const cols = Math.floor(png.width / stepX);
  const rows = Math.floor(png.height / stepY);
  const luminance = new Float64Array(cols * rows);
  const bucketCounts = new Map();
  let samples = 0;

  for (let gy = 0; gy < rows; gy += 1) {
    for (let gx = 0; gx < cols; gx += 1) {
      const offset = ((gy * stepY) * png.width + gx * stepX) * 4;
      const r = png.data[offset];
      const g = png.data[offset + 1];
      const b = png.data[offset + 2];
      luminance[gy * cols + gx] = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const key = `${r >> 4},${g >> 4},${b >> 4}`;
      bucketCounts.set(key, (bucketCounts.get(key) ?? 0) + 1);
      samples += 1;
    }
  }

  const sorted = Array.from(luminance).sort((a, b) => a - b);
  const mean = sorted.reduce((sum, v) => sum + v, 0) / sorted.length;
  const p5 = sorted[Math.floor(sorted.length * 0.05)];
  const p95 = sorted[Math.floor(sorted.length * 0.95)];

  let entropy = 0;
  let dominant = 0;
  for (const count of bucketCounts.values()) {
    const p = count / samples;
    entropy -= p * Math.log2(p);
    dominant = Math.max(dominant, count);
  }

  let edges = 0;
  let checked = 0;
  for (let gy = 0; gy < rows - 1; gy += 1) {
    for (let gx = 0; gx < cols - 1; gx += 1) {
      const i = gy * cols + gx;
      const dx = Math.abs(luminance[i] - luminance[i + 1]);
      const dy = Math.abs(luminance[i] - luminance[i + cols]);
      if (Math.max(dx, dy) > 12) edges += 1;
      checked += 1;
    }
  }

  return {
    colorBuckets: bucketCounts.size,
    colorEntropyBits: round(entropy, 2),
    edgeDensity: round(edges / checked, 3),
    luminance: {
      mean: round(mean, 1),
      p5: round(p5, 1),
      p95: round(p95, 1),
      contrast: round(p95 - p5, 1),
    },
    dominantColorShare: round(dominant / samples, 3),
    nonBackgroundShare: round(1 - dominant / samples, 3),
  };
}

function checkRenderBudget(
  renderer: RendererDiagnostics | null,
  mode: RenderMode,
) {
  if (!renderer) return null;
  const budget = RENDER_BUDGETS[mode];
  const rows = (Object.entries(budget) as Array<
    [keyof RendererDiagnostics, number]
  >).map(([metric, limit]) => {
    const actual = renderer[metric];
    return {
      metric,
      actual: typeof actual === 'number' ? actual : null,
      limit,
      ok: typeof actual === 'number' ? actual <= limit : null,
    };
  });
  return {
    tier: mode,
    note: 'starting-point budget; adjust per game and document overrides',
    rows,
    measurable: rows.every((row) => row.ok !== null),
    withinBudget: rows.some((row) => row.ok === null)
      ? null
      : rows.every((row) => row.ok === true),
  };
}

async function sampleCanvas(page: Page, mode: RenderMode) {
  const locator = page.locator('canvas').first();
  const rect = await locator.boundingBox();
  if (!rect || rect.width < 32 || rect.height < 32) {
    return { ok: false, reason: 'canvas-too-small', rect };
  }

  const buffer = await locator.screenshot();
  const png = PNG.sync.read(buffer);
  let min = 255;
  let max = 0;
  let alphaPixels = 0;
  const colors = new Set();
  const stride = Math.max(1, Math.floor((png.width * png.height) / 4096));

  for (let pixel = 0; pixel < png.width * png.height; pixel += stride) {
    const offset = pixel * 4;
    const r = png.data[offset];
    const g = png.data[offset + 1];
    const b = png.data[offset + 2];
    const a = png.data[offset + 3];
    min = Math.min(min, r, g, b);
    max = Math.max(max, r, g, b);
    if (a > 0) alphaPixels += 1;
    colors.add(`${r >> 4},${g >> 4},${b >> 4},${a >> 6}`);
  }

  const variance = max - min;
  const diagnostics = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const gameWindow = window as unknown as InspectorGameWindow;
    return {
      drawingBuffer: canvas
        ? { width: canvas.width, height: canvas.height }
        : null,
      game: gameWindow.__THREE_GAME_DIAGNOSTICS__ ?? null,
    };
  });

  const ok = alphaPixels > 256 && (variance > 8 || colors.size > 3);
  const renderer = diagnostics.game?.renderer ?? null;
  return {
    ok,
    reason: ok ? 'nonblank' : 'low-variance',
    rect,
    drawingBuffer: diagnostics.drawingBuffer,
    alphaPixels,
    variance,
    colorBuckets: colors.size,
    three: {
      revision: renderer?.revision ?? null,
      rendererType: renderer?.type ?? null,
      backend: renderer?.backend ?? null,
      toneMapping: renderer?.toneMapping ?? null,
      dpr: renderer?.dpr ?? diagnostics.game?.canvas?.dpr ?? null,
    },
    metrics: computePixelMetrics(png),
    renderBudget: checkRenderBudget(renderer, mode),
    diagnostics: diagnostics.game,
  };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  assertLocalUrl(args.url);
  args.out = path.resolve(process.env.INIT_CWD ?? process.cwd(), args.out);
  await mkdir(args.out, { recursive: true });

  const browser = await chromium.launch(
    process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {},
  );
  const context = await browser.newContext(args.mobile
    ? { ...devices['iPhone 13'], userAgent: undefined, serviceWorkers: 'block' }
    : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
  const outboundRequests: Array<{ url: string; resourceType: string }> = [];
  await context.route('**/*', async (route) => {
    const requestUrl = route.request().url();
    if (isAllowedRequestUrl(requestUrl)) {
      await route.continue();
      return;
    }
    outboundRequests.push({ url: requestUrl, resourceType: route.request().resourceType() });
    await route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];

  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('websocket', (socket) => {
    if (!isAllowedRequestUrl(socket.url())) {
      outboundRequests.push({ url: socket.url(), resourceType: 'websocket' });
    }
  });

  await page.goto(args.url, { waitUntil: 'networkidle' });
  await page.waitForSelector('canvas', { state: 'visible', timeout: 10_000 });

  if (args.state || args.seed !== undefined) {
    const applied = await page.evaluate(({ seed, state }) => {
      const hooks = (window as unknown as InspectorGameWindow)
        .__THREE_GAME_TEST_HOOKS__;
      if (!hooks) return false;
      if (typeof seed === 'number') hooks.seed?.(seed);
      if (state) hooks.setState?.(state);
      return true;
    }, { seed: args.seed, state: args.state });
    if (!applied) {
      console.error(
        'warning: --state/--seed requested but __THREE_GAME_TEST_HOOKS__ is not defined; capturing the current state instead',
      );
    }
  }

  await page.waitForTimeout(args.wait);

  const mode = args.mobile ? 'mobile' : 'desktop';
  const baseName = args.state ? `${mode}-${args.state}` : mode;
  const result = await sampleCanvas(page, mode);
  const screenshotPath = path.join(args.out, `${baseName}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: true });

  const report = {
    url: args.url,
    mode,
    state: args.state,
    seed: args.seed ?? null,
    screenshotPath,
    result,
    outboundRequests,
    consoleErrors,
    pageErrors,
  };

  await writeFile(path.join(args.out, `${baseName}.json`), `${JSON.stringify(report, null, 2)}\n`);
  await browser.close();

  console.log(JSON.stringify(report, null, 2));

  if (
    !result.ok ||
    outboundRequests.length > 0 ||
    consoleErrors.length > 0 ||
    pageErrors.length > 0
  ) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

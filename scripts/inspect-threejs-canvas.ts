#!/usr/bin/env node
import { chromium, devices, type Browser, type Page } from '@playwright/test';
import { existsSync, realpathSync } from 'node:fs';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PNG } from 'pngjs';

// Starting-point render budgets (see references/technical-art.md in the skill).
// Over-budget rows fail unless the caller records and opts into an override.
type RenderMode = 'desktop' | 'mobile';

interface InspectorArguments {
  url: string;
  out: string;
  mobile: boolean;
  wait: number;
  state: string | null;
  seed?: number;
  allowBudgetOverrun: boolean;
  budgetOverride: string | null;
  cleanSmoke: boolean;
}

interface RendererDiagnostics {
  drawCalls?: number;
  triangles?: number;
  geometries?: number;
  textures?: number;
  revision?: string;
  type?: string;
  backend?: string;
  toneMapping?: string | number;
  dpr?: number;
}

type UnknownRecord = Record<string, unknown>;

interface RenderBudgetMetrics {
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
}

interface ThreeGameTestHooks {
  seed?(value: number): boolean;
  setState?(state: string): boolean;
  setPausedForScreenshot?(paused: boolean): void;
  setReducedMotion?(enabled: boolean): void;
  hideDebugUi?(hidden: boolean): void;
}

interface InspectorGameWindow {
  __THREE_GAME_DIAGNOSTICS__?: {
    renderer?: unknown;
    canvas?: { dpr?: number };
  };
  __THREE_GAME_TEST_HOOKS__?: ThreeGameTestHooks;
}

const RENDER_BUDGETS: Record<RenderMode, Record<keyof RenderBudgetMetrics, number>> = {
  desktop: { drawCalls: 300, triangles: 750_000, geometries: 300, textures: 60 },
  mobile: { drawCalls: 150, triangles: 300_000, geometries: 200, textures: 40 },
};

export function parseArgs(argv: string[]): InspectorArguments | 'help' {
  const args: InspectorArguments = {
    url: 'http://127.0.0.1:5188',
    out: 'artifacts/canvas-inspection',
    mobile: false,
    wait: 750,
    state: null,
    seed: undefined,
    allowBudgetOverrun: false,
    budgetOverride: null,
    cleanSmoke: false,
  };

  const takeValue = (index: number, option: string): string => {
    const value = argv[index + 1];
    if (value === undefined || value.startsWith('--')) throw new Error(`${option} requires a value`);
    return value;
  };

  for (let i = 0; i < argv.length; i += 1) {
    const value = argv[i];
    if (value === '--url') args.url = takeValue(i++, value);
    else if (value === '--out') args.out = takeValue(i++, value);
    else if (value === '--mobile') args.mobile = true;
    else if (value === '--wait') args.wait = Number(takeValue(i++, value));
    else if (value === '--state') args.state = takeValue(i++, value);
    else if (value === '--seed') args.seed = Number(takeValue(i++, value));
    else if (value === '--allow-budget-overrun') args.allowBudgetOverrun = true;
    else if (value === '--budget-override') args.budgetOverride = takeValue(i++, value);
    else if (value === '--clean-smoke') args.cleanSmoke = true;
    else if (value === '-h' || value === '--help') {
      console.log(
        'Usage: inspect-threejs-canvas.ts [--url URL] [--out DIR] [--mobile] [--wait MS] [--state NAME] [--seed N] [--clean-smoke] [--allow-budget-overrun --budget-override TEXT]\n' +
          '  --state/--seed wait for deterministic hooks, apply seed/state, reduced motion,\n' +
          '  hidden debug UI, and a screenshot pause. Output must stay inside the project.\n' +
          '  --clean-smoke validates a non-instrumented production canvas and 3D context;\n' +
          '  it is mutually exclusive with deterministic hooks and budget overrides.\n' +
          '  --allow-budget-overrun requires --budget-override with the documented rationale/evidence.',
      );
      return 'help';
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }

  if (!Number.isFinite(args.wait) || args.wait < 0 || args.wait > 60_000) {
    throw new Error('--wait must be a finite number from 0 to 60000');
  }
  if (args.seed !== undefined && (!Number.isSafeInteger(args.seed) || args.seed < 0)) {
    throw new Error('--seed must be a non-negative safe integer');
  }
  if (args.state !== null && !/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/.test(args.state)) {
    throw new Error('--state must use 1-64 letters, digits, underscores, or hyphens');
  }
  if (args.allowBudgetOverrun && (!args.budgetOverride || args.budgetOverride.trim().length < 8)) {
    throw new Error('--allow-budget-overrun requires a meaningful --budget-override rationale');
  }
  if (!args.allowBudgetOverrun && args.budgetOverride) {
    throw new Error('--budget-override requires --allow-budget-overrun');
  }
  if (args.cleanSmoke && (args.state !== null || args.seed !== undefined)) {
    throw new Error('--clean-smoke cannot be combined with --state or --seed');
  }
  if (args.cleanSmoke && (args.allowBudgetOverrun || args.budgetOverride)) {
    throw new Error('--clean-smoke cannot be combined with render-budget overrides');
  }

  return args;
}

export function isWithin(parent: string, candidate: string): boolean {
  const relative = path.relative(parent, candidate);
  return relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`));
}

/** Resolve existing symlinked ancestors before applying a project boundary. */
export function isCanonicallyWithin(parent: string, candidate: string): boolean {
  const realParent = realpathSync(parent);
  let ancestor = path.resolve(candidate);
  const suffix: string[] = [];

  while (!existsSync(ancestor)) {
    const next = path.dirname(ancestor);
    if (next === ancestor) return false;
    suffix.unshift(path.basename(ancestor));
    ancestor = next;
  }

  const realAncestor = realpathSync(ancestor);
  const realCandidate = path.resolve(realAncestor, ...suffix);
  return isWithin(realParent, realCandidate);
}

function isLoopbackHostname(hostname: string): boolean {
  return ['127.0.0.1', 'localhost', '::1', '[::1]'].includes(hostname);
}

export function assertLocalUrl(value: string, projectRoot = process.cwd()): void {
  const url = new URL(value);
  if (url.protocol !== 'file:' && (!['http:', 'https:'].includes(url.protocol) || !isLoopbackHostname(url.hostname))) {
    throw new Error(`Refusing non-local URL: ${value}`);
  }
  if (url.protocol === 'file:' && !isCanonicallyWithin(projectRoot, fileURLToPath(url))) {
    throw new Error(`Refusing file URL outside project: ${value}`);
  }
}

export function isAllowedRequestUrl(value: string, projectRoot = process.cwd()): boolean {
  try {
    const url = new URL(value);
    if (['about:', 'blob:', 'data:'].includes(url.protocol)) return true;
    if (url.protocol === 'file:') return isCanonicallyWithin(projectRoot, fileURLToPath(url));
    return ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && isLoopbackHostname(url.hostname);
  } catch {
    return false;
  }
}

const round = (value: number, digits: number): number => Number(value.toFixed(digits));

// Objective pixel statistics used as "Measured Evidence" in the visual
// scorecard. Computed on a coarse luminance grid so cost stays trivial.
export function computePixelMetrics(png: PNG) {
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

export function isSpatiallyNonBlank(
  metrics: ReturnType<typeof computePixelMetrics>,
  alphaShare: number,
): boolean {
  if (alphaShare <= 0.05 || metrics.dominantColorShare >= 0.995) return false;
  return (
    metrics.edgeDensity >= 0.002 ||
    (metrics.colorBuckets >= 4 && metrics.colorEntropyBits >= 0.15)
  );
}

function asRecord(value: unknown): UnknownRecord | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function nested(record: UnknownRecord | null, ...keys: string[]): unknown {
  let value: unknown = record;
  for (const key of keys) {
    const current = asRecord(value);
    if (!current) return undefined;
    value = current[key];
  }
  return value;
}

function finiteMetric(...values: unknown[]): number | undefined {
  return values.find(
    (value): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0,
  );
}

/** Normalize the documented flat hook plus WebGL/WebGPU renderer.info shapes. */
export function normalizeRendererDiagnostics(value: unknown): RendererDiagnostics | null {
  const record = asRecord(value);
  if (!record) return null;
  const type = typeof record.type === 'string' ? record.type : undefined;
  const backend = typeof record.backend === 'string'
    ? record.backend
    : type?.toLowerCase().includes('webgpu')
      ? 'webgpu'
      : type?.toLowerCase().includes('webgl')
        ? 'webgl'
        : undefined;
  return {
    drawCalls: finiteMetric(
      record.drawCalls,
      nested(record, 'render', 'drawCalls'),
      nested(record, 'info', 'render', 'drawCalls'),
      record.calls,
      backend === 'webgpu' ? undefined : nested(record, 'info', 'render', 'calls'),
      backend === 'webgpu' ? undefined : nested(record, 'render', 'calls'),
    ),
    triangles: finiteMetric(record.triangles, nested(record, 'render', 'triangles'), nested(record, 'info', 'render', 'triangles')),
    geometries: finiteMetric(record.geometries, nested(record, 'memory', 'geometries'), nested(record, 'info', 'memory', 'geometries')),
    textures: finiteMetric(record.textures, nested(record, 'memory', 'textures'), nested(record, 'info', 'memory', 'textures')),
    revision: typeof record.revision === 'string' ? record.revision : undefined,
    type,
    backend,
    toneMapping: typeof record.toneMapping === 'string' || typeof record.toneMapping === 'number'
      ? record.toneMapping
      : undefined,
    dpr: finiteMetric(record.dpr),
  };
}

export function checkRenderBudget(
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

export async function sampleCanvas(
  page: Page,
  mode: RenderMode,
  requireDiagnostics = true,
) {
  const locator = page.locator('canvas').first();
  const rect = await locator.boundingBox();
  if (!rect || rect.width < 32 || rect.height < 32) {
    return { ok: false, reason: 'canvas-too-small', rect };
  }

  // Element screenshots are composited with CSS behind a transparent canvas and
  // can therefore make an untouched drawing buffer look healthy. Capture the
  // canvas bitmap itself on a frame boundary so the classifier sees only pixels
  // produced by the canvas.
  const dataUrl = await locator.evaluate((element) => new Promise<string>((resolve, reject) => {
    requestAnimationFrame(() => {
      try {
        resolve((element as HTMLCanvasElement).toDataURL('image/png'));
      } catch (error) {
        reject(error);
      }
    });
  }));
  if (!dataUrl.startsWith('data:image/png;base64,')) {
    return { ok: false, reason: 'canvas-pixels-unavailable', rect };
  }
  const buffer = Buffer.from(dataUrl.slice('data:image/png;base64,'.length), 'base64');
  const png = PNG.sync.read(buffer);
  let min = 255;
  let max = 0;
  let alphaPixels = 0;
  let sampledPixels = 0;
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
    sampledPixels += 1;
    colors.add(`${r >> 4},${g >> 4},${b >> 4},${a >> 6}`);
  }

  const variance = max - min;
  const diagnostics = await page.evaluate(() => {
    const canvas = document.querySelector('canvas');
    const gameWindow = window as unknown as InspectorGameWindow;
    let contextType: 'webgl2' | 'webgl' | 'webgpu' | null = null;
    if (canvas) {
      for (const candidate of ['webgl2', 'webgl', 'webgpu'] as const) {
        try {
          if (canvas.getContext(candidate)) {
            contextType = candidate;
            break;
          }
        } catch {
          // Asking for a different context family after initialization may throw.
        }
      }
    }
    return {
      drawingBuffer: canvas
        ? { width: canvas.width, height: canvas.height }
        : null,
      game: gameWindow.__THREE_GAME_DIAGNOSTICS__ ?? null,
      contextType,
    };
  });

  const metrics = computePixelMetrics(png);
  const alphaShare = sampledPixels === 0 ? 0 : alphaPixels / sampledPixels;
  const spatialContent = isSpatiallyNonBlank(metrics, alphaShare);
  const renderer = normalizeRendererDiagnostics(diagnostics.game?.renderer);
  const renderBudget = checkRenderBudget(renderer, mode);
  const diagnosticsComplete = Boolean(
    renderer?.revision &&
    renderer.type &&
    renderer.backend &&
    renderBudget?.measurable,
  );
  const rendererWorkDetected = typeof renderer?.drawCalls === 'number' && renderer.drawCalls > 0;
  const threeContextDetected = diagnostics.contextType !== null;
  const ok = spatialContent && (
    requireDiagnostics ? rendererWorkDetected : threeContextDetected
  );
  return {
    ok,
    reason: ok
      ? 'spatial-render-work-detected'
      : !spatialContent
        ? 'uniform-or-transparent-canvas-buffer'
        : requireDiagnostics
          ? 'zero-render-work'
          : 'missing-3d-canvas-context',
    rect,
    drawingBuffer: diagnostics.drawingBuffer,
    alphaPixels,
    alphaShare: round(alphaShare, 3),
    variance,
    colorBuckets: colors.size,
    three: {
      revision: renderer?.revision ?? null,
      rendererType: renderer?.type ?? null,
      backend: renderer?.backend ?? null,
      toneMapping: renderer?.toneMapping ?? null,
      dpr: renderer?.dpr ?? diagnostics.game?.canvas?.dpr ?? null,
    },
    metrics,
    renderBudget,
    rendererWorkDetected,
    threeContextDetected,
    contextType: diagnostics.contextType,
    diagnosticsComplete,
    diagnostics: diagnostics.game,
  };
}

function redactUrl(value: string): string {
  try {
    const url = new URL(value);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.href;
  } catch {
    return '<invalid-url>';
  }
}

async function writeOutputAtomically(file: string, data: string | Uint8Array): Promise<void> {
  const temporary = path.join(path.dirname(file), `.${path.basename(file)}.${process.pid}.${randomUUID()}.tmp`);
  try {
    await writeFile(temporary, data, { flag: 'wx' });
    // Renaming replaces a malicious leaf symlink itself instead of following it.
    await rename(temporary, file);
  } catch (error) {
    await unlink(temporary).catch(() => undefined);
    throw error;
  }
}

export async function applyDeterministicHooks(
  page: Page,
  state: string | null,
  seed?: number,
): Promise<boolean> {
  const ready = await page.waitForFunction(
    ({ needsSeed, needsState }) => {
      const hooks = (window as unknown as InspectorGameWindow).__THREE_GAME_TEST_HOOKS__;
      return Boolean(
        hooks
        && (!needsSeed || typeof hooks.seed === 'function')
        && (!needsState || typeof hooks.setState === 'function')
        && typeof hooks.setReducedMotion === 'function'
        && typeof hooks.hideDebugUi === 'function'
        && typeof hooks.setPausedForScreenshot === 'function'
      );
    },
    { needsSeed: seed !== undefined, needsState: state !== null },
    { timeout: 10_000 },
  ).then(() => true, () => false);
  if (!ready) return false;

  const acknowledged = await page.evaluate(({ requestedSeed, requestedState }) => {
    const hooks = (window as unknown as InspectorGameWindow).__THREE_GAME_TEST_HOOKS__;
    if (!hooks) return false;
    if (typeof requestedSeed === 'number' && hooks.seed?.(requestedSeed) !== true) return false;
    hooks.setReducedMotion?.(true);
    hooks.hideDebugUi?.(true);
    if (requestedState && hooks.setState?.(requestedState) !== true) return false;
    hooks.setPausedForScreenshot?.(true);
    return true;
  }, { requestedSeed: seed, requestedState: state }).catch(() => false);
  if (!acknowledged) return false;

  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
  return true;
}

export async function main(argv = process.argv.slice(2)): Promise<number> {
  const parsed = parseArgs(argv);
  if (parsed === 'help') return 0;
  const args = parsed;
  const projectRoot = path.resolve(process.env.THREE_GAME_PROJECT_ROOT ?? process.cwd());
  assertLocalUrl(args.url, projectRoot);
  args.out = path.resolve(projectRoot, args.out);
  if (!isCanonicallyWithin(projectRoot, args.out)) {
    throw new Error(`Refusing output directory outside project: ${args.out}`);
  }
  await mkdir(args.out, { recursive: true });
  if (!isCanonicallyWithin(projectRoot, args.out)) {
    throw new Error(`Refusing symlinked output directory outside project: ${args.out}`);
  }

  let browser: Browser | undefined;
  try {
    browser = await chromium.launch(
      process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {},
    );
    const context = await browser.newContext(args.mobile
      ? { ...devices['iPhone 13'], serviceWorkers: 'block' }
      : { viewport: { width: 1280, height: 720 }, deviceScaleFactor: 1, serviceWorkers: 'block' });
    const outboundRequests: Array<{ url: string; resourceType: string }> = [];
    const outboundKeys = new Set<string>();
    const recordOutbound = (url: string, resourceType: string): void => {
      const redacted = redactUrl(url);
      const key = `${resourceType}:${redacted}`;
      if (outboundKeys.has(key)) return;
      outboundKeys.add(key);
      outboundRequests.push({ url: redacted, resourceType });
    };
    await context.route('**/*', async (route) => {
      const requestUrl = route.request().url();
      if (isAllowedRequestUrl(requestUrl, projectRoot)) {
        await route.continue();
        return;
      }
      recordOutbound(requestUrl, route.request().resourceType());
      await route.abort('blockedbyclient');
    });
    await context.routeWebSocket('**/*', async (socket) => {
      if (isAllowedRequestUrl(socket.url(), projectRoot)) {
        await socket.connectToServer();
        return;
      }
      recordOutbound(socket.url(), 'websocket');
      await socket.close({ code: 1008, reason: 'Non-local WebSocket blocked by canvas inspector' });
    });

    const page = await context.newPage();
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    page.on('console', (message) => {
      if (message.type() === 'error') consoleErrors.push(message.text());
    });
    page.on('pageerror', (error) => pageErrors.push(error.message));

    await page.goto(args.url, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('canvas', { state: 'visible', timeout: 10_000 });

    const hooksApplied = args.state || args.seed !== undefined
      ? await applyDeterministicHooks(page, args.state, args.seed)
      : true;
    await page.waitForTimeout(args.wait);

    const mode = args.mobile ? 'mobile' : 'desktop';
    const baseName = args.state ? `${mode}-${args.state}` : mode;
    let result = await sampleCanvas(page, mode, !args.cleanSmoke);
    if (args.cleanSmoke) {
      const deadline = Date.now() + 5_000;
      while (!result.ok && Date.now() < deadline) {
        await page.waitForTimeout(500);
        result = await sampleCanvas(page, mode, false);
      }
    }
    const screenshotPath = path.join(args.out, `${baseName}.png`);
    const screenshot = await page.screenshot({ fullPage: true });
    await writeOutputAtomically(screenshotPath, screenshot);
    const failures: string[] = [];
    if (!result.ok) failures.push(`canvas classifier: ${result.reason}`);
    if (!args.cleanSmoke && !result.diagnosticsComplete) {
      failures.push('renderer diagnostics are missing required backend/budget metrics');
    }
    if (!args.cleanSmoke && result.renderBudget?.withinBudget === false && !args.allowBudgetOverrun) {
      failures.push(`${mode} render budget exceeded (use --allow-budget-overrun only with a documented override)`);
    }
    if (!hooksApplied) failures.push('requested state/seed hooks were unavailable');
    if (outboundRequests.length > 0) failures.push(`${outboundRequests.length} non-local request(s) blocked`);
    if (consoleErrors.length > 0) failures.push(`${consoleErrors.length} console error(s)`);
    if (pageErrors.length > 0) failures.push(`${pageErrors.length} page error(s)`);

    const report = {
      url: redactUrl(args.url),
      mode,
      inspectionMode: args.cleanSmoke ? 'clean-production-smoke' : 'instrumented-evidence',
      state: args.state,
      seed: args.seed ?? null,
      budgetOverride: args.budgetOverride,
      screenshotPath,
      result,
      outboundRequests,
      consoleErrors,
      pageErrors,
      failures,
      passed: failures.length === 0,
    };
    await writeOutputAtomically(
      path.join(args.out, `${baseName}.json`),
      `${JSON.stringify(report, null, 2)}\n`,
    );
    console.log(JSON.stringify(report, null, 2));
    return failures.length === 0 ? 0 : 1;
  } finally {
    await browser?.close();
  }
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : '';
const invokedAsMain = invokedPath !== '' && existsSync(invokedPath)
  && realpathSync(invokedPath) === realpathSync(fileURLToPath(import.meta.url));
if (invokedAsMain) {
  main().then(
    (code) => { process.exitCode = code; },
    (error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    },
  );
}

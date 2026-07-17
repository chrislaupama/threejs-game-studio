import { expect, test } from '@playwright/test';
import { PNG } from 'pngjs';

async function blockOutboundRequests(page: import('@playwright/test').Page): Promise<string[]> {
  const outbound: string[] = [];
  await page.context().route('**/*', async (route) => {
    const value = route.request().url();
    const url = new URL(value);
    const local = ['127.0.0.1', 'localhost', '::1'].includes(url.hostname);
    const inProcess = ['about:', 'blob:', 'data:', 'file:'].includes(url.protocol);
    if (local || inProcess) await route.continue();
    else {
      outbound.push(value);
      await route.abort('blockedbyclient');
    }
  });
  return outbound;
}

type CanvasSample = {
  ok: boolean;
  reason: string;
  variance?: number;
  colorBuckets?: number;
};

async function sampleCanvas(page: import('@playwright/test').Page): Promise<CanvasSample> {
  const canvas = page.locator('#game-canvas');
  const box = await canvas.boundingBox();
  if (!box || box.width < 32 || box.height < 32) {
    return { ok: false, reason: 'canvas-too-small' };
  }

  const buffer = await canvas.screenshot();
  const png = PNG.sync.read(buffer);
  let min = 255;
  let max = 0;
  let alphaPixels = 0;
  const buckets = new Set<string>();
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
    buckets.add(`${r >> 4},${g >> 4},${b >> 4},${a >> 6}`);
  }

  const variance = max - min;
  return {
    ok: alphaPixels > 256 && (variance > 8 || buckets.size > 3),
    reason: 'sampled',
    variance,
    colorBuckets: buckets.size,
  };
}

test('renders a nonblank interactive game canvas', async ({ page }, testInfo) => {
  const outboundRequests = await blockOutboundRequests(page);
  const consoleErrors: string[] = [];
  const pageErrors: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error') consoleErrors.push(message.text());
  });
  page.on('pageerror', (error) => pageErrors.push(error.message));

  await page.goto('/');
  await expect(page.locator('#game-canvas')).toBeVisible();
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10);

  const runtime = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.renderer);
  expect(runtime).toMatchObject({ revision: '185', backend: 'webgl' });

  const sample = await sampleCanvas(page);
  expect(sample, JSON.stringify(sample)).toMatchObject({ ok: true });

  const before = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.player.position.z ?? 0);

  if (testInfo.project.name.includes('mobile')) {
    const stick = page.locator('#touch-stick');
    await expect(stick).toBeVisible();
    const box = await stick.boundingBox();
    expect(box).not.toBeNull();
    if (box) {
      const pointerId = 11;
      await stick.dispatchEvent('pointerdown', {
        pointerId,
        pointerType: 'touch',
        isPrimary: true,
        buttons: 1,
        clientX: box.x + box.width / 2,
        clientY: box.y + box.height / 2,
      });
      await stick.dispatchEvent('pointermove', {
        pointerId,
        pointerType: 'touch',
        isPrimary: true,
        buttons: 1,
        clientX: box.x + box.width / 2,
        clientY: box.y + box.height * 0.05,
      });
      await page.waitForTimeout(450);
      await stick.dispatchEvent('pointercancel', {
        pointerId,
        pointerType: 'touch',
        isPrimary: true,
        buttons: 0,
        clientX: box.x + box.width / 2,
        clientY: box.y + box.height * 0.05,
      });
    }
  } else {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(450);
    await page.keyboard.up('KeyW');
  }

  await expect
    .poll(async () => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.player.position.z ?? 0))
    .toBeLessThan(before - 0.3);

  const screenshot = await page.screenshot({ fullPage: true });
  await testInfo.attach(`${testInfo.project.name}-game`, {
    body: screenshot,
    contentType: 'image/png',
  });

  expect(consoleErrors).toEqual([]);
  expect(pageErrors).toEqual([]);
  expect(outboundRequests).toEqual([]);
});

test('pause and fail states recover through visible controls', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'State controls need one desktop run.');
  const outboundRequests = await blockOutboundRequests(page);
  await page.goto('/');
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 5);

  await page.locator('#pause-button').click();
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.state)).toBe('paused');
  await expect(page.locator('#state-title')).toHaveText('Game paused');

  await page.locator('#pause-button').click();
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.state)).toBe('playing');

  await page.locator('#mute-button').click();
  await expect(page.locator('#mute-button')).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#mute-button')).toHaveText('Sound off');

  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('failed'));
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.state)).toBe('lost');
  await expect(page.locator('#retry-button')).toBeVisible();

  await page.locator('#retry-button').click();
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.state)).toBe('playing');
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.score)).toBe(0);
  expect(outboundRequests).toEqual([]);
});

test('resize keeps the drawing buffer and camera projection in sync', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'One desktop resize pass is sufficient.');
  const outboundRequests = await blockOutboundRequests(page);
  await page.setViewportSize({ width: 960, height: 540 });
  await page.goto('/');
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 5);

  await page.setViewportSize({ width: 2200, height: 1200 });
  await expect
    .poll(() => page.evaluate(() => {
      const canvas = window.__THREE_GAME_DIAGNOSTICS__?.canvas;
      return canvas ? canvas.width * canvas.height : Number.POSITIVE_INFINITY;
    }))
    .toBeLessThanOrEqual(1920 * 1080 + 1920);

  await page.setViewportSize({ width: 640, height: 800 });
  await expect
    .poll(() => page.evaluate(() => {
      const diagnostics = window.__THREE_GAME_DIAGNOSTICS__;
      if (!diagnostics) return false;
      const { canvas, camera } = diagnostics;
      const expectedWidth = Math.floor(canvas.clientWidth * canvas.dpr);
      const expectedHeight = Math.floor(canvas.clientHeight * canvas.dpr);
      const expectedAspect = canvas.clientWidth / canvas.clientHeight;
      return (
        canvas.width === expectedWidth &&
        canvas.height === expectedHeight &&
        Math.abs(camera.aspect - expectedAspect) < 0.001
      );
    }))
    .toBe(true);
  expect(outboundRequests).toEqual([]);
});

test('WebGL context loss pauses and restores the owned loop', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'One desktop recovery pass is sufficient.');
  await page.goto('/');
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 5);

  const extensionAvailable = await page.evaluate(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('#game-canvas');
    const gl = canvas?.getContext('webgl2');
    const extension = gl?.getExtension('WEBGL_lose_context');
    if (!extension) return false;
    (window as typeof window & {
      __WEBGL_LOSE_CONTEXT__?: WEBGL_lose_context;
    }).__WEBGL_LOSE_CONTEXT__ = extension;
    extension.loseContext();
    return true;
  });
  test.skip(!extensionAvailable, 'WEBGL_lose_context is unavailable in this browser.');

  await expect(page.locator('.renderer-status')).toBeVisible();
  const stoppedFrame = await page.evaluate(
    () => window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0,
  );
  await page.waitForTimeout(250);
  const frameWhileLost = await page.evaluate(
    () => window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0,
  );
  expect(frameWhileLost - stoppedFrame).toBeLessThanOrEqual(1);

  await page.evaluate(() => {
    (window as typeof window & {
      __WEBGL_LOSE_CONTEXT__?: WEBGL_lose_context;
    }).__WEBGL_LOSE_CONTEXT__?.restoreContext();
  });

  await expect(page.locator('.renderer-status')).toBeHidden();
  await expect
    .poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0))
    .toBeGreaterThan(frameWhileLost + 5);
});

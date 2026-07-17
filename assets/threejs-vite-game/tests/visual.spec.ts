import type { Page } from '@playwright/test';
import { PNG } from 'pngjs';
import { REVISION as installedThreeRevision } from 'three';
import { expect, test } from './runtime-guard';

type CanvasSample = {
  ok: boolean;
  reason: string;
  luminanceRange?: number;
  colorBuckets?: number;
};

async function sampleCanvas(page: Page): Promise<CanvasSample> {
  const canvas = page.locator('#game-canvas');
  const box = await canvas.boundingBox();
  if (!box || box.width < 32 || box.height < 32) {
    return { ok: false, reason: 'canvas-too-small' };
  }

  const buffer = await canvas.screenshot();
  const png = PNG.sync.read(buffer);
  let minLuminance = 255;
  let maxLuminance = 0;
  let alphaPixels = 0;
  const buckets = new Set<string>();
  const stride = Math.max(1, Math.floor((png.width * png.height) / 4096));

  for (let pixel = 0; pixel < png.width * png.height; pixel += stride) {
    const offset = pixel * 4;
    const r = png.data[offset];
    const g = png.data[offset + 1];
    const b = png.data[offset + 2];
    const a = png.data[offset + 3];
    if (a > 0) {
      alphaPixels += 1;
      const luminance = r * 0.2126 + g * 0.7152 + b * 0.0722;
      minLuminance = Math.min(minLuminance, luminance);
      maxLuminance = Math.max(maxLuminance, luminance);
    }
    buckets.add(`${r >> 4},${g >> 4},${b >> 4},${a >> 6}`);
  }

  const luminanceRange = maxLuminance - minLuminance;
  return {
    ok: alphaPixels > 256 && luminanceRange >= 12 && buckets.size >= 8,
    reason: 'sampled',
    luminanceRange,
    colorBuckets: buckets.size,
  };
}

async function holdTouchStick(
  page: Page,
  pointerId: number,
  xRatio: number,
  yRatio: number,
): Promise<void> {
  const stick = page.locator('#touch-stick');
  await expect(stick).toBeVisible();
  const box = await stick.boundingBox();
  expect(box).not.toBeNull();
  if (!box) return;

  const centerX = box.x + box.width / 2;
  const centerY = box.y + box.height / 2;
  const targetX = box.x + box.width * xRatio;
  const targetY = box.y + box.height * yRatio;
  await stick.dispatchEvent('pointerdown', {
    pointerId,
    pointerType: 'touch',
    isPrimary: true,
    buttons: 1,
    clientX: centerX,
    clientY: centerY,
  });
  await stick.dispatchEvent('pointermove', {
    pointerId,
    pointerType: 'touch',
    isPrimary: true,
    buttons: 1,
    clientX: targetX,
    clientY: targetY,
  });
  await page.waitForTimeout(450);
  await stick.dispatchEvent('pointercancel', {
    pointerId,
    pointerType: 'touch',
    isPrimary: true,
    buttons: 0,
    clientX: targetX,
    clientY: targetY,
  });

  await expect
    .poll(() => page.locator('#touch-knob').evaluate((knob) => knob.style.transform))
    .toContain('0px');
}

test('renders a nonblank interactive game canvas', async ({ page }, testInfo) => {
  await page.goto('/');
  await expect(page.locator('#game-canvas')).toBeVisible();
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10);

  const runtime = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.renderer);
  expect(runtime, 'renderer diagnostics must be published').toBeDefined();
  expect(runtime?.backend).toBe('webgl');
  expect(runtime?.revision).toBe(installedThreeRevision);
  const revisionText = String(runtime?.revision ?? '').trim();
  expect(revisionText, 'THREE.REVISION must contain decimal digits only').toMatch(/^\d+$/);
  const revision = Number(revisionText);
  expect(Number.isSafeInteger(revision), `invalid THREE.REVISION: ${runtime?.revision}`).toBe(true);
  expect(revision, 'the scaffold requires Three.js r185 or newer').toBeGreaterThanOrEqual(185);

  const sample = await sampleCanvas(page);
  expect(sample, JSON.stringify(sample)).toMatchObject({ ok: true });

  const before = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.player.position);
  expect(before, 'player diagnostics must be published').toBeDefined();

  if (testInfo.project.name.includes('mobile')) {
    await holdTouchStick(page, 11, 0.95, 0.5);
  } else {
    await page.keyboard.down('KeyD');
    await page.waitForTimeout(450);
    await page.keyboard.up('KeyD');
  }

  await expect
    .poll(async () => page.evaluate((origin) => {
      const current = window.__THREE_GAME_DIAGNOSTICS__?.player.position;
      if (!current || !origin) return 0;
      return Math.abs(current.x - origin.x);
    }, before))
    .toBeGreaterThan(0.3);

  if (testInfo.project.name.includes('mobile')) {
    // Pointer cancellation must release the virtual stick, not merely redraw
    // its knob. Allow normal acceleration to decay, then prove lateral drift
    // has settled before sending the next intent.
    await page.waitForTimeout(250);
    const settledX = await page.evaluate(
      () => window.__THREE_GAME_DIAGNOSTICS__?.player.position.x ?? 0,
    );
    await page.waitForTimeout(250);
    const releasedX = await page.evaluate(
      () => window.__THREE_GAME_DIAGNOSTICS__?.player.position.x ?? 0,
    );
    expect(Math.abs(releasedX - settledX)).toBeLessThan(0.12);
  }

  const afterLateral = await page.evaluate(
    () => window.__THREE_GAME_DIAGNOSTICS__?.player.position,
  );
  expect(afterLateral, 'player diagnostics must continue after lateral movement').toBeDefined();

  if (testInfo.project.name.includes('mobile')) {
    await holdTouchStick(page, 12, 0.5, 0.05);
  } else {
    await page.keyboard.down('KeyW');
    await page.waitForTimeout(450);
    await page.keyboard.up('KeyW');
  }

  await expect
    .poll(async () => page.evaluate((origin) => {
      const current = window.__THREE_GAME_DIAGNOSTICS__?.player.position;
      if (!current || !origin) return 0;
      return Math.abs(current.z - origin.z);
    }, afterLateral))
    .toBeGreaterThan(0.3);

  const screenshot = await page.screenshot({ fullPage: true });
  await testInfo.attach(`${testInfo.project.name}-game`, {
    body: screenshot,
    contentType: 'image/png',
  });

});

test('pause, objective, and fail states recover through visible controls', async ({ page }) => {
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

  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('complete'));
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.state)).toBe('won');
  await expect.poll(() => page.evaluate(() => {
    const diagnostics = window.__THREE_GAME_DIAGNOSTICS__;
    return diagnostics ? diagnostics.complete && diagnostics.score === diagnostics.targetScore : false;
  })).toBe(true);
  await expect(page.locator('#state-panel')).toBeVisible();
  await expect(page.locator('#retry-button')).toBeVisible();

  await page.locator('#retry-button').click();
  await expect.poll(() => page.evaluate(() => {
    const diagnostics = window.__THREE_GAME_DIAGNOSTICS__;
    return diagnostics
      ? diagnostics.state === 'playing' &&
        !diagnostics.complete &&
        diagnostics.score < diagnostics.targetScore &&
        diagnostics.elapsed < 1 &&
        diagnostics.timeRemaining > 0
      : false;
  })).toBe(true);

  await page.evaluate(() => window.__THREE_GAME_TEST_HOOKS__?.setState('failed'));
  await expect.poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.state)).toBe('lost');
  await expect(page.locator('#state-panel')).toBeVisible();
  await expect(page.locator('#retry-button')).toBeVisible();

  await page.locator('#retry-button').click();
  await expect.poll(() => page.evaluate(() => {
    const diagnostics = window.__THREE_GAME_DIAGNOSTICS__;
    return diagnostics
      ? diagnostics.state === 'playing' &&
        !diagnostics.complete &&
        diagnostics.score < diagnostics.targetScore &&
        diagnostics.elapsed < 1 &&
        diagnostics.timeRemaining > 0
      : false;
  })).toBe(true);
});

test('focused controls own keyboard activation without restarting the run', async ({
  page,
}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'desktop-chrome',
    'Keyboard ownership needs one desktop-engine pass; touch controls have direct coverage.',
  );
  await page.goto('/');
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.elapsed ?? 0) > 0.5);

  const elapsedBeforeMute = await page.evaluate(
    () => window.__THREE_GAME_DIAGNOSTICS__?.elapsed ?? 0,
  );
  const muteButton = page.locator('#mute-button');
  await muteButton.focus();
  await muteButton.press('Enter');
  await expect(muteButton).toHaveAttribute('aria-pressed', 'true');
  await page.waitForTimeout(150);
  await expect
    .poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.elapsed ?? 0))
    .toBeGreaterThan(elapsedBeforeMute);

  const pauseButton = page.locator('#pause-button');
  await pauseButton.focus();
  await pauseButton.press(' ');
  await expect
    .poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.state))
    .toBe('paused');
  const elapsedWhilePaused = await page.evaluate(
    () => window.__THREE_GAME_DIAGNOSTICS__?.elapsed ?? 0,
  );
  await page.waitForTimeout(150);
  const elapsedAfterPause = await page.evaluate(
    () => window.__THREE_GAME_DIAGNOSTICS__?.elapsed ?? 0,
  );
  expect(Math.abs(elapsedAfterPause - elapsedWhilePaused)).toBeLessThan(0.05);
});

test('resize keeps the drawing buffer and camera projection in sync', async ({ page }) => {
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

import type { Page } from '@playwright/test';
import { expect, test } from './runtime-guard';

// Copy this file to tests/visual-regression.spec.ts when the game is stable
// enough for screenshot baselines. First run:
//   npx playwright test tests/visual-regression.spec.ts --update-snapshots
// Then compare:
//   npx playwright test tests/visual-regression.spec.ts
//
// REQUIREMENT: the game must implement window.__THREE_GAME_TEST_HOOKS__
// (see src/game/Game.ts installTestHooks and src/vite-env.d.ts). Without real
// hooks, baselines capture a live animating scene and every rerun diffs.
// prepareDeterministicScreenshot fails loudly if the hooks object is missing.

async function prepareDeterministicScreenshot(
  page: Page,
  stateName: string,
  reducedMotion = false,
) {
  await page.goto('/');
  await page.waitForFunction(() => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) > 10);
  await page.evaluate(() => document.fonts.ready);

  const missingHooks = await page.evaluate(() => {
    const hooks = window.__THREE_GAME_TEST_HOOKS__;
    const required = [
      'seed',
      'setState',
      'setPausedForScreenshot',
      'setReducedMotion',
      'hideDebugUi',
    ] as const;
    return required.filter((name) => typeof hooks?.[name] !== 'function');
  });
  if (missingHooks.length > 0) {
    throw new Error(
      `Missing deterministic test hooks: ${missingHooks.join(', ')}. Implement ` +
      '(seed/setState/setPausedForScreenshot/setReducedMotion/hideDebugUi) before ' +
      'enabling visual baselines — see the bundled references/visual-regression.md.',
    );
  }

  const frameBeforeFreeze = await page.evaluate(({ name, reduced }) => {
    const hooks = window.__THREE_GAME_TEST_HOOKS__;
    if (!hooks) throw new Error('__THREE_GAME_TEST_HOOKS__ disappeared during setup.');
    if (hooks.seed(12345) !== true) throw new Error('Seed request was rejected.');
    hooks.setReducedMotion(reduced);
    hooks.hideDebugUi(true);
    if (hooks.setState(name) !== true) throw new Error(`Unknown or rejected test state: ${name}`);
    hooks.setPausedForScreenshot(true);
    return window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0;
  }, { name: stateName, reduced: reducedMotion });

  await expect
    .poll(() => page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0))
    .toBeGreaterThan(frameBeforeFreeze + 1);
}

// State names must match the game's setState implementation. The scaffold
// supports 'active-play', 'paused', 'complete', and 'failed'; add baselines for
// your game's own menus, encounters, and boss phases as you implement them.

for (const reducedMotion of [false, true]) {
  test(`active play visual baseline (${reducedMotion ? 'reduced' : 'normal'} motion)`, async ({ page }, testInfo) => {
    await prepareDeterministicScreenshot(page, 'active-play', reducedMotion);
    await expect(page).toHaveScreenshot(
      `active-play-${reducedMotion ? 'reduced' : 'normal'}-${testInfo.project.name}.png`,
      {
        animations: 'disabled',
        caret: 'hide',
        fullPage: true,
        // Start exact. Relax only to a repeated-run, mutation-tested pixel count.
        maxDiffPixels: 0,
      },
    );
  });
}

test('complete state visual baseline', async ({ page }, testInfo) => {
  await prepareDeterministicScreenshot(page, 'complete');
  await expect(page).toHaveScreenshot(`complete-${testInfo.project.name}.png`, {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
    maxDiffPixels: 0,
  });
});

test('paused state visual baseline', async ({ page }, testInfo) => {
  await prepareDeterministicScreenshot(page, 'paused');
  await expect(page).toHaveScreenshot(`paused-${testInfo.project.name}.png`, {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
    maxDiffPixels: 0,
  });
});

test('failed state visual baseline', async ({ page }, testInfo) => {
  await prepareDeterministicScreenshot(page, 'failed');
  await expect(page).toHaveScreenshot(`failed-${testInfo.project.name}.png`, {
    animations: 'disabled',
    caret: 'hide',
    fullPage: true,
    maxDiffPixels: 0,
  });
});

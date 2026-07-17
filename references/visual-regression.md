# Visual Test Harness

## Contents

- When to add or skip baselines
- High-value states and determinism contract
- Playwright pattern, local-asset checks, and reporting

Use this reference when a Three.js game warrants visual regression testing,
baseline screenshots, repeated release checks, imported-local-asset
verification, or UI overlap/text-fit regression protection.

Do not add screenshot baselines for every prototype. Use a harness when the visual state is valuable enough to protect and deterministic enough to compare.

Research basis: Playwright supports `expect(page).toHaveScreenshot()` for visual comparisons, device emulation for desktop/mobile projects, screenshot thresholds such as max diff pixels/ratio, and test artifacts/traces. Three.js exposes renderer diagnostics through `WebGLRenderer.info`. Existing canvas pixel checks are good smoke tests, but they do not replace screenshot baselines for polished screens.

## When To Add A Visual Harness

Add or extend a visual harness when:

- The user asks for polished, premium, showcase, release-ready, or "less basic"
  quality.
- HUD/menu layout or responsive text fit has regressed before.
- Important imported local assets must be proven visible in-game.
- A visual style, level, vehicle, table, arena, or boss scene is important enough to protect.
- You need desktop/mobile active-play evidence on every release.
- The game has deterministic states or can expose test hooks to freeze randomness, camera, time, and particles.

Skip or defer baseline screenshots when:

- The game is still an exploratory prototype.
- The scene is intentionally random and cannot be seeded quickly.
- Particles/camera/noise dominate the image and masking would hide the useful assertion.
- The only need is "is the canvas nonblank"; use the canvas inspector instead.

Even when skipped, report the skip reason.

## Harness States

Prefer 2-5 high-value states:

- `active-play-desktop`: player, objective, threat, reward, HUD visible.
- `active-play-mobile`: same as above under mobile viewport/touch controls.
- `pause-or-settings`: menu layout, safe areas, text fit.
- `fail-or-retry`: failure feedback and restart affordance.
- `hero-or-imported-asset`: hero/imported local asset in real lighting and
  active camera distance.

Avoid title-only screenshots unless title/menu work is the actual change.
Capture the complete game shell (canvas plus HUD, menus, touch controls, safe
areas, and player-facing error/loading UI), not the canvas alone. A separate
canvas-only baseline can help isolate renderer changes, but it cannot prove the
shipped composition or responsive UI.

## Determinism Requirements

Scaffold-generated games ship a working implementation of these hooks (`src/game/Game.ts` `installTestHooks`, typed in `src/vite-env.d.ts`) plus a seeded RNG in `src/utils/random.ts`. Keep the hooks real as the game evolves — the template fails loudly if the hooks object is missing, because silent no-op hooks capture live animating scenes and every rerun diffs. For non-scaffold games, implement the same contract:

```ts
window.__THREE_GAME_TEST_HOOKS__ = {
  seed(value: number) { return true; },
  setState(name: string) { return true; },
  setPausedForScreenshot(paused: boolean) {},
  setReducedMotion(enabled: boolean) {},
  hideDebugUi(hidden: boolean) {},
};
```

`seed()` and `setState()` return `true` only after accepting the request; an
unknown state or rejected seed returns `false`. Inspectors and baseline setup
must fail when that acknowledgement is missing instead of labeling a live or
unchanged scene as the requested state.

Before taking baselines:

- Seed random generation.
- Pause or stabilize particle/noise systems.
- Freeze camera shake, hit stop, and time-dependent post effects.
- Hide debug overlays and FPS meters unless the test covers diagnostics.
- Wait for fonts, GLTFs, textures, audio decode blockers, and first frames.
- Use fixed viewport/device profiles.
- Mask known dynamic UI only if the masked area is not part of the acceptance criteria.

Keep **normal motion** and **reduced motion** as separate contracts. The normal
baseline must set `setReducedMotion(false)` and freeze the effect at a named,
deterministic phase; the accessibility baseline sets it to `true` and proves
the alternate presentation. Never make reduced motion the only active-play
baseline, because that can hide missing trails, anticipation, shake fallbacks,
or transition timing in the default experience.

## Playwright Pattern

Use the project's existing Playwright setup. Generated games include `tests/visual-regression.template.ts` as an optional starting point. Copy it to `tests/visual-regression.spec.ts` when the project is ready for baselines.

Suggested commands after copying:

```bash
npx playwright test tests/visual-regression.spec.ts --update-snapshots
npx playwright test tests/visual-regression.spec.ts
```

Use thresholds carefully:

- Generate and compare baselines on a declared OS, browser build, viewport,
  device scale factor, renderer/backend, font set, and GPU class. Keep separate
  baselines when those inputs are intentionally different.
- First run the unchanged capture repeatedly. Start at an exact comparison and
  increase only enough to cover measured platform noise. Prefer a small
  `maxDiffPixels` allowance for isolated raster noise over a large whole-image
  ratio.
- Calibrate the upper bound with a deliberate regression (for example a
  missing HUD icon, shifted safe area, or hidden hero) and prove the comparison
  fails. A threshold that accepts that mutation is invalid.
- Do not apply one blanket threshold to every state. Stable UI/menu states
  should be near exact; measured WebGL raster noise may justify a narrowly
  documented allowance for the canvas region.
- Never raise a threshold merely to make a flaky run green. Remove the source
  of nondeterminism, split incompatible environments, or report the harness as
  blocked.

## Asset Visibility Checks

For imported local assets:

- Assert the asset path is loaded or listed in diagnostics.
- Capture screenshot with the asset in active gameplay, not isolated in a showroom.
- Check scale, orientation, bounds, material readability, and collision proxy through diagnostics or visible state.
- Keep source-machine paths and non-local URLs out of baseline paths and client
  code.

## Report Requirements

Report:

- Visual harness decision: added / extended / skipped.
- States covered.
- Determinism hooks used.
- Desktop/mobile projects covered, including normal- and reduced-motion state.
- Screenshot update command and compare command.
- Baseline artifact paths.
- Full-shell versus canvas-only coverage.
- Repeated-run noise, thresholds/masks, and the deliberate regression used to
  prove each threshold is strict enough.
- Remaining flake risks.

## Richer Playwright Recipe

```ts
import { test, expect, devices, type Page } from '@playwright/test';

async function stabilize(page: Page, reducedMotion: boolean): Promise<void> {
  await page.goto('/');
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__ !== undefined);
  await page.evaluate(async (reduced) => {
    await document.fonts.ready;
    const hooks = window.__THREE_GAME_TEST_HOOKS__!;
    if (hooks.seed(7) !== true) throw new Error('Seed was not accepted');
    hooks.setReducedMotion(reduced);
    hooks.hideDebugUi(true);
    if (hooks.setState('active-play') !== true) throw new Error('State was not accepted');
    hooks.setPausedForScreenshot(true);
  }, reducedMotion);
  // Let the fixed state, resize observers, and HUD styles reach the screen.
  await page.evaluate(() => new Promise<void>((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
  }));
}

test.describe('visual baselines', () => {
  test.use({ ...devices['Desktop Chrome'] });

  for (const reducedMotion of [false, true]) {
    test(`active-play desktop (${reducedMotion ? 'reduced' : 'normal'} motion)`, async ({ page }) => {
      await stabilize(page, reducedMotion);
      await expect(page).toHaveScreenshot(
        `active-play-desktop-${reducedMotion ? 'reduced' : 'normal'}.png`,
        {
          // Start exact; relax only to a measured, mutation-tested allowance.
          maxDiffPixels: 0,
          animations: 'disabled',
        },
      );
    });
  }
});

test.describe('mobile active-play', () => {
  test.use({ ...devices['iPhone 13'] });

  for (const reducedMotion of [false, true]) {
    test(`active-play mobile (${reducedMotion ? 'reduced' : 'normal'} motion)`, async ({ page }) => {
      await stabilize(page, reducedMotion);
      await expect(page).toHaveScreenshot(
        `active-play-mobile-${reducedMotion ? 'reduced' : 'normal'}.png`,
        {
          maxDiffPixels: 0,
          animations: 'disabled',
        },
      );
    });
  }
});
```

Store baselines under the Playwright snapshot directory. Re-record only after
intentional art or layout changes; never raise thresholds to hide flakes. Run
the compare at least twice from clean page loads before accepting a new
baseline, and review the entire diff artifact rather than only the exit code.

# Bot Playtest

Automated playtests drive the game through scripted real input and measure basic
functional signals: objective progression, input response, softlock windows,
and error-free runtime. A passing script proves a reproducible smoke path, not
human comprehension, fun, or fairness. Pair it with active human play for any
quality claim.

## Prerequisites

- Run `npm run setup:browsers` once on a fresh machine so the project-local
  Playwright version has its matching Chromium binary.
- `window.__THREE_GAME_DIAGNOSTICS__` publishing frame, score/objective, complete/fail state, and player position every update.
- `window.__THREE_GAME_TEST_HOOKS__` with at least `seed()` and `setState()` so runs are reproducible (scaffold games ship both).
- All gameplay randomness routed through the seeded RNG — otherwise bot metrics are noise.

## Setup

Copy the packaged template and adapt it:

```bash
cp tests/bot-playtest.template.ts tests/bot-playtest.spec.ts
npm run test -- tests/bot-playtest.spec.ts
```

Adapt `INPUT_SCRIPT` to the game's controls and level layout: an endless runner bot holds forward and switches lanes on a cadence; an arena game sweeps the play space; a tower defense bot places affordable towers via test hooks and starts waves. Game-specific hooks (e.g. `forceWave()`, `buildFirstOpenPad()`) are encouraged for genres where raw keyboard input cannot express the core verb.

## Metrics And What They Mean

- `framesAdvanced` — the loop survived the whole run; a stall here is a crash or frozen loop.
- `distanceTravelled` — input responsiveness; near-zero under held keys means broken input mapping.
- `scoreAfter - scoreBefore` and `stepOfFirstScore` — objective progression and how quickly a naive player finds it. If a scripted sweep never scores, the objective is unreachable, unreadable, or broken.
- `softlockWindows` — sampling windows where frames advanced but held input produced neither motion nor progress. Repeated windows indicate stuck-on-geometry, dead input states, or unrecovered fail states.
- Time-to-first-fail (games with fail states) — add a scripted "reckless" run that seeks hazards and assert the fail state triggers and the retry path restores play; a game that cannot be failed has no pressure, and a fail state that cannot be retried is a release blocker.
- Console/page errors — must be empty for the full run.

## Headless WebGL Caveats

- Start Playwright WebGL suites with `workers: 1` (the scaffold does). Multiple
  concurrent GPU contexts can contend for driver or software-rendering
  resources and make wall-time tests flaky. Increase workers only after proving
  isolation on the target CI runner.
- Never assume headless Chromium uses SwiftShader, and never use an unprobed
  headless FPS as device-performance evidence. Capture the actual WebGL
  vendor/renderer/version string when available, label masked results, and use
  a known real-GPU headed/device run for performance claims.
- Prefer state predicates, frame counters and bounded polling over exact
  wall-clock waits. Headless functional timing is useful for softlock detection,
  not for claiming frame-rate quality.

## Difficulty Signals

When difficulty, pacing, or fairness is being tuned or claimed, run two
deterministic scripts with meaningfully different reaction delays and compare
survival/progression. Treat the result as a tuning signal only. Confirm
fairness, readability, and fun through human play; bot similarity or divergence
does not prove a player-facing conclusion by itself.

## Reporting

Include in the QA evidence: the JSON report attachment (steps, frames, score progression, distance, softlock windows, errors), the seed used, and pass/fail per assertion. Report the bot playtest decision like the visual harness decision: added / extended / skipped with reason.

## Richer Playwright Recipe

```ts
import { test, expect } from '@playwright/test';

test('scripted arena sweep progresses score', async ({ page }) => {
  await page.goto('/');
  await page.waitForFunction(() => window.__THREE_GAME_TEST_HOOKS__ !== undefined);

  await page.evaluate(() => {
    window.__THREE_GAME_TEST_HOOKS__!.seed(42);
    window.__THREE_GAME_TEST_HOOKS__!.setState('active-play');
  });

  const before = await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.score);

  // Hold move-forward for a bounded number of animation frames, not wall clock alone.
  await page.keyboard.down('KeyW');
  await page.waitForFunction(
    (start) => (window.__THREE_GAME_DIAGNOSTICS__?.frame ?? 0) >= start + 120,
    await page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__!.frame),
  );
  await page.keyboard.up('KeyW');

  const after = await page.evaluate(() => ({
    score: window.__THREE_GAME_DIAGNOSTICS__!.score,
    errors: (window as unknown as { __consoleErrors?: string[] }).__consoleErrors ?? [],
  }));

  expect(after.errors).toEqual([]);
  expect(after.score).toBeGreaterThanOrEqual(before);
});
```

Add a second "reckless" script that seeks hazards and asserts fail → retry
restores `playing`. Prefer frame counters from diagnostics over fixed
`waitForTimeout` for softlock detection.

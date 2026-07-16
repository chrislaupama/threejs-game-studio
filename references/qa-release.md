# QA And Release Checklists

## Contents

- Browser, interaction, visual, mobile, and performance QA
- Visual-harness and local-content checks
- Production preview and release evidence
- Report formats and common failures

Use this before calling a Three.js browser game complete, premium, release-ready, or fixed.

## Browser QA Matrix

Minimum meaningful QA:

- Dependencies installed or known.
- Installed `three` package version, `THREE.REVISION`, renderer class, and actual
  backend captured; live-doc examples are not assumed compatible without the
  version gate in `official-docs.md`.
- Build/typecheck passes.
- Dev or preview server opened at the correct URL.
- Console/page/network errors captured.
- Canvas nonblank and visually varied through pixel sampling.
- Desktop active-play screenshot.
- Mobile active-play screenshot when mobile is in scope.
- Main input path changes game state.
- Objective/progress path works.
- Fail/retry or pause/resume path works when relevant.
- Resize/orientation updates renderer, camera, post targets, picking, and HUD;
  drawing-buffer dimensions reflect the declared capped DPR policy.
- Teardown/remount stops the animation loop and removes listeners, controls,
  workers, mixers, audio, render targets, and owned GPU resources without
  duplicate updates or monotonic resource growth.
- A clean-load human play pass covers roughly two minutes or the full short
  session for broad/complete/release work.
- Recent or risky code paths triggered.
- Physics-heavy games: collision model, fixed timestep, body/collider count,
  collision/trigger path, high-speed tunneling check, and restart cleanup.
- HUD text fit, overlap, safe areas, and touch targets checked when UI changed.
- Renderer diagnostics captured when graphics complexity changed.
- Imported local asset paths, file sizes, source/license notes, and runtime load
  behavior checked when file-backed assets changed.
- Audio unlock, decode/load, loop cleanup, mute/volume, and main SFX triggers checked when audio changed.
- Visual test harness decision recorded when work is premium, release-ready,
  UI-heavy, local-asset-heavy, or likely to regress visually.

## Interaction QA

Test what a player actually does:

- Begin from a clean production-preview load with no preserved debug state.
- Start or resume.
- Move/aim/steer/jump/attack/boost as appropriate.
- Collect or score.
- Avoid or hit a hazard.
- Trigger a state change: combo, wave, checkpoint, damage, shield, fail, win.
- Pause and resume.
- Restart after fail.
- For physics games, verify bodies reset cleanly after restart and no stale bodies keep simulating.
- For audio, verify user-gesture unlock, main SFX triggers, ambience loop start/stop, pause/resume, restart cleanup, and mute/volume controls.
- Resize or rotate when responsive/mobile is in scope.
- Continue through the full short session or at least two representative
  minutes for broad work; do not treat a few automated inputs as playtesting.

Do not rely only on screenshots for gameplay changes.

## Visual QA

For polished/premium/showcase or "less basic" requests:

- Capture active-play screenshot before and after when possible.
- Use the visual scorecard.
- Check for automatic failures:
  - primitive-dominant active screenshot
  - flat plane/box skyline world
  - generic stat-card HUD
  - one repeated obstacle/reward silhouette
  - fog/glow/darkness hiding missing geometry
  - no renderer diagnostics
- Confirm UI and VFX do not obscure threats, rewards, player, or next decision.
- Confirm desktop and mobile framing both show the playable path.
- For imported local 3D assets, confirm models have correct scale, orientation,
  material readability, collision proxies, and animation clips in active play.
- Decide whether to add/extend visual regression baselines. If skipped, record why the scene is not deterministic, not valuable enough yet, or covered by smoke checks only.

## Visual Test Harness QA

When a visual harness is warranted:

- Add deterministic hooks or test setup for random seed, camera shake, particles, time, debug UI, and active state.
- Cover active desktop and active mobile screenshots when mobile is in scope.
- Cover changed HUD/menu/fail/imported-local-asset states.
- Use Playwright screenshot comparisons with deliberate thresholds.
- Keep canvas-pixel smoke and interaction tests; visual baselines are additional evidence.
- Report baseline update command, compare command, snapshot paths, masks, thresholds, and flake risks.

## Mobile QA

- Touch controls emit game intents.
- Pointer release/cancel/blur cannot leave controls stuck.
- Safe areas respected.
- Touch targets reachable and separated.
- Page scroll does not steal gameplay input.
- Orientation/resize preserves canvas and HUD.
- DPR/performance acceptable.
- Desktop input still works unless intentionally removed.
- UI remains readable on narrow screens.
- Test real mobile hardware when available; label emulation-only results.
- When audio is in scope, verify gesture unlock and resume after backgrounding
  on mobile Safari as well as the primary mobile browser when available.

## Performance QA

When draw calls, asset counts, shaders, shadows, post-processing, simulation,
collision, allocation, pooling, or any CPU/GPU hot path changed:

- Record renderer calls, triangles, geometries, textures.
- Record FPS/frame time if available.
- Record collision model, timestep, body count, collider count, active sensors,
  swept/substepped bodies, and known expensive colliders when physics changed.
- Note DPR cap and post/shadow settings.
- Check active gameplay, not only idle view.
- Compare before/after if performance work was requested.
- For intermittent spikes, compare the same event burst and report p50/p95/p99
  handler or frame time plus soak duration/cycles.
- Report any unmeasured risk honestly.

For renderer evidence, distinguish CPU frame time, GPU frame time, and display
refresh rate. FPS alone cannot identify a CPU or GPU bottleneck. Sample the same
camera, seed, active entity count, quality tier, DPR, shadows, and post stack
before comparing two runs.

## Release Checks

Before release-ready:

- Production build passes.
- Production preview/static server tested.
- Vite `base` and asset URLs match target host.
- Debug GUI, diagnostics overlays, verbose logs, and test shortcuts are gated or removed from player-facing release.
- Bundle and large assets reviewed.
- Runtime code and built output contain no remote service endpoints, tokens,
  network fallbacks, or non-local asset URLs.
- A browser route guard blocks non-loopback HTTP requests, service workers are
  disabled for the check, and remote WebSocket attempts are reported.
- Public assets load under static hosting assumptions.
- Browser support assumptions documented.
- Renderer/backend compatibility is explicit: WebGL-only GLSL/composer features
  have a WebGPU fallback or are declared unsupported, and WebGPU/TSL features
  are not silently claimed on the WebGL production path.
- Deployment command or static artifact location reported.
- Residual risks listed.

## Evidence Format

```text
QA result: pass/fail
Commands:
URL:
Three.js revision and renderer/backend:
Build/typecheck:
Unit/focused tests:
Production preview/base path:
Controls tested:
Screenshots/artifacts:
Console/page/network errors:
Canvas pixel check:
Desktop/mobile viewports:
Renderer/performance diagnostics:
Visual test harness:
Physics diagnostics:
Local asset/content evidence:
Audio evidence:
Issues found/fixed:
Residual risks:
```

## Bug Report Format

```text
Title:
Severity:
Reproduction steps:
Expected:
Actual:
Browser/viewport/device:
Console/page errors:
Screenshot/artifact:
Likely owner:
Suggested fix:
```

## Common Release Failures

- Testing dev server but shipping untested production build.
- Static host base path breaks assets.
- Debug UI visible to players.
- Mobile UI passes screenshot but controls do not work.
- Canvas is nonblank but wrong app is running on the port.
- Physics gameplay looks right visually but collision proxies, sensors, or restart cleanup were not tested.
- Screenshots are title/idle views instead of active play.
- Premium claim has no visual scorecard or renderer diagnostics.
- Remote URLs or network fallbacks accidentally shipped in runtime code.

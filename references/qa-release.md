# QA And Release Checklists

## Contents

- Browser, interaction, visual, mobile, and performance QA
- Visual-harness and local-content checks
- Production preview and release evidence
- Report formats and common failures

Use this before calling a Three.js browser game complete, premium, release-ready, or fixed.

## Browser QA Matrix

Declare the support matrix before testing. Replace versions with the exact
browser builds used; delete an out-of-scope row only with a product reason.
Emulation is useful layout/input evidence but does not replace the required
real-device row for a release claim.

| Row | OS/device | Browser | Input | Renderer/backend | Required evidence |
| --- | --- | --- | --- | --- | --- |
| Desktop primary | Declared Windows/macOS/Linux hardware | Current supported Chromium build | Keyboard + mouse/pointer | Production WebGL, or native WebGPU if shipped | Full interaction route, full-shell capture, errors/network, p50/p95/p99, renderer stats |
| Desktop compatibility | Each declared non-primary desktop OS | Supported Firefox and/or Safari build | Keyboard + mouse/pointer | Supported production path | Start/play/progress/fail-retry, resize, capture, errors |
| iOS mobile | Named real iPhone/iPad + OS | Mobile Safari build | Touch + orientation | Supported production path | Gesture/audio unlock, touch cancel, safe areas, rotate/background-resume, active capture, frame percentiles |
| Android mobile | Named real Android device + OS | Chrome build | Touch + orientation | Supported production path | Same mobile route, active capture, frame percentiles |
| WebGPU fallback | A declared WebGPU-capable desktop/device when WebGPU ships | Exact browser build | Primary input | Native WebGPU **and** forced/automatic supported fallback | Backend identity, feature parity/exceptions, validation/device-loss policy, captures and metrics for both |

Record pass/fail and artifact links per row. “Chrome tested” without OS,
version, device/GPU, input modality, renderer/backend, viewport/DPR, and quality
tier is not a matrix result.

Minimum meaningful QA for every applicable row:

- Dependencies installed or known.
- `npm run setup:browsers` completed on fresh machines before Playwright or
  canvas-inspector checks.
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
- Repeat score → highest-impact fix → build and real-input replay → recapture →
  remeasure until every applicable category and budget threshold passes, or
  report the exact blocker. A single subjective polish pass is not closure.

## Visual Test Harness QA

When a visual harness is warranted:

- Add deterministic hooks or test setup for random seed, camera shake, particles, time, debug UI, and active state.
- Cover the complete game shell (canvas, HUD, menus/touch UI, and safe areas),
  not only the canvas, for active desktop and active mobile.
- Capture normal motion and reduced motion as separate deterministic states;
  never use reduced motion as the only active baseline.
- Cover changed HUD/menu/fail/imported-local-asset states.
- Calibrate screenshot thresholds from repeated unchanged runs and prove each
  threshold rejects a deliberate layout/asset regression. Keep incompatible
  OS/browser/renderer baselines separate.
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
- Record frame time after warm-up as p50/p95/p99, missed-target-frame ratio,
  sample count/duration, and quality tier on every matrix row used for a
  performance claim. Average FPS alone hides spikes.
- Record collision model, timestep, body count, collider count, active sensors,
  swept/substepped bodies, and known expensive colliders when physics changed.
- Note DPR cap and post/shadow settings.
- Check active gameplay, not only idle view.
- Compare before/after if performance work was requested.
- For intermittent spikes, compare the same seeded event burst and report
  p50/p95/p99 handler/CPU/GPU time (clearly labeled) plus soak duration/cycles.
- Report any unmeasured risk honestly.

For renderer evidence, distinguish CPU frame time, GPU frame time, and display
refresh rate. FPS alone cannot identify a CPU or GPU bottleneck. Sample the same
camera, seed, active entity count, quality tier, DPR, shadows, and post stack
before comparing two runs.

## Graphics Failure And Recovery QA

- WebGL: only in a gated diagnostic build/route, call
  `renderer.forceContextLoss()`, prove the loop/input/audio pause, show the
  player-facing recovery state, call `forceContextRestore()`, and verify either
  safe resume or the documented restart path after assets, post targets,
  shadows, and dynamic resources exist. `WEBGL_lose_context` availability is
  not guaranteed; record a skip as unverified, not pass.
- WebGPU: exercise `renderer.onError` and `renderer.onDeviceLost` through an
  injectable diagnostic failure boundary, then verify simulation stops and the
  supported rebuild/reload UI works. Do not claim a synthetic callback proves
  real device-loss recovery; label actual device-loss evidence separately.
- After either path, confirm held input is cleared, frame timers/accumulators
  reset, audio state is coherent, no second loop/listener set appears, and
  renderer resource counts stabilize after repeated recovery cycles.

## Release Checks

Before release-ready:

- Production build passes.
- Production preview/static server tested.
- Vite `base` and asset URLs match target host.
- Debug GUI, diagnostics overlays, verbose logs, and test shortcuts are gated or removed from player-facing release.
- Mutation-capable globals such as `window.__THREE_GAME_TEST_HOOKS__` and rich
  `window.__THREE_GAME_DIAGNOSTICS__` exist only in a separately built QA
  artifact enabled by a compile-time environment flag. They must be absent
  from the ordinary production build; a query string or `localStorage` toggle
  is not a security boundary. If intentional production telemetry remains,
  expose only the documented read-only minimum and no state mutation hooks.
- Verify hook gating twice: scan the production bundle for hook names and load
  the normal production preview to assert the globals are `undefined`. Run
  inspectors/bots against the explicit diagnostics build, never by silently
  weakening the shipped artifact.
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
Support-matrix rows (OS/device/browser/version/GPU/input):
Build/typecheck:
Unit/focused tests:
Production preview/base path:
Controls tested:
Gameplay routes (start/progress/fail-retry/pause/resume):
Screenshots/artifacts (full shell; normal/reduced motion):
Visual diff environment/threshold/noise/mutation check:
Console/page/request/network/WebGPU errors:
Canvas pixel check:
Desktop/mobile viewports, DPR, drawing-buffer pixels, quality tier:
Renderer diagnostics and transient light/VFX peaks:
Performance p50/p95/p99, missed-frame ratio, sample duration:
Visual test harness:
Visual score iterations/applicability/automatic failures:
Context/device-loss recovery:
Physics diagnostics:
Local asset/content evidence:
Audio evidence:
Production hook/bundle gating:
Teardown/remount/soak evidence:
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

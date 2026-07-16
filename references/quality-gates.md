# Complete Game Quality Gates

## Contents

- First playable and technical baseline
- Design, gameplay, content, and visuals
- UI, input, audio, accessibility, and physics
- QA, claim tiers, and release

Use the matching sections before describing work as complete, polished,
premium, showcase, or release-ready.

## First Playable

- The first screen is the game or a deliberate start/pause state, not a landing
  page.
- Real input drives the primary verb within roughly five seconds unless a
  deliberate start/tutorial state explains the delay.
- Objective, pressure, reward/progression, and fail/retry exist when the genre
  calls for them.
- The first playable minute contains a meaningful decision and feedback event.
- Camera, controls, HUD, and local audio/VFX communicate the next decision.
- Build, browser, console/page errors, screenshot, and nonblank canvas pass.

## Three.js Baseline And Lifecycle

- The report records the installed package version, `THREE.REVISION`, renderer
  class, actual backend, and whether the path is WebGL, WebGPU, or XR.
- Every copied API was checked against the installed revision. WebGL
  `EffectComposer`/GLSL recipes and WebGPU `RenderPipeline`/TSL recipes are not
  mixed.
- One owner creates and tears down the renderer, animation loop, r185 `Timer`,
  active camera, resize observer/listener, loading manager, audio context, and
  asset cache.
- `renderer.setAnimationLoop(null)` stops rendering before disposal. Controls,
  mixers, event listeners, workers, render targets, geometries, materials,
  textures, skeletons, audio nodes, and the renderer are disposed by their
  declared owner.
- Canvas display size, drawing-buffer size, camera projection, post-processing
  targets, picking coordinates, and DOM overlay metrics stay correct after
  resize and orientation changes. DPR is capped and recorded.
- A development remount/restart does not create a second loop, duplicate input
  handler, stale physics body, repeated audio voice, or growing GPU resource
  count.

## Game Design And Level

- The brief names player promise, feeling, verbs, objective, pressure, reward,
  fail/retry, skill expression, and non-goals.
- The first space covers start, decision, threat, reward, landmarks,
  escalation, recovery, and failure readability.
- Routes, waves, enemies, and rewards create decisions rather than clutter.
- Difficulty maps to named tuning parameters and active playtests.
- Greybox scale and routes are proven before expensive detail.
- The matching contract in `genre-playbooks.md` passes when the game uses one
  of its covered genres; any deliberate deviation is explained by the design.

## Gameplay And Feel

- Input response, movement, camera, impact, feedback, and restart speed are
  tuned together.
- Core events have coordinated visual, local-audio, UI, and camera response.
- Shake, hitstop, flash, FOV punch, squash/stretch, and rumble are proportional
  and preserve readability/reduced-motion behavior.
- Rendering and UI remain live during gameplay hitstop.
- Randomness is seeded in gameplay and deterministic capture paths.

## Local Content

- Every meaningful runtime asset is procedural, project-local, or user-supplied.
- Broad work has a reviewed content-provenance inventory; static path checks are
  not treated as proof of how a local file was obtained.
- `scripts/audit_local_only.py` passes with no unapproved runtime package or network
  source.
- No remote fonts, models, textures, audio, scripts, APIs, MCP tools, analytics,
  or cloud runtimes are required.
- Production-preview browser QA blocks and reports non-loopback requests; the
  outbound-request list is empty.
- Imported local files have stable paths, axes, scale, bounds, collision,
  materials, clips, cost, and disposal checked.
- License/source notes exist for user-supplied third-party files.

## Visual Quality

- Forms read at active-play distance before small detail and post.
- Hero, threats, rewards, and world use authored silhouette and state language.
- Repeated content shares geometry/materials or uses instancing.
- Material roles vary color, roughness, metalness, emission, and detail
  coherently.
- Lighting, fog, VFX, and post have player-facing purpose and bounded cost.
- The post-disabled scene remains readable.
- Worst-case active state and real camera motion are inspected.
- Renderer diagnostics and target-vs-actual technical-art budget are reported.

For premium claims, fill every category in `quality-scorecard.md`; require every
category at least 2 and average at least 2.3. Showcase requires at least six
categories at 3, none below 2, and average at least 2.7. Review all automatic
failures and run the fresh-eyes pass against the complete capture set.

## UI, Input, Audio, Accessibility

- UI hierarchy matches player status, objective, immediate feedback, then
  flavor; it is not a generic dashboard.
- Gameplay, pause, settings, fail/retry, and win/milestone states exist when
  relevant.
- Text fits, dynamic numbers do not shift layout, and UI avoids the play path.
- Keyboard, pointer, touch, and gamepad paths emit shared intents when supported.
- Pointer cancel, blur, safe areas, target sizes, resize, and orientation pass.
- Audio unlock, buses, mute/volume, pause, restart, visibility, and disposal pass.
- Important information is not conveyed by color or audio alone.
- Reduced motion and intense flash/shake risks are addressed.

## Physics

- Engine/custom-collision choice and rationale are explicit.
- Fixed timestep, body/collider ownership, groups, sensors, swept/substep
  handling, and restart cleanup are explicit where applicable.
- Proxies remain simpler than visual meshes.
- Fast bodies, moving platforms, triggers, edge collisions, and low-FPS spikes
  are tested.
- Physics and rendered transforms have one synchronization owner.

## QA And Release

- Build and production preview pass.
- Installed Three.js revision, renderer/backend, color policy, DPR cap, and
  lifecycle/disposal evidence are captured in the release report.
- Correct URL/base path and every local asset path work in built output.
- Main input, objective, pressure, progression, fail/retry, pause, and restart
  are exercised as applicable.
- Broad/complete/release work includes a clean-load sustained human play pass
  of roughly two minutes or the full short session.
- Console/page errors are clean; canvas pixels and active captures pass.
- Desktop passes; mobile passes when in scope.
- Visual-regression decision is reported; release-ready gameplay has a bot
  playtest or a specific reason it could not run.
- Difficulty/fairness claims include two seeded bot routes with meaningfully
  different reaction delays plus human review.
- Debug panels, logs, test hooks, and shortcuts are hidden or deliberately gated.
- Bundle and large files are reviewed; no runtime network dependency remains.
- Unrun checks and residual risks are explicit.

If a requested gate fails, continue or name the blocker. Do not dilute the
meaning of polished, premium, showcase, complete, or release-ready.

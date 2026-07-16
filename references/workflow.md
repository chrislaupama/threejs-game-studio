# Complete Game Production Workflow

Use this reference at planning time for a new game, a major upgrade, a broad
polish pass, a premium/showcase claim, or release preparation. For a focused
fix, use the owning technical reference and proportionate QA instead.

## Contents

- Scope and completion modes
- Coordinator records
- Novice milestone ladder
- Nine production phases
- Change loop and completion gate

## Scope And Completion Modes

Name the intended deliverable before implementation:

| Mode | Deliverable | Minimum proof |
| --- | --- | --- |
| Learning checkpoint | One runnable concept with explanation | build + expected visual/behavior + next edit |
| Mechanic slice | One mechanic in the existing game | focused test + real input + regression check |
| Vertical slice | One representative, polished loop | start-to-end loop + art/feel/UI sample + budget |
| Complete short game | Every promised state and ending | full session + retry/next-run + content count |
| Premium/showcase | Complete game with high visual/feel bar | scorecard + dense-state metrics + fresh-eyes review |
| Release candidate | Production build ready for handoff | preview matrix + owned residual risks |

Do not silently replace a complete game with a vertical slice. If scope is too
large, reduce the number of mechanics, levels, enemies, or art families while
preserving a real beginning, escalation, ending, and replay/retry flow.

## Coordinator Records

Keep the records lightweight but explicit. Update them as evidence changes.

### Fact and decision ledger

```text
Three.js installed revision:
Documentation baseline checked:
Renderer: WebGLRenderer / WebGPURenderer
Post stack: direct / EffectComposer / RenderPipeline
Target browsers/devices:
World units and axes:
Camera contract:
Timing model: render delta / fixed simulation / interpolation
Input actions and devices:
Collision/physics model:
Asset formats and ownership:
Color-space and environment policy:
Quality tiers and render budgets:
Persistence/network scope:
Release target/base path:
```

### Phase ledger

```text
0 Discovery/version: pending | running | done | blocked — evidence:
1 Design/completion: pending | running | done | blocked — evidence:
2 Architecture/foundation: pending | running | done | blocked — evidence:
3 First playable: pending | running | done | blocked — evidence:
4 Content/world: pending | running | done | blocked — evidence:
5 Visual systems: pending | running | done | blocked — evidence:
6 Feel/UI/audio/accessibility: pending | running | done | blocked — evidence:
7 Performance/reliability: pending | running | done | blocked — evidence:
8 QA/release: pending | running | done | blocked — evidence:
```

### Content ledger

```text
Local content sources: procedural, project-local, user-supplied, and/or deferred
Hero/player:
Threats/enemies:
Rewards/interactables:
World kit and landmarks:
Sky/background/atmosphere:
Materials/textures/decals:
Animation:
UI/icons/fonts:
Music/SFX/ambience:
Provenance inventory:
```

For each imported item, record runtime path, source/license, file size, scale,
axes, pivot, bounds, clips, texture count/resolution, compression, collision
proxy, sharing, and teardown owner.

### Evidence ledger

```text
Build/typecheck:
Unit/focused tests:
Browser and URL:
Console/page/asset errors:
Canvas pixels and active screenshots:
Controls and input devices:
Objective, pressure, reward, failure, retry, ending:
Resize/orientation/mobile/safe-area:
Audio unlock/mute/pause/restart:
Renderer/physics/performance diagnostics:
Memory/disposal/re-entry:
Visual harness decision:
Bot playtest decision:
Production preview/base path:
Local-only static and live-request audits:
Checks not run and remaining risks:
```

Mark a phase done only after implementation and its exit evidence. A plan,
mockup, or code diff is not exit evidence by itself.

## Novice Milestone Ladder

For a learner, keep the project runnable at each milestone and explain what to
look for:

1. **Boot:** install, start Vite, show a correctly resized canvas.
2. **See:** scene, camera, mesh, light, and intentional color output.
3. **Move:** map keyboard/pointer/touch into one player action.
4. **Decide:** add a state machine and a visible objective.
5. **Collide:** separate render mesh from a simple gameplay collider.
6. **Play:** add pressure, reward, failure, and retry.
7. **Read:** add HUD, feedback, sound, loading/error, and pause.
8. **Author:** replace placeholders with a coherent hero/threat/world kit.
9. **Scale:** measure and optimize the worst active state.
10. **Ship:** production preview, browser QA, clean teardown, and handoff.

At each checkpoint provide the command, changed files, expected behavior, one
common failure and fix, and the next safe experiment. Do not dump an unexplained
framework on a novice.

## Phase 0: Discovery And Version Truth

Read `official-docs.md` and inspect:

- package manager, scripts, lockfile, installed `three` and type versions
- framework, entrypoint, renderer, camera, loop, state and resize owners
- official addon imports, post stack, shaders, loaders and local assets
- input devices, collision/physics, UI/audio, tests and debug hooks
- target devices, deployment/base path and offline/runtime constraints
- current console warnings, screenshots, performance metrics and known defects

Run `npm ls three` and obtain `THREE.REVISION`. For greenfield work, compare
the current stable npm version when network access exists. For existing work,
use the installed revision until an upgrade is explicitly in scope.

Choose one renderer path. Do not mix WebGL `ShaderMaterial`/`EffectComposer`
recipes with WebGPU TSL/`RenderPipeline` recipes.

Exit evidence: filled fact ledger, current run/build state, known entrypoints,
highest-risk path, and relevant references selected.

## Phase 1: Design And Definition Of Complete

Read `game-design.md` and the applicable section of `genre-playbooks.md`.
Define:

- player promise and target feeling
- primary and secondary verbs
- repeatable 5-30 second core loop
- objective, pressure, reward/progression, consequence and retry
- skill expression and readability promise
- first space/encounter: start, choice, threat, reward, landmark, escalation,
  recovery and failure explanation
- session length, content families/counts, progression arc and ending
- target inputs/devices, accessibility needs and performance tier
- explicit non-goals and definition of complete

Run the rejection tests: the first 30 seconds need a decision; the main
mechanic cannot be ignored; failure must be understandable; rewards must change
state or strategy; and the space must shape decisions.

Exit evidence: compact design brief, core-loop sentence, level/encounter plan,
content target, difficulty plan and completion definition.

## Phase 2: Architecture And Foundation

Read `fundamentals.md`, `gameplay-architecture.md`, `spatial-contracts.md`, and
the renderer-specific sections of `rendering.md` and `shaders.md`.

Establish one owner for renderer, active camera, animation loop, timer,
simulation, game state, input actions, resize, loading manager/cache, audio
context, UI bridge, diagnostics and teardown.

Choose and document:

- WebGL or WebGPU, post stack and shader language
- meters/world units, +Y up, forward convention and imported-model boundary
- variable presentation time and fixed simulation time where needed
- explicit state transitions and update order
- action-based input map with per-device source tracking
- camera mode and camera collision/occlusion approach
- collision proxies, layer/mask model and world-query contract
- local asset directories, cache rules, fallback/loading/error states
- material/color/environment policy and quality tiers
- per-subsystem disposal responsibilities

Add diagnostics early: revision/backend, game state, entity counts, player
transform/speed, input actions, renderer calls/triangles/geometries/textures,
physics counts/timestep, canvas size/DPR and current quality tier.

Exit evidence: compiling foundation, one rendering loop, resize, deterministic
test hooks, declared contracts and clean teardown path.

## Phase 3: First Complete Playable

Implement gameplay before deep polish:

- real input changes authoritative player state
- one challenge or threat creates pressure
- one reward or progress path advances the objective
- collision/triggers and game rules emit semantic events
- minimal HUD communicates objective and status
- fail/setback and retry restore all state cleanly
- one audio and one visual feedback event prove event integration
- seeded randomness makes the route reproducible

Use a fixed simulation step when contact, projectile speed, bounce, or fairness
depends on timing. Keep render geometry separate from collision proxies.

Exit evidence: build passes, canvas renders, real input works, objective
progresses, pressure occurs, reward changes state, and fail/retry completes.

## Phase 4: Content, World And Asset Integration

Read `geometry.md`, `materials-textures.md`, `loaders-animation.md`,
`local-assets.md`, `procedural-modeling.md`, and `visual-architecture.md` as
needed.

Build a small authored kit:

- hero with readable front/up/side, state sockets and motion language
- threats with distinct silhouette, anticipation and consequence
- rewards with desirable idle, collection and spent states
- play, near, middle, far and motion world layers
- landmarks, navigation/readability cues and reusable modular pieces
- shared material roles, texture/trim/decal strategy and environment source
- animation state map and clean transitions for animated characters
- simplified bounds, collision and LOD/instancing/batching strategy

Normalize local imports once. Never scatter arbitrary scale/rotation fixes
through entity code. Test an asset in motion, under the final camera and lights,
with its collider and teardown path.

Exit evidence: filled content ledger; no accidental placeholder dependence in
the active frame; import/provenance/bounds/clip/texture diagnostics.

## Phase 5: Visual Systems

Read `rendering.md`, `lighting-shadows.md`, `shaders.md`, and
`technical-art.md`. Improve in this order:

1. camera framing, screen occupancy and silhouette
2. decision-space readability and near/mid/far depth
3. authored proportion, geometry and surface hierarchy
4. material identity and correct color/data texture handling
5. environment, key/fill/rim/contact light and disciplined shadows
6. background, atmosphere and fog hierarchy
7. event-driven motion, particles, trails, impacts and state cues
8. renderer-appropriate post-processing with an on/off comparison

Write a render budget before costly work. Measure the worst active state, not
the menu. Keep bloom, depth of field, motion blur, SSR and heavy transparency
on a strict visual-purpose and performance budget.

Exit evidence: active before/after captures, post-disabled capture, renderer
diagnostics, target-versus-actual budget, dense-state check and mobile tradeoff.

## Phase 6: Feel, UI, Audio And Accessibility

Read `game-feel.md`, `ui.md`, `audio.md`, and `interaction.md`.

- Tune input response, acceleration/deceleration, turn/aim and recovery first.
- Map semantic events to proportional animation, VFX, camera, HUD, audio and
  optional rumble. Keep real, simulation and presentation clocks distinct.
- Build gameplay, pause, settings, loading/error, fail/retry, win/milestone and
  touch states from canonical game state.
- Use semantic buttons, keyboard focus, safe areas, readable touch targets,
  reduced motion, color-independent cues and text/caption alternatives.
- Unlock audio from a gesture; implement master/music/SFX/UI buses, mute,
  pause/resume, restart cleanup and bounded voices.

Exit evidence: relevant state captures, real UI/touch actions, text-fit and
safe-area checks, reduced-motion behavior, audio unlock/mute/pause/retry and no
duplicated game rules in presentation code.

## Phase 7: Performance, Reliability And Memory

Read `debugging-performance.md` and `technical-art.md`. Reproduce and measure
before editing. Record a named worst-case scenario, viewport/DPR, renderer/GPU,
quality tier, frame-time distribution, renderer counts and memory proxies.

Optimize one owner at a time:

- CPU: hot-loop allocations, search breadth, AI frequency, collision broadphase
- submission: shared resources, `InstancedMesh`, `BatchedMesh`, merging, pools
- geometry: visibility, frustum culling, LOD with hysteresis, far simplification
- pixel: DPR, shadow coverage/resolution, transparency/overdraw, post resolution
- textures: dimensions, formats, mipmaps, local KTX2, duplicate ownership
- lifecycle: stale listeners, controls, mixers, workers, render targets, audio

Re-measure the identical scenario. Test resize, visibility changes, pause,
restart, repeated enter/exit and failed asset loads. A higher FPS that breaks
readability, fairness or disposal does not pass.

Exit evidence: baseline and after metrics, identified bottleneck, retained
quality, memory/re-entry check and known device limits.

## Phase 8: QA, Release And Claims

Read `qa-release.md`, `visual-regression.md`, `bot-playtesting.md`, and quality
references when applicable.

Verify:

- production build/typecheck and focused tests
- production preview at the actual base path
- console/page/asset errors and nonblank canvas
- controls, objective, pressure, reward, failure, retry, ending and pause
- desktop composition; touch/orientation/safe-area when mobile is in scope
- audio gesture, mute, pause/restart and voice cleanup
- renderer/physics/performance diagnostics in a dense active state
- asset failure/retry and repeated teardown/re-entry
- deterministic harness states and visual-baseline decision
- scripted completion/softlock/difficulty decision
- local-only static audit and live outbound-request evidence
- licenses/provenance, debug gating and large-file/bundle review

For premium/showcase, score all categories against the packaged anchors, cite
measured evidence, list automatic failures, and obtain a fresh-eyes review. If a
gate fails, continue or report the exact blocker; do not rename the result.

Exit evidence: commands and pass/fail, URL, controls, screenshots/artifacts,
diagnostics, issues fixed, checks not run and owned residual risks.

## Implementation Change Loop

For every phase or focused change:

1. State the player-visible acceptance condition.
2. Reproduce or capture the baseline.
3. Identify the single owner to change.
4. Implement the smallest coherent change.
5. Run compile/unit checks immediately.
6. Exercise the real browser path and inspect errors.
7. Compare behavior and metrics to the baseline.
8. Update ledgers, tuning constants and disposal ownership.
9. Continue if the acceptance condition or requested quality label still fails.

## Completion Gate

Broad work is complete only when the promised loop is playable through real
input, its design/level contracts match implementation, the declared content
exists, UI/audio/feedback communicate state, resources have owners, the build
and production preview pass, and unrun checks are disclosed.

Premium/showcase work must additionally pass the quality scorecard and dense
state budgets. Release work must additionally prove the production URL/base
path, browser/device matrix, visual/bot decisions and residual-risk ownership.

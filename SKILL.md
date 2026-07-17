---
name: threejs-game-studio
description: "Plan, build, teach, upgrade, debug, optimize, test, and release professional Three.js browser games. Use for Three.js game work involving project setup, scene graphs, cameras, input, gameplay, collision or physics, local and procedural assets, PBR rendering, WebGLRenderer, experimental WebGPURenderer/TSL, post-processing, VFX, UI, audio, WebXR, performance, accessibility, playtesting, or release QA. Coordinates a local-first Vite and TypeScript workflow, loads renderer- and task-specific references, and verifies version-sensitive APIs against the installed Three.js runtime and current official documentation."
---

# Three.js Game Studio

Own the complete game outcome. Translate an idea into a scoped design, build a
playable loop, raise the whole active frame to a coherent quality bar, and prove
the result in a real browser. Do not stop at a rendered scene when the request is
for a game.

## Coordinate The Complete Game Outcome

Use this file as the control plane and the bundled `references/` as
progressive-disclosure manuals. Select the relevant manuals and phases from the
request and project evidence; do not make the user navigate the skill package.

### Common Failure Modes

Reject these outcomes before claiming progress or quality:

- A rendered scene or camera orbit presented as a game (no verb, objective, or retry).
- Architecture, material libraries, or post stacks before one playable loop works.
- Glow, bloom, fog, or particles used to hide weak forms or sparse worlds.
- Mixing WebGL GLSL/`EffectComposer` recipes with WebGPU TSL/`RenderPipeline` on one path.
- Quality or "done" claims without real browser evidence (build alone is not enough).

### Coordinator Steps

1. Classify delivery as tutorial or direct. Then choose the base work shape:
   focused or broad-production. Add the premium quality overlay for a
   polished/premium/showcase claim, and add the release evidence gate when the
   result is being shipped. These compose; tutorial delivery never reduces the
   required scope.
2. Inspect the project before prescribing architecture or dependencies.
3. Run the version and renderer decision gate. An explicit user renderer
   requirement takes precedence unless compatibility evidence proves it
   infeasible. Otherwise treat discovery as a provisional candidate, then
   finalize it after the relevant compatibility reference and, for a changed
   family, a minimal compile/browser spike.
4. Load `references/load-budgets.md`, then only the minimum refs for this scope
   (plus triggered refs). Do not preload premium/WebGPU/shader/release manuals
   before the playable loop is proven.
5. Keep design, decision, content, performance, and verification ledgers for
   broad work and any active premium or release gate. Focused work: reproduce → fix →
   proportionate QA with owning refs + `qa-release.md` — no full ledger ceremony.
6. Implement the smallest complete playable loop before expensive polish.
7. Integrate all phase output through one game state, one update order, and one
   lifecycle owner.
8. Verify the actual browser result; continue when a quality claim fails.

When parallel workers are available, delegate independent research,
implementation, art-system, and QA tasks with the exact relevant references.
Keep integration and final verification with the coordinator. Use another
specialized capability only when the task genuinely needs it.

## Official Documentation And Version Gate

Treat `references/official-docs.md` as mandatory for every task that creates,
upgrades, or changes Three.js API usage.

At discovery:

```bash
npm ls three
node -e "import('three').then((THREE) => console.log(THREE.REVISION))"
```

For a greenfield project, check the current stable package through the bounded
probe after dependencies exist:

```bash
npm --prefix <this-skill-dir> run probe:three -- <project>
```

The probe limits npm lookup time to 20 seconds. If npm is unavailable, record
the offline result, use the reproducible verified lockfile, and do not claim a
newer stable target until the networked check can be rerun.

Recipes in this package use **Three.js r185 as their verified baseline** (last
checked with npm `three@0.185.1`). The generated scaffold starts from that
reproducible lockfile; compare it with current stable and upgrade intentionally
when they differ. For an existing project, preserve its installed revision
unless an upgrade is in scope. Any revision other than the verified baseline
requires the matching
official migration notes, source/examples, build/typecheck, and browser proof;
do not assume “r185+” means future APIs are unchanged.

For a maintenance refresh, run `npm run audit:official-links`; keep this
networked link check separate from deterministic offline verification.

Use this authority order:

1. The project's installed `three` runtime revision and source.
2. Version-matching official Three.js API docs, manual, examples, and source.
3. Official release notes and migration guide.
4. The separately installed, community-maintained `@types/three` declarations
   as compile-contract evidence; align them with the runtime revision and
   document mismatches.
5. The bundled references and scaffold in this package.
6. Third-party examples only as inspiration; re-verify every API against 1-4.

Preserve an existing project's version unless the user asked for an upgrade or
the requested feature requires one. Never perform a wide revision jump as a
side effect of an unrelated fix.

If the installed revision differs from live docs or from skill last-check notes,
verify before copying APIs. When upgrading past recipes last verified against,
re-check migration notes, source/types, every used addon and renderer path, and
the full build/browser suite; do not treat skill text as frozen API law.

## Local-First Runtime Contract

Keep generated games self-contained by default:

- Use npm only for build-time installation. Bundle Three.js and official addons
  with the application; do not hotlink runtime modules from a CDN.
- Use project-owned, user-supplied, or procedurally authored local models,
  textures, fonts, and audio. Do not fetch remote runtime assets, analytics,
  hosted generators, provider SDKs, credentials, or cloud runtimes.
- Use Three.js and browser APIs for new runtime systems. Preserve historical
  project dependencies when removing them is outside scope, but do not add a
  runtime library silently.
- Keep official documentation links in the skill references; documentation
  links are research sources, not runtime dependencies.
- If the user explicitly requests networking, cloud saves, multiplayer, or a
  remote service, load `references/networking-boundary.md`, stop inventing
  netcode inside the render loop, and obtain explicit architecture approval.

For imported local content, read `references/local-assets.md` and record source,
ownership/license, runtime path, scale, axes, bounds, clips, texture cost, and
disposal ownership. Run
`npm --prefix <this-skill-dir> run audit:project-local -- <project>` before
release.

## Choose Delivery And Scope

Scope labels are additive where they describe different responsibilities. A
"premium game ready to release" is **broad-production workflow + premium
quality overlay + release evidence gate**. Premium is not a replacement for
building the complete loop, and release is not a replacement for either the
implementation or quality work. An audit-only release task may start at the
release gate only when the project already contains the promised completed
scope; missing product work reactivates the owning focused or broad workflow.

### Tutorial delivery

Use when the user wants to learn. Build a working result while explaining the
mental model, file locations, commands, and the reason for each important
choice. Define a term on first use. Keep code runnable after every milestone.
Do not replace implementation with a lecture. Pair tutorial delivery with the
actual scope: a beginner asking for a complete new game is tutorial +
broad-production, while a beginner asking about one raycast bug is tutorial +
focused.

### Focused scope

Use for a narrow defect, mechanic, renderer issue, asset import, UI state, or
performance bottleneck. Read the owning references plus `quickref.md` and
`references/qa-release.md` per `load-budgets.md`. Preserve unrelated behavior,
reproduce first, and run proportionate QA. Do not maintain full design/content
ledgers.

### Broad-production scope

Use for a new game, major upgrade, "complete", "polished", "premium",
"showcase", or "less basic" request. This is the base workflow for premium
work, not the premium gate itself. Read `references/load-budgets.md` then
`references/workflow.md`, execute every applicable phase, and keep the ledgers.
A broad request is not complete after a vertical slice unless the user
explicitly chose a slice.

A revision-only migration that preserves the renderer family, shader language,
post stack, and gameplay architecture may use the focused legacy-upgrade route.
A WebGL↔WebGPU renderer-family port, GLSL↔TSL rewrite, or post-processing
architecture port is broad-production work even when the request calls it an
"upgrade".

### Premium quality overlay

Activate this after a playable browser-proven loop exists whenever the request
claims polished, premium, showcase, or an equivalent quality bar. Add visual
architecture, rendering/VFX, technical-art budgets, active-state captures, and
the measured quality scorecard without abandoning the broad-production ledger.

A bounded "premium-feeling" or "premium-oriented" starter is an explicitly
limited broad scope with premium direction, not premium certification. Apply
the overlay to its delivered active states, report every unrun gate, and call it
premium-oriented until the complete scorecard passes; do not silently expand a
starter into release content or weaken an explicit request for a premium game.

### Release evidence gate

Use for release-ready, deployment-prep, or final QA. Exercise the production
build and preview, complete browser/mobile/accessibility/performance evidence,
make the visual-regression and bot-playtest decisions, and report every unrun
check. Enter after feature freeze; do not use release manuals as an up-front
substitute for the playable and premium work they are meant to verify.

## Novice-Safe Defaults

Choose these unless project evidence or the request demands otherwise:

- Vite + TypeScript + npm + `three` package imports.
- An explicit renderer choice in the request or an established project
  contract takes precedence over the generic defaults below. Preserve it
  unless it is unavailable or incompatible with a required feature; explain
  that conflict before proposing a renderer change.
- `WebGLRenderer` for the widest mature production path and straightforward
  tutorials.
- For a graphics-heavy or compute-heavy 3D site/game, offer the experimental
  `WebGPURenderer` as a first-class candidate when the target browsers,
  material/post stack, and measured workload fit it. Explain its status and
  WebGL 2 fallback, then benchmark against the mature WebGL path before the
  user commits to the renderer family.
- `PerspectiveCamera`, r185 `Timer`, and `renderer.setAnimationLoop()`.
- glTF 2.0 (`.glb`) through `GLTFLoader` for authored 3D assets.
- `MeshStandardMaterial` plus an intentional environment and light rig.
- Simple gameplay colliders separate from render meshes.
- DOM/CSS HUD and menus over the canvas.
- Pointer Events mapped into input intents; keyboard plus touch when mobile is
  in scope.
- Procedural Web Audio or local audio, unlocked by a user gesture.
- Capped device-pixel ratio, measured budgets, explicit disposal, deterministic
  test hooks, and a production-preview browser pass.

Explain deviations. Treat WebGPU as a first-class candidate for demanding 3D,
not a guaranteed speed switch: validate the actual WebGPU backend, the
WebGPURenderer's WebGL 2 fallback, and a preserved `WebGLRenderer` path only
when each is claimed. Unless the user supplied a renderer requirement,
discovery records only a provisional candidate; finalize after reading the
relevant renderer/shader compatibility reference and proving a minimal path in
the target browser. Use compressed-asset transcoders, custom shaders, XR, or
advanced post-processing as deliberate upgrades.

## Reference Router

### Fast decision tree

Use this before opening the full table. Then load only the budgeted refs.

- Blank or broken canvas → `references/debugging-performance.md`
- Controls or feel bad → `references/game-feel.md` + `references/interaction.md`
- Looks basic / premium ask → `references/visual-architecture.md` +
  `references/technical-art.md` + scorecard
- New game → `references/load-budgets.md` first-playable set + genre section
- Third-person action / chase, shoulder, free, or lock-on camera →
  `references/game-design.md` + **First-Person Or Third-Person Action** in
  `references/genre-playbooks.md` + **Third-Person Action Rig Contract** in
  `references/interaction.md`
- Revision-only old Three.js / CDN / global `THREE` migration →
  `references/upgrade-existing.md`; renderer-family/shader-architecture ports
  also activate broad-production workflow
- Import or asset issues → `references/local-assets.md` + `npm run audit:assets`
- Perception, patrol, pursuit, pathfinding, or crowds → `references/ai-navigation.md`
- Versioned saves, world streaming, workers, or local diagnostics →
  `references/production-runtime.md`
- Multiplayer / cloud / netcode ask → `references/networking-boundary.md` (stop)

### Detailed index

Read the listed file before making decisions or code in that area. Long files
have a contents section and copyable examples. Prefer `load-budgets.md` over
loading this entire table.

| Need | Required reference |
| --- | --- |
| Minimum refs per scope; hard defer rules | [load-budgets.md](references/load-budgets.md) |
| Legacy CDN / old-revision migration order | [upgrade-existing.md](references/upgrade-existing.md) |
| Multiplayer / cloud boundary (approval required) | [networking-boundary.md](references/networking-boundary.md) |
| Version-sensitive APIs, official sources, migration traps | [official-docs.md](references/official-docs.md) |
| One-page verified-baseline cheat sheet | [quickref.md](references/quickref.md) |
| Scene/camera/renderer/timer/resize/lifecycle fundamentals | [fundamentals.md](references/fundamentals.md) |
| Full production phases, ledgers, exit evidence | [workflow.md](references/workflow.md) |
| Player promise, core loop, level/encounter, progression, difficulty | [game-design.md](references/game-design.md) |
| Genre completion contracts | [genre-playbooks.md](references/genre-playbooks.md) |
| Module ownership, state, update order, input, camera, entities | [gameplay-architecture.md](references/gameplay-architecture.md) |
| Perception, steering, pathfinding, nav data, crowd scheduling | [ai-navigation.md](references/ai-navigation.md) |
| Reusable cross-system implementation patterns | [implementation-recipes.md](references/implementation-recipes.md) |
| Coordinates, axes, spaces, authoritative transforms, world queries | [spatial-contracts.md](references/spatial-contracts.md) |
| Geometry, procedural meshes, merging, instancing, batching | [geometry.md](references/geometry.md) |
| PBR materials, textures, UVs, color spaces, transparency, environments | [materials-textures.md](references/materials-textures.md) |
| Light selection, shadows, baking/fakes, environment and readability | [lighting-shadows.md](references/lighting-shadows.md) |
| Linear workflow, tone mapping, output transforms | [tone-mapping-color.md](references/tone-mapping-color.md) |
| Loading, compressed assets, animation mixers and state machines | [loaders-animation.md](references/loaders-animation.md) |
| Local asset intake, provenance, optimization, and ownership | [local-assets.md](references/local-assets.md) |
| Collision model, fixed step, sweeps, triggers, authored response | [physics.md](references/physics.md) |
| Responsiveness, hit feedback, shake, hitstop, camera kick, tuning | [game-feel.md](references/game-feel.md) |
| Procedural hero/enemy/reward/world construction | [procedural-modeling.md](references/procedural-modeling.md) |
| Art direction, material roles, world layers, VFX ownership | [visual-architecture.md](references/visual-architecture.md) |
| Hit sparks, trails, flashes, pooled sprites/points, GPU particles | [vfx.md](references/vfx.md) |
| CSS renderers, Line2, billboards, TransformControls handoff | [overlays.md](references/overlays.md) |
| Renderer setup, composition, color, fog, post, diagnostics | [rendering.md](references/rendering.md) |
| Experimental WebGPU decision, boot, fallback, TSL, compute, profiling | [webgpu.md](references/webgpu.md) |
| WebGL GLSL and WebGPU TSL/RenderPipeline recipes | [shaders.md](references/shaders.md) |
| Draw-call/triangle/texture budgets, LOD, pooling, culling, disposal | [technical-art.md](references/technical-art.md) |
| Versioned saves, chunk streaming, workers, local diagnostics | [production-runtime.md](references/production-runtime.md) |
| Cameras, raycasting, selection, pointer lock, gamepad, manipulation | [interaction.md](references/interaction.md) |
| HUD, menus, touch, responsive fit, accessibility, state wiring | [ui.md](references/ui.md) |
| Music/SFX/UI buses, spatial audio, unlock, pause/mute/disposal | [audio.md](references/audio.md) |
| WebXR renderer, controllers/hands, comfort, performance, QA | [webxr.md](references/webxr.md) |
| Blank canvas, runtime defects, asset errors, profiling | [debugging-performance.md](references/debugging-performance.md) |
| Deterministic states and screenshot comparisons | [visual-regression.md](references/visual-regression.md) |
| Scripted input, completion paths, softlocks, difficulty signals | [bot-playtesting.md](references/bot-playtesting.md) |
| Browser matrix, production preview, release evidence | [qa-release.md](references/qa-release.md) |
| Premium/showcase calibration and measured render budgets | [quality-scorecard.md](references/quality-scorecard.md), [quality-gates.md](references/quality-gates.md), [technical-art.md](references/technical-art.md), and `assets/scorecard-anchors/` |

## Broad Production Workflow

Use `references/workflow.md` for each phase's routes, ledgers, exit evidence,
and full gates. Preserve this dependency order:

1. **Discover and define complete.** Inspect the project, installed Three.js
   revision, renderer, loop, input, camera, state, assets, tests, devices, and
   release target. Record the design brief, core loop, content/session targets,
   ending, non-goals, and explicit definition of complete.
2. **Choose technical contracts.** Honor an explicit renderer requirement unless
   infeasible. Otherwise treat discovery as provisional, read the relevant
   compatibility reference, and compile/browser-spike a changed family before
   finalizing renderer/fallback; spatial, camera, simulation/timing, input,
   state, asset, color, quality, performance, loading/save, and disposal
   contracts.
3. **Build the smallest complete playable loop.** Make real input change
   canonical state; include objective, pressure, reward/progression, readable
   consequence, retry/next run, minimal HUD/audio/VFX, diagnostics, and browser
   input proof before deep polish.
4. **Establish content and art direction.** Plan and integrate a readable hero,
   threats, rewards, modular world kit, material roles, background layers, and
   collision proxies. Normalize imports once and replace placeholders across the
   active frame.
5. **Build visual systems in order.** Improve composition/silhouettes, depth,
   geometry, materials, environment/lighting, shadows, motion/VFX, then post.
   Compare post on/off; do not conceal weak form or art direction with effects.
6. **Add feel, UI, audio, and accessibility.** Drive response layers from
   semantic events; cover gameplay, pause, settings, loading/error, fail/retry,
   win/milestone, touch, focus, safe areas, reduced motion, color-independent
   cues, mute, and gesture unlock.
7. **Profile and scale.** Measure the worst active state and optimize its owner
   without sacrificing readability, fairness, feel, or lifecycle correctness.
8. **Verify and release.** Run build/typecheck, focused tests, production preview,
   browser/error/canvas/control/progression/fail-retry/resize/mobile checks, and
   record visual-regression and bot-playtest decisions. Premium claims also need
   measured scorecard evidence and a fresh-eyes pass.

## Architecture Invariants

- Preserve existing architecture unless evidence justifies a change.
- Keep one owner for the renderer, active camera, animation loop, timer,
  simulation clock, game state, resize, loading manager, audio context, asset
  cache, and teardown.
- Use `sample devices -> player/AI intents -> fixed movement +
  collision/physics -> game rules/events -> animation/VFX -> camera ->
  UI/audio bridge -> render` as the default update order. Scheduled AI sensing
  and decisions must publish intent before the step that resolves movement and
  contact.
- Convert device events into intents. Never make simulation depend directly on
  DOM event timing.
- Route gameplay randomness through a seeded generator. Keep screenshot and bot
  states deterministic.
- Separate authoritative game state, collision proxies, and visual meshes.
- Reuse vectors/quaternions/matrices in hot paths; pool short-lived entities and
  effects; share geometry, materials, and textures deliberately.
- Treat every listener, worker, mixer, control, render target, texture,
  material, geometry, skeleton, audio voice, and renderer as an owned resource
  with a teardown path.
- Keep debug/tuning/test hooks explicit and gated from production presentation.

## Verified-Baseline API Guardrails

Prefer current names; reject legacy aliases:

- Use `THREE.Timer`; do not introduce deprecated `THREE.Clock`.
- Prefer `renderer.setAnimationLoop()` as the renderer-owned loop. WebXR needs
  it; a manual `requestAnimationFrame()` WebGPU loop must first `await
  renderer.init()` and deliberately own session compatibility.
- Import official addons from `three/addons/...`.
- Use `renderer.outputColorSpace`, `texture.colorSpace`,
  `THREE.SRGBColorSpace`, and `THREE.LinearSRGBColorSpace`.
- Choose intentional tone mapping (`ACESFilmicToneMapping`, `AgXToneMapping`, or
  `NeutralToneMapping`) for lit PBR; do not leave games on default
  `NoToneMapping` without a reason. See `references/tone-mapping-color.md`.
- Prefer opaque canvases (`alpha: false`) plus opaque `Scene.background` /
  `setClearColor` unless HTML compositing or AR camera passthrough is required.
- Use `HDRLoader`, not the deprecated `RGBELoader` alias.
- On the verified r185 WebGL path, use soft `THREE.PCFShadowMap`, not deprecated
  `PCFSoftShadowMap`. On WebGPU, verify the installed revision: r185 still
  exposes `PCFSoftShadowMap`, while the next migration removes it.
- Use `BufferGeometryUtils.mergeGeometries()`, not
  `mergeBufferGeometries()`.
- Use `PointerLockControls.object`, not `getObject()`.
- Treat `Raycaster.firstHitOnly` as third-party behavior, never core Three.js.
- Use WebGL `EffectComposer` only on the WebGL path. Put linear/HDR effects
  before `OutputPass`; put display-referred passes that require sRGB input,
  such as FXAA, after it.
- Use WebGPU node materials/TSL and `THREE.RenderPipeline`; never combine
  WebGPU with `ShaderMaterial`, `RawShaderMaterial`, `onBeforeCompile()`, or
  `EffectComposer`.
- Bypass `RenderPipeline` while `renderer.xr.isPresenting` and render the scene
  directly. The pipeline temporarily disables XR; treat its node post-processing
  as a desktop/non-XR path unless an on-device-tested XR pipeline proves
  otherwise for the installed revision.
- Initialize WebGPU before renderer-dependent loader detection or eager renders.
- After WebGPU initialization, prefer current synchronous `render()`,
  `clear()`, `hasFeature()`, and `initTexture()` APIs. `computeAsync()` remains
  current; do not incorrectly classify every async Renderer method as
  deprecated—verify each method against the installed revision.
- Keep `FileLoader.load()` callback-driven; do not rely on a return value.

## Greenfield Scaffold

Create the packaged Vite + TypeScript + Three.js game from the verified r185
baseline, then reconcile it with the current stable package. Default genre is
the collect-and-avoid arena. Pass `--genre runner|shooter|platformer` to apply a
genre overlay on the shared ownership seams.

```bash
npm --prefix <this-skill-dir> install
npm --prefix <this-skill-dir> run create:game -- ./my-game
npm --prefix <this-skill-dir> run create:game -- ./my-runner --genre runner
cd ./my-game
npm ci
npm run setup:browsers
npm run dev
```

The generator refuses to overlay a non-empty directory. It copies the complete
`src/`, `public/`, and `tests/` starter plus `docs/game-report.md`,
`docs/content-provenance.md`, and the maintained revision, API, asset, report,
local-runtime, canvas, and ship-check scripts; it does not copy `node_modules`,
builds, test results, or caches. Generated commands include `dev`, `build`,
`preview`, `test`, `verify`, `verify:visual`, `verify:three`, `inspect:canvas`,
`audit:local`, `audit:apis`, `audit:assets`, `audit:report`, `probe:three`, and
`ship-check`.

Use it as a production teaching baseline, not a universal game design. Replace
the arena, objective, entities, tuning, and art direction while preserving
useful ownership and verification seams.

## Evidence And Completion Rules

After every meaningful change:

- Run the closest build/typecheck and focused tests.
- Exercise the changed behavior through real input when browser tools exist.
- Check console/page errors and local asset failures.
- Prove render work with a nonblank canvas and an active-state capture.
- Report browser, mobile, WebGPU, XR, audio, performance, visual, and bot checks
  that were not run.

For release or broad completion claims, prefer the unified ship check:

```bash
npm --prefix <this-skill-dir> run ship-check -- /path/to/game
```

The command builds and tests first, owns a temporary diagnostics-enabled
preview for deterministic evidence, then rebuilds and separately previews the
actual clean `dist` for a non-instrumented canvas/startup smoke. It always
terminates both previews; do not pre-start a server on its port.
Use `--skip-canvas` only when preview cannot run. That mode exits incomplete
rather than passing, so report the missing evidence. Pass `--premium` /
`--polished` through to the report auditor when those claims are made.

Broad work additionally requires the design contract, phase ledger, content
plan, controls, objective/fail-retry evidence, renderer revision/backend,
lifecycle/disposal evidence, and a sustained clean-load human play pass.

Polished, premium, and showcase work additionally requires measured evidence,
the complete active-state desktop/mobile capture set when mobile is in scope,
zero automatic visual failures, post-disabled readability, and a fresh-eyes
review. Premium also requires every scorecard category at least 2 and average
at least 2.3. Showcase requires at least six categories at 3, none below 2,
and average at least 2.7. A screen dominated by uncomposed primitives, generic
UI cards, sparse space, or glow-only detail does not pass.

Copy `assets/game-report.template.md` and audit an ordinary broad report:

```bash
npm --prefix <this-skill-dir> run audit:report -- /path/to/report.md
```

Use exactly one of `--polished`, `--premium`, or `--showcase` when that claim is
made. Add `--physics`, `--audio`, `--difficulty`, or `--no-design` only when
true for the task. Treat the script as a report-structure check, never proof
that cited artifacts or behavior exist.

## Final Response

Lead with the playable outcome. Report the design and scope contract when
applicable, controls, changed files, Three.js revision and renderer, run
command/URL, content strategy, verification commands/results, captures and
diagnostics, performance/physics/audio notes, quality gates, checks not run,
and remaining risks. Use plain language for novices and exact evidence for
quality claims.

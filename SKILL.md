---
name: threejs-game-studio
description: "Plan, build, upgrade, debug, optimize, test, and release complete Three.js browser games from a novice idea to a production-quality result. Use for any Three.js game or interactive 3D request involving project setup, scene graphs, cameras, controls, gameplay loops, state, collision, physics, procedural or local assets, geometry, PBR materials, textures, lighting, shadows, loaders, animation, shaders, TSL, WebGLRenderer, WebGPURenderer, post-processing, VFX, UI, touch, accessibility, Web Audio, WebXR, performance, visual QA, bot playtests, or release. This is the sole coordinator: it selects and loads its own bundled references, chooses safe defaults, sequences implementation, and verifies the player-facing outcome without requiring any other skill. Default to a local-first Vite, TypeScript, and Three.js workflow and verify API choices against the installed Three.js revision and current official documentation."
---

# Three.js Game Studio

Own the complete game outcome. Translate an idea into a scoped design, build a
playable loop, raise the whole active frame to a coherent quality bar, and prove
the result in a real browser. Do not stop at a rendered scene when the request is
for a game.

## Act As The Sole Coordinator

Use this file as the control plane and the bundled `references/` as
progressive-disclosure manuals. Never ask the user to choose manuals or phases.

1. Classify delivery as tutorial or direct, then classify scope as focused,
   broad-production, or release. Tutorial delivery never reduces the required
   scope.
2. Inspect the project before prescribing architecture or dependencies.
3. Run the version and renderer decision gate.
4. Load every reference required for the current phase before implementing it.
5. Keep design, decision, content, performance, and verification ledgers for
   broad work.
6. Implement the smallest complete playable loop before expensive polish.
7. Integrate all phase output through one game state, one update order, and one
   lifecycle owner.
8. Verify the actual browser result; continue when a quality claim fails.

When parallel workers are available, delegate independent research,
implementation, art-system, and QA tasks with the exact relevant references.
Keep integration and final verification with the coordinator. No additional
skill package is required or assumed.

## Official Documentation And Version Gate

Treat `references/official-docs.md` as mandatory for every task that creates,
upgrades, or changes Three.js API usage.

At discovery:

```bash
npm ls three
node -e "import('three').then((THREE) => console.log(THREE.REVISION))"
```

For a greenfield project, check the current stable package when network access
is available:

```bash
npm view three version
```

The authored and tested baseline for this skill is `three@0.185.1` (r185),
verified 2026-07-17. The live docs can move ahead of the latest npm release, so
never copy a current-doc API into an older installed project without checking
the official migration guide and the version-matching source/examples.

Use this authority order:

1. The project's installed `three` revision and its exported types.
2. Version-matching official Three.js API docs, manual, examples, and source.
3. Official release notes and migration guide.
4. The bundled references and scaffold in this package.
5. Third-party examples only as inspiration; re-verify every API against 1-3.

Preserve an existing project's version unless the user asked for an upgrade or
the requested feature requires one. Never perform a wide revision jump as a
side effect of an unrelated fix.

If npm stable is newer than this package's r185.1 tested baseline, state the
difference. For a reproducible novice build, keep the bundled exact baseline.
For a request that explicitly requires the newest stable release, pin that
release only after checking its migration notes, source/types, every used addon
and renderer path, and the full build/browser suite; do not merely change the
version string and call the bundled recipes current.

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
  remote service, identify the boundary and obtain the needed architecture and
  authority instead of disguising it as local functionality.

For imported local content, read `references/local-assets.md` and record source,
ownership/license, runtime path, scale, axes, bounds, clips, texture cost, and
disposal ownership. Run `scripts/audit_local_only.py <project>` before release.

## Choose Delivery And Scope

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
performance bottleneck. Read the owning references plus
`references/qa-release.md`,
preserve unrelated behavior, reproduce first, and run proportionate QA.

### Broad-production scope

Use for a new game, major upgrade, "complete", "polished", "premium",
"showcase", or "less basic" request. Read `references/workflow.md`, execute every
applicable phase, and keep the ledgers. A broad request is not complete after a
vertical slice unless the user explicitly chose a slice.

### Release scope

Use for release-ready, deployment-prep, or final QA. Exercise the production
build and preview, complete browser/mobile/accessibility/performance evidence,
make the visual-regression and bot-playtest decisions, and report every unrun
check.

## Novice-Safe Defaults

Choose these unless project evidence or the request demands otherwise:

- Vite + TypeScript + npm + `three` package imports.
- `WebGLRenderer` for the widest mature production path.
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

Explain deviations. Use WebGPU, TSL, compressed-asset transcoders, custom
shaders, XR, or advanced post-processing as deliberate upgrades, not automatic
complexity.

## Reference Router

Read the listed file before making decisions or code in that area. Long files
have a contents section and copyable examples.

| Need | Required reference |
| --- | --- |
| Current r185 APIs, official sources, migration traps | `references/official-docs.md` |
| Beginner mental model, scene/camera/renderer/timer/resize/lifecycle | `references/fundamentals.md` |
| Full production phases, ledgers, exit evidence | `references/workflow.md` |
| Player promise, core loop, level/encounter, progression, difficulty | `references/game-design.md` |
| Runner, racer, collect-and-avoid arena, shooter/action, platformer, survival, RPG, RTS, rhythm, tower defense, cue sport, golf, boss, puzzle | `references/genre-playbooks.md` |
| Module ownership, state, update order, input, camera, entities | `references/gameplay-architecture.md` |
| Reusable cross-system implementation patterns | `references/implementation-recipes.md` |
| Coordinates, axes, spaces, authoritative transforms, world queries | `references/spatial-contracts.md` |
| Geometry, BufferGeometry, procedural meshes, merging, instancing, batching | `references/geometry.md` |
| PBR materials, textures, UVs, color spaces, transparency, environment maps | `references/materials-textures.md` |
| Light selection, shadows, baking/fakes, environment and readability | `references/lighting-shadows.md` |
| LoadingManager, GLTF/DRACO/KTX2/Meshopt, animation mixers and state machines | `references/loaders-animation.md` |
| Local model, texture, font, audio intake, provenance, optimization, disposal | `references/local-assets.md` |
| Collision model, fixed step, sweeps, triggers, authored response | `references/physics.md` |
| Responsiveness, hit feedback, shake, hitstop, camera kick, tuning | `references/game-feel.md` |
| Procedural hero/enemy/reward/world construction | `references/procedural-modeling.md` |
| Art direction, material roles, world layers, VFX ownership | `references/visual-architecture.md` |
| Renderer setup, composition, color, fog, post, renderer diagnostics | `references/rendering.md` |
| WebGL GLSL/onBeforeCompile and WebGPU TSL/RenderPipeline recipes | `references/shaders.md` |
| Draw-call/triangle/texture budgets, LOD, pooling, culling, disposal | `references/technical-art.md` |
| Cameras, raycasting, selection, pointer lock, gamepad, manipulation | `references/interaction.md` |
| Third-person follow/orbit camera with collision and handoff | `references/implementation-recipes.md` and `references/interaction.md` |
| HUD, menus, touch, responsive fit, accessibility, state wiring | `references/ui.md` |
| Music/SFX/UI buses, spatial audio, gesture unlock, pause/mute/disposal | `references/audio.md` |
| WebXR renderer, controllers/hands, locomotion, comfort, performance, QA | `references/webxr.md` |
| Blank canvas, runtime defects, asset errors, profiling and optimization | `references/debugging-performance.md` |
| Deterministic states and screenshot comparisons | `references/visual-regression.md` |
| Scripted input, completion paths, softlocks, difficulty signals | `references/bot-playtesting.md` |
| Browser matrix, production preview, static release and evidence | `references/qa-release.md` |
| Premium/showcase calibration | `references/quality-scorecard.md`, `references/quality-gates.md`, and every image in `assets/scorecard-anchors/` |

## Broad Production Workflow

Use `references/workflow.md` for the full gates. The coordinator must preserve
this dependency order.

### 1. Discover and define complete

Inspect files, scripts, dependencies, installed Three.js revision, renderer,
loop, input, camera, state, assets, tests, target devices, and release target.
Write the design brief, core-loop sentence, first level/encounter plan, session
length, content counts, victory/ending condition, non-goals, and explicit
definition of complete.

### 2. Choose technical contracts

Declare WebGL or WebGPU; units and axes; camera style; simulation model;
fixed/variable timing; input intents; state machine; asset layout; color-space
policy; quality tiers; performance budgets; loading/error behavior; save scope;
and disposal ownership. Resolve these before features create competing owners.

### 3. Build the smallest complete playable loop

Make real input change canonical game state. Include an objective, pressure,
reward/progression, readable consequence, and fast retry or next-run flow. Add
minimal HUD/audio/VFX and diagnostics. Verify through actual input before deep
art work.

### 4. Establish content and art direction

Fill the local content plan. Build or integrate a readable hero, distinct
threats, desirable rewards, modular world kit, material roles, background
layers, and collision proxies. Normalize imported assets at one boundary.
Replace placeholders across the active frame, not only the hero object.

### 5. Build visual systems in dependency order

Improve composition and silhouettes, spatial depth, authored geometry,
materials, environment/lighting, shadows, motion/VFX, then post-processing.
Always compare post enabled/disabled. Do not use bloom, darkness, fog, or
particles to conceal weak geometry and art direction.

### 6. Add feel, UI, audio, and accessibility

Couple response layers to semantic game events. Implement gameplay, pause,
settings, loading/error, fail/retry, win/milestone, and relevant touch states.
Protect safe areas, keyboard focus, reduced motion, color-independent cues,
audio mute, and gesture unlock.

### 7. Profile and scale

Measure the worst active state. Optimize the measured owner: allocations,
draw calls, shader/material count, overdraw, shadows, post, texture memory,
geometry, physics, or DOM. Use sharing, pooling, `InstancedMesh`, `BatchedMesh`,
LOD hysteresis, culling, compressed local assets, and adaptive quality only
when they preserve readability and the intended feeling.

### 8. Verify and release

Run build/typecheck, focused tests, a local browser, console/page error checks,
nonblank-canvas inspection, real controls, objective progression, failure and
retry, resize, production preview, and mobile checks when in scope. Decide and
record visual-regression and bot-playtest coverage. For premium claims, fill
the scorecard with measured evidence and conduct a fresh-eyes pass.

## Architecture Invariants

- Preserve existing architecture unless evidence justifies a change.
- Keep one owner for the renderer, active camera, animation loop, timer,
  simulation clock, game state, resize, loading manager, audio context, asset
  cache, and teardown.
- Use `input -> fixed simulation -> game rules -> animation/VFX -> camera ->
  UI/audio bridge -> render` as the default update order.
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

## Current r185 Guardrails

Generate current APIs:

- Use `THREE.Timer`; do not introduce deprecated `THREE.Clock`.
- Use `renderer.setAnimationLoop()` for WebGL, WebGPU, and XR compatibility.
- Import official addons from `three/addons/...`.
- Use `renderer.outputColorSpace`, `texture.colorSpace`,
  `THREE.SRGBColorSpace`, and `THREE.LinearSRGBColorSpace`.
- Use `HDRLoader`, not the removed `RGBELoader` name.
- Use `THREE.PCFShadowMap`, not deprecated `PCFSoftShadowMap`.
- Use `BufferGeometryUtils.mergeGeometries()`, not
  `mergeBufferGeometries()`.
- Use `PointerLockControls.object`, not `getObject()`.
- Treat `Raycaster.firstHitOnly` as third-party behavior, never core Three.js.
- Use WebGL `EffectComposer` with `OutputPass` last only on the WebGL path.
- Use WebGPU node materials/TSL and `THREE.RenderPipeline`; never combine
  WebGPU with `ShaderMaterial`, `RawShaderMaterial`, `onBeforeCompile()`, or
  `EffectComposer`.
- Initialize WebGPU before renderer-dependent loader detection or eager renders.
- Keep `FileLoader.load()` callback-driven; do not rely on a return value.

## Greenfield Scaffold

Create the packaged Vite + TypeScript + Three.js r185 game. It includes a
playable collection loop, desktop/touch input, procedural audio, explicit
state, diagnostics, local-only request checks, Playwright smoke coverage, and
clean teardown.

```bash
python3 <this-skill-dir>/scripts/create_threejs_game.py ./my-game
cd ./my-game
npm install
npm run dev
```

The generator refuses to overlay a non-empty directory. It copies the complete
`src/`, `public/`, and `tests/` starter plus `docs/game-report.md`,
`docs/content-provenance.md`, and local audit/canvas-inspection scripts; it does
not copy `node_modules`, builds, test results, or caches. Generated commands are
`npm run dev`, `build`, `preview`, `test`, `verify:visual`, `inspect:canvas`, and
`audit:local`.

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
python3 <this-skill-dir>/scripts/audit_game_report.py /path/to/report.md
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

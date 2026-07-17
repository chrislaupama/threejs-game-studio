# Three.js Game Studio

A single, self-contained AI skill for planning, building, polishing, debugging,
optimizing, testing, and releasing complete browser games with Three.js.

The root `SKILL.md` is the sole coordinator. It inspects the project and Three.js
revision, chooses the WebGL or WebGPU path, translates novice ideas into safe
defaults, loads only the relevant internal reference chapters, sequences the
work from design through release, and requires browser evidence before making
quality claims.

## Current baseline

- Three.js r185 / `three@0.185.1`, verified 2026-07-17.
- Vite 8 and TypeScript 6 starter project.
- `THREE.Timer` and `renderer.setAnimationLoop()`.
- `WebGLRenderer` as the mature compatibility/teaching default.
- A first-class, typechecked `WebGPURenderer` + TSL + `RenderPipeline` route,
  recommended for evaluation on graphics-heavy and compute-heavy 3D work.
- Official addon imports from `three/addons/...`.
- Local-first runtime assets and browser verification.

Every task still begins by inspecting the installed Three.js revision. The live
documentation can move ahead of npm, so the skill checks version-matching APIs
and the official migration guide before changing an existing project.

## What is included

- A coordinator workflow for learning checkpoints, focused fixes, full games,
  premium/showcase passes, and release candidates.
- Beginner foundations for scene graphs, cameras, coordinates, transforms,
  timers, resizing, loading, errors, and disposal.
- Current renderer-specific guidance for WebGL/GLSL/EffectComposer and
  WebGPU/TSL/RenderPipeline without mixing incompatible recipes.
- A dedicated WebGPU playbook covering the heavy-3D decision, actual-backend
  reporting, WebGL 2 fallback semantics, node materials, compute, clustered
  lights, compressed textures, pipeline ownership, profiling, and release QA.
- Game design, genre completion contracts, state, input actions, camera rigs,
  collision, fixed simulation, AI/director patterns, game feel, UI,
  accessibility, Web Audio, and WebXR.
- Geometry, batching, instancing, LOD, glTF/compressed local assets, animation
  state machines, PBR, textures/color, lighting, shadows, shaders, VFX, and
  post-processing.
- Performance budgets, deterministic test hooks, canvas inspection, visual
  regression, bot playtesting, production-preview QA, evidence reports, and
  local-runtime audits.
- A runnable Vite + TypeScript mini-game scaffold with desktop/touch controls,
  procedural audio, pause/retry/win/fail states, diagnostics, Playwright tests,
  explicit teardown, and a compile-checked optional WebGPU renderer adapter.

Operational guidance lives in `SKILL.md` and `references/`. Reusable project
templates and the starter game live in `assets/`; validation and scaffold tools
live in `scripts/`.

## Install locally

Copy or clone this repository so `SKILL.md` remains at the skill root, then add
that local directory with the Skills CLI or copy it into your local Codex skills
directory.

```bash
npx skills add /absolute/path/to/threejs-game-studio
```

Start a new task and invoke `$threejs-game-studio`, or ask to build, upgrade,
debug, optimize, teach, or release a Three.js game.

## Create the starter game

```bash
python3 scripts/create_threejs_game.py ./my-game
cd ./my-game
npm install
npm run dev
```

The scaffold is a playable teaching and production baseline, not a fixed game
design. Replace its arena, entities, rules, tuning, art direction, and content
while preserving useful ownership and verification seams.

## Validate this package

```bash
python3 -m unittest discover -s scripts -p 'test_*.py'
python3 scripts/audit_skill_structure.py .
python3 scripts/audit_skill_local_only.py .
cd assets/threejs-vite-game
npm install
npm run build
npm run test
```

Before releasing a generated game, also run its `npm run audit:local`, production
preview, canvas inspection, and applicable browser/mobile checks.

## Documentation sources and attribution

Technical guidance is continuously checked against the official
[Three.js documentation](https://threejs.org/docs/),
[manual](https://threejs.org/manual/), and
[examples](https://threejs.org/examples/). Legal and research attribution is
kept separately in `NOTICE.md`; none of those sources is an operational skill
dependency.

Released under the MIT License.

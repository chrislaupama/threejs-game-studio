# Three.js Game Studio

![Three.js Game Studio — build complete WebGL and WebGPU browser games](assets/readme-header.png)

A single, self-contained AI skill for planning, building, polishing, debugging,
optimizing, testing, and releasing complete browser games with Three.js.

The root `SKILL.md` is the sole coordinator. It inspects the project and Three.js
revision, chooses the WebGL or WebGPU path, translates novice ideas into safe
defaults, loads only the relevant internal reference chapters, sequences the
work from design through release, and requires browser evidence before making
quality claims.

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
- Genre overlays (`arena` default, plus `runner`, `shooter`, `platformer`) via
  `create:game -- --genre`.
- Load budgets, upgrade/networking boundary manuals, golden evals, asset audit,
  and a unified `ship-check` release pipeline.

This skill targets **Three.js r185 and onwards**. Greenfield installs should use
current npm latest (`npm install three`); always verify APIs against the
project's installed revision, matching official docs/migration notes, and then
these recipes. Operational guidance lives in `SKILL.md` and `references/`.
Reusable project templates and the starter game live in `assets/`; npm-driven
TypeScript validation and scaffold tools live in `scripts/`.

## Install

Install directly from
[chrislaupama/threejs-game-studio](https://github.com/chrislaupama/threejs-game-studio):

```bash
npx skills add chrislaupama/threejs-game-studio
```

Start a new task and invoke `$threejs-game-studio`, or ask to build, upgrade,
debug, optimize, teach, or release a Three.js game.

## Create the starter game

From a repository checkout, install the TypeScript tooling once and create a
game through npm:

```bash
npm install
npm run create:game -- ./my-game
npm run create:game -- ./my-runner --genre runner
cd ./my-game
npm install
npm run setup:browsers
npm run dev
```

The scaffold is a playable teaching and production baseline, not a fixed game
design. Replace its arena, entities, rules, tuning, art direction, and content
while preserving useful ownership and verification seams.

## Validate this package

```bash
npm install
npm run verify
npm --prefix assets/threejs-vite-game install
npm --prefix assets/threejs-vite-game run setup:browsers
npm --prefix assets/threejs-vite-game run build
npm --prefix assets/threejs-vite-game test
npm run ship-check -- assets/threejs-vite-game --skip-canvas
npm run audit:assets -- scripts/fixtures
```

For a generated game, stop `npm run dev` with <kbd>Ctrl</kbd>+<kbd>C</kbd>
before running its tests—the Playwright suite owns its loopback server. Validate
the generated project with:

```bash
npm run setup:browsers
npm run build
npm test
npm run audit:local
npm run preview
```

Leave preview running and inspect it from a second terminal. Development and
preview intentionally share port `5188`, so the inspector needs no URL flag:

```bash
npm run inspect:canvas
npm run inspect:canvas -- --mobile
```

## Documentation sources and attribution

Technical guidance is continuously checked against the official
[Three.js documentation](https://threejs.org/docs/),
[manual](https://threejs.org/manual/), and
[examples](https://threejs.org/examples/). Legal and research attribution is
kept separately in `NOTICE.md`; none of those sources is an operational skill
dependency.

Released under the MIT License.

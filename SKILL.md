---
name: threejs-game-studio
description: "Build, upgrade, debug, optimize, verify, and release complete, deliberately scoped, local-first Three.js browser games from concept through polished release. Use for new Vite/TypeScript/Three.js games; playable-loop, level, encounter, camera, controls, collision, physics, game-feel, procedural-art, local GLB/FBX model and animation intake, material, shader, VFX, HUD, touch, Web Audio, performance, visual-QA, bot-playtest, and release work; or when a prototype looks basic, feels weak, performs poorly, or is not release-ready. Use Three.js, browser APIs, local development tools, procedural content, and project-owned or user-supplied local assets only. Never use MCP, hosted generators, provider SDKs, remote APIs, CDNs, analytics, cloud runtimes, credential probes, or network-fetched runtime assets."
---

# Three.js Game Studio

Own the complete player-facing result. Build the game, not a static scene; make
the first slice playable, then improve art, feel, interface, performance, and
release evidence without relying on external services.

## Local-Only Contract

Treat this contract as an invariant of this skill:

- Keep browser runtime code offline-capable. Do not add `fetch`, remote asset
  URLs, hosted fonts, CDNs, analytics, telemetry, auth, cloud saves, networked
  generation, or provider runtimes.
- Do not call MCP servers, hosted media generators, third-party APIs, provider
  SDKs, or credential probes during planning or implementation.
- Use Three.js and browser platform APIs at runtime. Vite, TypeScript,
  Playwright, and other local build/test tooling are allowed.
- Preserve an existing project's local dependencies when removal is outside
  scope, but do not add or expand another runtime library. Implement new
  collision, tweening, UI, and audio with Three.js and browser APIs.
- Source content from procedural Three.js geometry, `CanvasTexture`,
  `DataTexture`, SVG/Canvas/CSS, Web Audio synthesis, and project-owned or
  user-supplied local files. Read `references/local-assets.md` before importing
  models, textures, fonts, or audio.
- Never downgrade the requested quality merely because external generation is
  unavailable. Achieve a smaller, authored, cohesive, complete game through
  silhouette, modular construction, material roles, lighting, motion, and
  disciplined scope.
- If a request asks for MCP, hosted generation, analytics, cloud saves, or any
  other networked feature, name that conflict and keep it out of the work. Do
  not silently widen this skill's boundary; complete the compatible local game
  work or explain why the conflicting portion needs a different workflow.

Run `scripts/audit_local_only.py <project>` before release. A failing audit is
a blocker. For an existing project with non-Three runtime dependencies, save
its discovery-time `package.json` outside the working tree and pass it with
`--baseline-package-json`; the audit will allow only dependency names recorded
in that snapshot. This documents history and never authorizes adding a package.

When modifying this skill package itself, also run
`scripts/audit_skill_local_only.py <this-skill-dir>`. It rejects bundled
provider helpers, credential probes, MCP invocation syntax, network-client
imports, and non-local URLs outside attribution/license files.

## Choose The Work Mode

For broad requests—new game, complete, polished, premium, showcase,
release-ready, or major upgrade—read `references/workflow.md` first and execute
all applicable phases. For a narrow fix, read only the directly relevant
references plus `references/qa-release.md` for proportionate verification.

Do not duplicate reference content in the implementation report. Track the
phase, decision, and evidence that mattered.

## Read By Phase

| Need | Read before work |
| --- | --- |
| Game concept, core loop, level, encounter, progression, difficulty | `references/game-design.md` |
| Runner, racer, dogfight, tower defense, cue sport, mini golf, boss arena, or puzzle completion | `references/genre-playbooks.md` |
| Loop ownership, entities, input, camera, state, collision, scaffold | `references/gameplay-architecture.md` |
| Spatial basis, imported axes, authoritative transforms, world queries | `references/spatial-contracts.md` |
| Physics or collision-heavy mechanics | `references/physics.md` |
| Juice, impact, responsiveness, camera feedback | `references/game-feel.md` |
| Procedural sound, buses, mute/pause, local audio files | `references/audio.md` |
| Local GLB/FBX, clips/root motion, bounds/proxies, textures, fonts, audio, and source/license intake | `references/local-assets.md` |
| Hero, enemies, rewards, props, world-kit geometry | `references/procedural-modeling.md` |
| Material library, layered world, VFX architecture, diagnostics | `references/visual-architecture.md` |
| Camera composition, lighting, shadows, fog, post, readability | `references/rendering.md` |
| Custom materials, GLSL, `onBeforeCompile`, sky, post chain | `references/shaders.md` |
| Budgets, instancing, LOD, culling, disposal, mobile quality | `references/technical-art.md` |
| HUD, menus, touch, responsive fit, accessibility | `references/ui.md` |
| Picking, selection, camera modes, semantic controls | `references/interaction.md` |
| Blank canvas, runtime defects, profiling, optimization | `references/debugging-performance.md` |
| Visual baselines and deterministic screenshots | `references/visual-regression.md` |
| Scripted input, progression, softlocks, difficulty | `references/bot-playtesting.md` |
| Browser QA, production preview, static release | `references/qa-release.md` |
| Premium/showcase scoring and completion claims | View all `assets/scorecard-anchors/`, then read `references/quality-scorecard.md` and `references/quality-gates.md` |

Load the relevant reference before its phase, not after implementation as a
retrospective checklist.

## End-To-End Workflow For Broad Work

Run this section only for broad work selected above. Focused fixes use the
owning reference and proportionate QA without design, art, or content phases.

1. Inspect the existing project, scripts, dependencies, renderer, loop, input,
   camera, state, UI, assets, tests, target devices, and deployment constraints.
2. Write the compact design contract: player promise, target feeling, primary
   verb, objective, pressure, reward/progression, fail/retry, skill expression,
   non-goals, first level or encounter plan, intended session length, content
   counts, victory/ending condition, and target devices. Do not silently
   substitute a vertical slice when the user requested a complete game. Read
   the matching genre contract when `references/genre-playbooks.md` covers it.
3. Build the smallest complete playable loop. Real input must change state;
   the objective must progress; pressure and feedback must exist; restart must
   cleanly restore play when the genre has failure.
4. Establish local content ownership. Record each visible surface as
   `procedural`, `project-local`, `user-supplied`, or `deliberately deferred`.
   Do not create an external-sourcing phase. Run every imported local file
   through the intake contract and provenance inventory in
   `references/local-assets.md`.
5. Upgrade the whole active frame in order: composition and silhouettes,
   spatial depth, authored forms, material identity, lighting hierarchy,
   motion/VFX, then post-processing. Do not use bloom, fog, darkness, or
   particles to conceal missing craft.
6. Build genre-specific UI and procedural/local audio around the same game
   state. Add desktop and touch input paths when mobile is in scope; respect
   safe areas, reduced motion, mute, and keyboard access.
7. Reproduce defects and measure bottlenecks before changing them. Optimize one
   owner at a time, then re-measure the same worst-case active state.
8. Verify the production story: build, local browser, console/page errors,
   nonblank canvas, real input, objective progression, fail/retry, desktop and
   mobile composition when in scope, renderer diagnostics, visual-harness
   decision, and production preview.
9. For premium or showcase claims, fill the scorecard, cite measured evidence,
   run a fresh-eyes review, and continue until the threshold passes or report
   the exact blocker without softening the label.

## Greenfield Scaffold

Create a local Vite + TypeScript + Three.js starting point with deterministic
test hooks, procedural Web Audio, touch controls, Playwright smoke coverage, and
canvas diagnostics:

```bash
python3 <this-skill-dir>/scripts/create_threejs_game.py ./my-game
cd ./my-game
npm install
npm run dev
```

The scaffold is an authored first slice, not a universal architecture. Replace
its arena, objective, and tuning with the requested design; preserve useful
ownership boundaries and deterministic hooks.

`npm install` is a build-time dependency install, not a game runtime service.
On a fully air-gapped machine, use a pre-populated npm cache or already
installed lockfile dependencies. Playwright checks likewise need a cached
browser or a locally installed Chrome selected with
`PLAYWRIGHT_CHANNEL=chrome`; disclose when browser checks cannot run.

## Architecture Invariants

- Existing project architecture wins. Do not migrate frameworks without a
  user-facing reason.
- Keep one owner each for renderer, scene, camera pose, animation frame,
  simulation clock, game state, resize, asset lifecycle, and disposal.
- Use the update order `input -> fixed simulation -> game rules -> animation
  and VFX -> camera -> UI/audio bridge -> render`.
- Convert devices into intents. Simulation consumes intents, not DOM events.
- Route gameplay randomness through a seeded generator; never use
  `Math.random()` in deterministic gameplay or visual-test paths.
- Keep visual meshes separate from collision proxies and authoritative state.
- Keep hot paths allocation-light. Pool short-lived effects and projectiles;
  share geometry, materials, and textures.
- Treat primitives as construction tools. A premium final silhouette needs
  authored proportion, layering, trim, state cues, and context.
- Keep debugging and tuning controls behind an explicit local debug flag.

## Verification And Claims

Minimum after any meaningful change:

- Run the nearest build/typecheck gate and focused existing tests.
- Confirm changed local asset/import paths resolve.
- Exercise the changed behavior through real input when browser tools exist.
- Check console/page errors and prove the canvas is nonblank after render work.
- State exactly which browser, mobile, performance, visual-regression, and bot
  checks were not run.

Broad game work also requires the game-design contract, phase evidence, local
content plan, controls, objective progression, fail/retry evidence, and a
clean-load sustained human play pass lasting roughly two minutes or the full
short session. Difficulty or fairness tuning additionally requires two seeded
bot routes with meaningfully different reaction delays, followed by human
review; scripts are tuning signals, not proof of fun or fairness.
Premium/showcase/release-ready work additionally requires the applicable gates
in `references/quality-gates.md`.

Copy `assets/game-report.template.md`, draft the broad or premium report, and
audit its evidence structure:

```bash
python3 <this-skill-dir>/scripts/audit_game_report.py --premium /path/to/report.md
```

Add `--physics`, `--audio`, `--difficulty`, or `--no-design` only when those
switches accurately describe the work. The script is a consistency check, not
proof that commands, screenshots, metrics, or reviews exist. Inspect the cited
artifacts and live browser behavior. Fix the report or the implementation when
the audit fails.

## Final Response

Lead with the playable outcome. Report the design contract when scope warrants
it, controls, changed files, local content strategy, run command/URL,
verification commands and results, screenshots/artifacts, renderer and physics
diagnostics when applicable, scorecard/gates for quality claims, checks not run,
and remaining risks. Never imply external services, hosted/externally generated
assets, or remote runtime dependencies were used.

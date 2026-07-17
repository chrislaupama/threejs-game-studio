# Golden Task Evals

Manual or agent-run scoring tasks for `threejs-game-studio`. Each task lists
required load-budget refs, forbidden shortcuts, and pass evidence.

Score: **pass** / **fail** / **blocked** (with reason). Do not claim the skill
improved unless these stay green after changes.

## Forward-Test Protocol

Run behavioral tasks in a fresh agent context and an isolated fixture. Give the
agent only the skill path, the user-shaped request, and the raw fixture; keep
the refs, forbidden shortcuts, suspected failure, and pass criteria below in
the evaluator. Preserve the exact prompt, refs actually opened, final response,
diff, command log, and captures before cleaning the fixture.

## 1. Fix blank canvas

- **Refs:** `load-budgets.md` focused set + `debugging-performance.md`
- **Forbidden:** rewriting the whole game; adding post-processing first
- **Pass:** nonblank canvas, console clean, root cause named

## 2. Greenfield arena via create:game

- **Refs:** first-playable budget + arena genre section
- **Command:** `npm run create:game -- ./eval-arena`
- **Pass:** `npm install && npm run build`, `dev` shows playable collect/avoid loop

## 3. Create runner genre scaffold

- **Refs:** first-playable + endless runner playbook section
- **Command:** `npm run create:game -- ./eval-runner --genre runner`
- **Pass:** build succeeds; auto-forward + lateral dodge + distance score present

## 4. Add pickup + VFX event wiring

- **Refs:** `vfx.md`, `game-feel.md` (triggered after playable loop exists)
- **Forbidden:** bloom-only “juice” with no event owner
- **Pass:** pickup/hit events drive bounded VFX; dispose/pool evidence

## 5. Feel/camera tuning pass

- **Refs:** `game-feel.md`, `interaction.md`
- **Pass:** named constants changed; before/after notes; real input exercised

## 6. Legacy API cleanup via API auditor

- **Refs:** `upgrade-existing.md`, `official-docs.md`
- **Command:** `npm run audit:project-apis -- <legacy-or-fixture>`
- **Pass:** denylist findings fixed or explicitly deferred with migration order

## 7. WebGPU spike

- **Refs:** `webgpu.md` only after playable WebGL loop exists
- **Forbidden:** claiming WebGPU speedup without backend evidence
- **Pass:** `three/webgpu` path boots; backend reported; GLSL/`EffectComposer` not mixed

## 8. Release / ship-check path

- **Refs:** release budget + `qa-release.md`
- **Command:** `npm run ship-check -- <project>` (canvas required unless blocked)
- **Pass:** probe/APIs/local/build/(canvas)/report steps green or skips documented

## 9. Broad-production game from a novice idea

- **Fixture:** empty directory; user supplies only a short game idea and asks for
  a complete short game
- **Refs:** broad-production budget, workflow, design sections, one matching
  genre section, then phase-triggered owners only
- **Forbidden:** returning the untouched arena scaffold; loading all references;
  stopping at a rendered scene or unapproved vertical slice
- **Pass:** design/completion contract, customized start-to-ending loop,
  objective/pressure/reward/fail-retry, coherent content/UI/audio, build and
  real-browser evidence, and unrun checks reported

## 10. Tutorial delivery without reducing scope

- **Fixture:** minimal compiling Three.js project with one visible mesh
- **Request shape:** a novice asks to turn it into a small playable game while
  learning how the loop, state, input, collision, and retry fit together
- **Refs:** tutorial + broad-production routing; only the current milestone's
  owning sections
- **Forbidden:** lecture-only output; unexplained framework dump; skipping the
  promised ending because the request is educational
- **Pass:** runnable milestones, terms defined on first use, commands and file
  locations explained, complete playable loop, and browser verification

## 11. Major upgrade while preserving project ownership

- **Fixture:** working legacy project with global `THREE`, one stale addon API,
  custom state/input modules, and a regression test
- **Refs:** legacy-upgrade budget plus owning sections selected per migration step
- **Forbidden:** wholesale rewrite; changing game design; silently upgrading
  unrelated dependencies
- **Pass:** installed revision and migration order recorded, stale APIs removed,
  existing module ownership and behavior preserved, regression/build/browser
  checks pass, and any deferred migration risk is explicit

## 12. Section-level load-budget discipline

- **Fixture:** existing playable game with one isolated touch-control release bug
- **Refs:** focused budget plus the relevant `interaction.md` touch/pointer
  sections and proportionate QA
- **Forbidden:** full `workflow.md`, premium refs, shader/WebGPU refs, or unrelated
  interaction sections without a discovered dependency
- **Pass:** opened-reference log stays within budget, bug is reproduced and
  fixed through real pointer cancel/release input, and unrelated behavior remains
  unchanged

## 13. Premium polish after a proven playable baseline

- **Fixture:** complete but visually basic local-first game with deterministic
  active-play hooks and no failing build/browser checks
- **Refs:** premium budget only after baseline active-state evidence; visual
  owners selected from the Phase 5 router
- **Forbidden:** loading scorecard/shader/post manuals before baseline evidence;
  glow/fog/bloom as the sole improvement; quality claims without captures
- **Pass:** before/after and post-disabled active captures, measured render
  diagnostics, scorecard with cited evidence, coherent whole-frame improvement,
  fresh-eyes result, and remaining automatic failures listed

## 14. Trigger discrimination

- **Positive prompts:** build or debug a Three.js browser game; upgrade a
  Three.js game renderer; release-test an existing Three.js game
- **Negative prompts:** build a non-game product viewer; create a WebGL data
  visualization; debug a Babylon.js or Unity project
- **Pass:** the skill triggers for every positive prompt and does not implicitly
  trigger for negatives unless the user explicitly invokes it

## 15. Capability-boundary honesty

- **Fixture:** local single-player game; user asks to add competitive multiplayer
  and production ragdoll physics in one pass
- **Refs:** `networking-boundary.md` and the limits section of `physics.md`
- **Forbidden:** silently adding networking/physics packages; pretending custom
  arcade collision supplies general ragdolls; coupling sockets to the render loop
- **Pass:** current local loop remains intact, architecture/authority and physics
  limits are stated, approval or scope choice is requested before implementation,
  and no unsupported completion claim is made

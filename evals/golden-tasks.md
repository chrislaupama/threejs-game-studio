# Golden Task Evals

Manual or agent-run scoring tasks for `threejs-game-studio`. Each task lists
required load-budget refs, forbidden shortcuts, and pass evidence.

Score: **pass** / **fail** / **blocked** (with reason). Do not claim the skill
improved unless these stay green after changes.

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

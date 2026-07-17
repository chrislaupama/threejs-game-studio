# Reference Load Budgets

Use this file immediately after classifying scope. Choose a focused or broad
base workflow, then add the premium quality overlay and release evidence gate
only when claimed. Thus a premium release is broad + premium + release, not one
mutually exclusive row. Load only the minimum set for the current stage, then
add triggered refs. Do not preload premium, WebGPU, shader, or release manuals
before their entry conditions are met.

## Contents

- Scope budgets
- Hard defer rules
- Broad-production phase router
- Trigger map

## Scope Budgets

| Base / stage / gate | Load when entering it | Load only when triggered | Do not enter until |
| --- | --- | --- | --- |
| Focused | Owning tech ref + `quickref.md` + `qa-release.md` | `debugging-performance.md` if blank/broken | Premium refs, genre playbooks, full `workflow.md` ledgers |
| First playable / greenfield | `official-docs.md` version/renderer sections, `quickref.md`, Phase 2–3 foundation sections below, matching `genre-playbooks.md` section | `physics.md` / `audio.md` / `ui.md` when adding those systems | Scorecard, `webgpu.md`, `shaders.md`, `webxr.md` |
| Broad production / complete game | `workflow.md`, `official-docs.md`, `game-design.md`, matching `genre-playbooks.md` section | Phase router below; `fundamentals.md` and `gameplay-architecture.md` only when foundation work is needed | Premium scorecard, full WebGPU/custom shader/post, XR, and release manuals until their trigger or gate |
| Premium quality overlay | Prior playable set + `visual-architecture.md`, `quality-scorecard.md`, `rendering.md`, `vfx.md`, and the budget/scaling sections of `technical-art.md` | `webgpu.md` / `shaders.md` if renderer/post changes; `overlays.md` for world labels | A playable loop has browser smoke evidence |
| Release evidence gate | `qa-release.md`, `visual-regression.md` or bot decision, `quality-gates.md` | `ship-check` outputs; mobile/a11y refs when claimed | Promised product/quality scope is implemented and features are frozen |
| Revision-only legacy upgrade | `upgrade-existing.md`, `official-docs.md`, `quickref.md` | Owning tech refs per migration step | Premium/release gates until build + smoke pass; a renderer-family, shader-language, or post-architecture port uses broad production instead |
| Network ask | `networking-boundary.md` first | Nothing else for net until architecture approved | Inventing sockets inside the render loop |

Focused scope does **not** keep full design, content, or performance ledgers.
Reproduce → fix → proportionate QA only.

Broad work keeps the `workflow.md` ledgers. Premium and release add quality and
evidence requirements to those same ledgers; they do not restart or replace the
broad workflow.

## Hard Defer Rules

- Do not load `shaders.md` until a playable loop has browser smoke evidence.
- Do not claim scorecard categories until active-state captures exist.
- Do not load `webxr.md` until desktop/mobile non-XR loop is stable (unless the
  request is XR-only).
- Do not load the full `implementation-recipes.md` for a one-line fix; load the
  owning section only when the decision tree points there.
- Do not open every reference named for a production phase. Read the owning
  section for the active decision, then expand only when its trigger fires.
- Do not skip `load-budgets.md` itself on broad or greenfield work.

## Broad-Production Phase Router

Use this after opening `workflow.md`. Locate the named heading from the
reference's contents and read that section; do not preload the entire row.

| Phase / decision | Read first | Add only when triggered |
| --- | --- | --- |
| 0 — version and renderer truth | `official-docs.md`: **Version And Source Policy** and **Renderer Compatibility Boundary** | An explicit user renderer requirement takes precedence unless infeasible. Otherwise record only a provisional candidate; finalize after the relevant `rendering.md` / `webgpu.md` / `shaders.md` compatibility section and a minimal compile/browser spike when changing families |
| 1 — design and completion | `game-design.md`: **Design Brief Gate**, **Core Loop Contract**, and **Level And Encounter Plan**; one matching `genre-playbooks.md` section | **Difficulty And Pacing** when tuning or fairness is in scope |
| 2 — foundation | `fundamentals.md`: **Local Project Baseline**, **Scene Graph Mental Model**, **Camera Fundamentals**, **Minimal Current Render Loop**, **Responsive Canvas And Pixel Budget**, **Loading And Failure Boundaries**, **Pause, Restart, And Ownership**, and **Disposal**; `gameplay-architecture.md`: **Architecture Boundaries**, **State Transition Contract**, **Time Domains**, and **Lifecycle Contract** | `spatial-contracts.md` for imported axes, constrained motion, navigation, or multiple actors; `rendering.md`: **Renderer Decision** and **Resize And Output Ownership** when renderer setup changes |
| 3 — first playable | `gameplay-architecture.md`: **First Playable Slice (Greenfield Or Broad Work)**, **Input And Intent**, and **Gameplay Implementation Loop** | `physics.md` for collision/timing; `ui.md`: **Required States** and **State Wiring** for HUD/state; `audio.md`: **Ownership**, **Gesture Unlock**, and **Procedural SFX** for the first audio event |
| 4 — content and world | The single owner selected by the content signal below | Add a second owner only when the same asset crosses that boundary, such as imported animated glTF needing both `local-assets.md` and relevant `loaders-animation.md` sections |
| 5 — visual systems | `visual-architecture.md`: **Recommended Ownership** and **Implementation Order** | `lighting-shadows.md` for a light/shadow change; relevant `rendering.md` post/color sections for renderer work; `vfx.md` for event effects; `technical-art.md` when a render budget or scaling decision is active; `shaders.md` only after playable smoke evidence and a custom shader/post need |
| 6 — feel and presentation | The one owning ref: `game-feel.md`, `ui.md`, `audio.md`, or `interaction.md` | Add another owner only for an explicit cross-system event, such as camera kick plus audio feedback |
| 7 — performance and reliability | `debugging-performance.md`: **Performance Profiling Order** and the section for the measured owner | `technical-art.md` for draw, material, shader, LOD, batching, or adaptive-quality work |
| 8 — QA and claims | `qa-release.md` plus the applicable sections of `quality-gates.md` | `visual-regression.md` after a harness decision; `bot-playtesting.md` after a bot decision; `quality-scorecard.md` only for premium/showcase claims |

Phase 0 records a provisional renderer candidate; Phase 2 finalizes the family
and shader-language boundary after applicable compatibility evidence. It does
not design a custom shader stack. Defer the full `shaders.md` manual until Phase
3 has browser smoke evidence unless the user requested a focused shader repair.

## Trigger Map

| Signal | Add |
| --- | --- |
| Blank or black canvas | `debugging-performance.md` |
| Controls feel bad | `game-feel.md`, `interaction.md` |
| Looks basic / premium ask | `visual-architecture.md`, `quality-scorecard.md`, and budget/scaling sections of `technical-art.md` after playable smoke evidence |
| Procedural hero, threat, reward, or prop family | Relevant recipe in `procedural-modeling.md` |
| Geometry count, merge, instance, batch, or LOD decision | Relevant section of `geometry.md`; add `technical-art.md` only for measured budgets |
| File-backed PBR texture, UV, atlas, transparency, or environment issue | Relevant section of `materials-textures.md` |
| Imported model path, provenance, axes, scale, bounds, or ownership | Relevant section of `local-assets.md`; run `audit:assets` |
| glTF compression, loading UI, clips, mixers, cloning, or animation state | Relevant section of `loaders-animation.md`; pair with `local-assets.md` only for intake/ownership |
| Light or shadow issue | Relevant section of `lighting-shadows.md` |
| Custom GLSL, TSL, or renderer-specific post | `shaders.md`, but only after playable smoke evidence or for a focused shader repair |
| WebGPU compute, many-light rendering, fallback, or profiling after playable smoke | Relevant section of `webgpu.md` |
| HUD/menu/touch/accessibility state | Relevant section of `ui.md` |
| Picking, camera handoff, pointer lock, gamepad, or touch input | Relevant section of `interaction.md` |
| Third-person action, chase/shoulder/free/lock-on camera | **First-Person Or Third-Person Action** in `genre-playbooks.md` plus **Third-Person Action Rig Contract** in `interaction.md`; add `ai-navigation.md` for opponent perception/pathing |
| Perception, patrol, pursuit, pathfinding, navigation data, or crowds | `ai-navigation.md`; add `spatial-contracts.md` when basis or world-query ownership is part of the decision |
| Audio unlock, buses, SFX, spatial audio, or disposal | Relevant section of `audio.md` |
| Physics-heavy | `physics.md` |
| Save migration, chunk residency, custom workers, or local diagnostics | `production-runtime.md`; add `networking-boundary.md` and stop for approval if storage, workers, or telemetry become remote |
| Multiplayer / cloud saves / remote telemetry | `networking-boundary.md` — stop and get approval |
| Revision-only pre-r185 / CDN / global THREE migration | `upgrade-existing.md`; run `audit:project-apis` |
| WebGL↔WebGPU, GLSL↔TSL, or post-architecture port | Broad-production workflow plus the relevant `rendering.md`, `webgpu.md`, and `shaders.md` compatibility sections; prove a minimal spike before full port |

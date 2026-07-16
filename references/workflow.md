# Complete Game Workflow

Use this reference at planning time for broad game creation, major upgrades,
polish, premium/showcase work, or release preparation.

## Contents

- Scope modes
- Evidence ledgers
- Seven production phases
- Completion gates

## Scope Modes

Use **thorough mode** for a new game, major gameplay change, polished/premium
request, broad visual upgrade, or release. Run every applicable phase and make
the evidence explicit.

Use **focused mode** for a narrow mechanic, defect, UI state, performance issue,
or asset import. Read the owning reference, implement the change, and run the
smallest QA set that proves it. Do not create ceremony for out-of-scope phases.

## Evidence Ledgers

Keep these lightweight records during broad work:

```text
Phase ledger:
- Discovery/design: pending/running/done - evidence:
- Playable loop: pending/running/done - evidence:
- Local content/visuals: pending/running/done - evidence:
- UI/audio/accessibility: pending/running/done - evidence:
- Debug/performance: pending/running/done - evidence:
- QA/release: pending/running/done - evidence:

Local content plan:
- Local content sources: procedural, project-local, user-supplied, and/or deferred
- Hero/player:
- Threats/enemies:
- Rewards/interactables:
- World/sky/background:
- Materials/textures/decals:
- UI/icons/fonts:
- Audio/SFX/ambience:
- Source per surface: procedural / project-local / user-supplied / deferred

Evidence ledger:
- Build/typecheck:
- Focused tests:
- Browser and URL:
- Real input/objective/fail-retry:
- Desktop/mobile captures:
- Canvas/console/page errors:
- Renderer/physics diagnostics:
- Visual harness and bot playtest decisions:
- Local-only audit:
- Live outbound-request check:
```

Mark a phase done only after implementation and proportionate verification.

## Phase 1: Discovery And Design Contract

Inspect scripts, dependencies, architecture, renderer, loop ownership, input,
camera, entities, UI, assets, tests, screenshots, target devices, and release
constraints. Preserve the existing stack unless change is necessary.

Define:

- Player promise and target feeling.
- Primary/secondary verbs.
- Objective, pressure, reward/progression, and fail/retry.
- Skill expression and deliberate non-goals.
- Intended session length, content counts/families, victory or ending
  condition, and explicit definition of complete for this game.
- First space or encounter: start, first decision, threat, reward, landmark,
  escalation, recovery, and failure readability.
- Target viewport/device and starting render budget.
- Highest-risk path: playability, input, physics, visuals, UI, performance, or
  release.

Exit evidence: design contract, first encounter plan, known project entrypoints,
and initialized ledgers.

## Phase 2: Playable Loop

Build gameplay before deep visual polish:

- Renderer, scene, camera, resize, and one animation loop.
- Device input mapped into intents.
- Explicit game states and transition ownership.
- Player, one challenge, one reward/progress path, and one fail or setback path.
- Collision or physics, score/objective state, restart cleanup.
- Minimal HUD, local audio/VFX hooks, and diagnostics.
- Seeded randomness and stable update order.

Use a fixed simulation step when timing-sensitive collision or physics exists.
Keep detailed render geometry separate from simple gameplay proxies.

Exit evidence: build passes, canvas renders, real input changes state, objective
progresses, pressure occurs, and fail/retry works when applicable.

## Phase 3: Local Content And Art Direction

Fill the local content plan and provenance inventory before broad graphics
work. No row may select a remote provider. Prefer a small, coherent set over a
large placeholder world.

Block out scale and decisions first. Then author:

- One readable hero/player with front/up/side cues and state sockets.
- Distinct threat families with silhouette and anticipation.
- Desirable rewards/interactables with idle and collection states.
- A reusable world kit across play, near, middle, far, and motion layers.
- Shared material roles and procedural trim/decals/textures.
- Collision proxies, bounds, and diagnostics.

If local imported files exist, normalize them at one asset boundary and verify
scale, axes, pivot, materials, clips, file size, texture cost, and disposal.

Exit evidence: active frame no longer depends on placeholder geometry; each
visible surface has a local source and gameplay purpose.

## Phase 4: Visual Systems

Improve the image in dependency order:

1. Camera framing, silhouette, and screen occupancy.
2. Spatial depth and readable near/mid/far composition.
3. Authored geometry and material identity.
4. Key/fill/rim/contact lighting and intentional shadows.
5. Atmosphere, fog, and background hierarchy.
6. Event-driven VFX and motion.
7. Post-processing with on/off comparison.

Write a technical-art brief and target budget before costly shader, shadow, or
post work. Measure the worst active state, not an idle menu.

Exit evidence: before/after active captures, renderer diagnostics, target vs
actual budget, post-disabled readability, dense-state check, and mobile tradeoff
when mobile is in scope.

## Phase 5: UI, Audio, And Accessibility

Inventory gameplay, pause, settings, fail/retry, win/milestone, loading/error,
and touch states. Build a game interface, not a dashboard. Keep values stable,
use semantic controls, protect safe areas, and dispatch the same intents from
keyboard, pointer, touch, and gamepad paths.

Build audio from Web Audio synthesis or local files. Use master/music/SFX/UI
buses, unlock from a gesture, couple cues to game events, and cleanly pause,
restart, mute, and dispose voices.

Protect readability with reduced motion, shake/flash limits, shape backup for
color, keyboard focus, and captions/text equivalents where appropriate.

Exit evidence: relevant state captures, real UI/touch actions, text fit,
safe-area/touch checks, mute/pause/restart audio checks, and no duplicated game
rules in UI.

## Phase 6: Debug And Performance

Reproduce first. Capture the first console, page, and local asset error. Find
the owner before editing: renderer, scene, camera, loop, state, asset, audio,
input, physics, UI/CSS, build/base path, CPU, GPU, or memory.

For optimization, record the scenario and baseline. Change one bottleneck at a
time: reuse, instancing, culling, LOD, pooling, disposal, adaptive DPR, cheaper
shadows/post, simpler colliders, or allocation removal. Re-measure the identical
scenario and check that playability and readability survive.

Exit evidence: root cause or bottleneck, fix owner, baseline/post metrics, and
exact broken path retested.

## Phase 7: QA And Release

Verify in the production story:

- Build/typecheck and focused tests.
- Correct local dev or production-preview URL.
- Console/page errors and nonblank canvas.
- Main input, objective progression, pressure, fail/retry, pause/resume.
- Desktop composition; mobile input/composition when in scope.
- HUD text fit, safe areas, touch cancellation, resize/orientation.
- Audio gesture unlock, triggers, mute, pause, restart, and disposal.
- Renderer and physics diagnostics after relevant changes.
- Visual-regression decision and bot-playtest decision.
- Static base path, local asset URLs, debug gating, bundle/large files, licenses.
- `scripts/audit_local_only.py` with no unapproved runtime dependency.

For premium/showcase claims, complete the scorecard and independent/fresh-eyes
review using the entire active capture set.

Exit evidence: commands and pass/fail, URL, controls, artifacts, diagnostics,
issues fixed or owned, and residual risks.

## Completion Gate

Broad work is complete only when the requested loop is playable through real
input, the design and level contracts match what was implemented, local content
is integrated, UI/audio communicate state, the build passes, and unrun checks
are disclosed.

Premium/showcase work must also pass `quality-gates.md`. Release-ready work must
exercise production preview and the bot/visual-harness decisions. If a gate
fails, continue or report the exact blocker; do not relabel the outcome.

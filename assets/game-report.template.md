# Three.js Game Evidence Report

Copy this file into the game project for broad work. Replace every prompt with
the observed result or `not applicable — reason`; do not treat a heading or an
unchecked placeholder as evidence.

## Phase ledger

- Discovery/design:
- Playable loop:
- Local content/visuals:
- UI/audio/accessibility:
- Debug/performance:
- QA/release:

## Local content plan

Local content sources: [replace with comma-separated values chosen from:
procedural, project-local, user-supplied, deferred]

- Hero/player:
- Threats/enemies:
- Rewards/interactables:
- World/environment:
- Materials/textures:
- UI/fonts/icons:
- Audio:
- Provenance inventory path (the scaffold creates `docs/content-provenance.md`):

## Three.js and runtime contract

- Three.js revision (installed package and `THREE.REVISION`, for example
  `three@<installed> / r<REVISION>` — verify that exact revision):
- Renderer/backend (`WebGLRenderer`/WebGL or `WebGPURenderer`/WebGPU, including
  any fallback):
- Documentation/version baseline (official pages/source checked against the
  installed revision; skill last-verify note is informational only):
- Tone mapping / color (`ACESFilmic` / `AgX` / `Neutral`, exposure, opaque canvas):
- Lifecycle/disposal (owner of start, loop, reset, listeners, GPU/audio
  resources, dispose, and re-entry):
- Resize/DPR (tested viewports/orientation, camera and render-target resize,
  drawing-buffer result, and capped DPR):
- Loading/error behavior (local asset loading UI, required-asset failure,
  actionable message, retry, and deliberate fallback):

## Game design brief

- Player promise and target feeling:
- Primary/secondary verbs:
- Objective and core loop:
- Pressure and fail/retry:
- Reward/progression:
- Skill expression:
- Non-goals:
- Level/encounter plan:
- Genre playbook and deliberate deviations:

## Implementation evidence

- Gameplay:
- Visual:
- UI:
- Audio:
- Debug/performance:
- QA/release:
- Controls:
- Collision model:
- Timestep:
- Collider count:
- Lifecycle/disposal implementation:
- Resize/DPR implementation:
- Loading/error behavior implementation:
- Gesture unlock:
- Mute:
- Pause/restart:

## Verification

- Build: [pass/fail]
- Unit/focused tests: [commands and pass/fail]
- Production preview/base path: [URL, configured base, pass/fail]
- Local-only audit: [pass/fail]
- Live outbound-request check:
- Browser/URL:
- Real input/objective/fail-retry:
- Sustained human play (clean load, duration/session):
- Desktop/mobile:
- Resize/orientation/DPR evidence:
- Loading/required-local-asset-error/retry evidence:
- Lifecycle/disposal/re-entry evidence:
- Canvas/console/page errors:
- Renderer/performance diagnostics:
- Visual test harness:
- Bot playtest:
- Two-reaction-delay bot comparison (difficulty/fairness work):
- Checks not run: [list or none]
- Remaining risks: [list or none]

## Polished, premium, or showcase evidence (when claimed)

- Claim tier: [none/polished/premium/showcase; visual claims must match the audit flag]

- Art direction — after:
- Hero/player — after:
- Obstacles/enemies — after:
- Rewards/interactables — after:
- World/environment — after:
- Materials/textures — after:
- Lighting/render — after:
- VFX/motion — after:
- UI/HUD — after:
- Performance evidence — after:
- Measured evidence:
- Fresh-eyes review:
- Automatic failures remaining: [none or list]
- Technical art:
- Render budget:

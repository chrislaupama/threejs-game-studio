# Gameplay Workflows

## Contents

- First playable and module ownership
- Local model/animation integration
- Input, camera, collision, and mechanic iteration
- Design/feel, audio hooks, diagnostics, and verification

Use this reference for first playable slices, architecture, mechanics, entities,
controls, camera, physics, audio hooks, and game-feel iteration. For broad game
creation, level/arena/track/wave/hole/puzzle work, encounter design,
progression, difficulty, or polished gameplay claims, also read
`game-design.md`.

## First Playable Slice (Greenfield Or Broad Work)

Skip this section for a focused defect or performance fix that must preserve
the existing design. Start at the owning subsystem section instead.

The first slice must be playable, not just rendered.

1. Inspect folder, scripts, dependencies, current renderer, app entrypoint, CSS, assets, and tests.
2. Define the design brief and core-loop contract from `game-design.md`.
3. Define the level/encounter plan: first decision, first threat, first reward, escalation, recovery beats, and readability.
4. Implement only the mechanics needed for that loop:
   - renderer and scene
   - camera and resize
   - update/render loop
   - input intents
   - player entity
   - one obstacle/enemy or challenge
   - one reward/progress path
   - collision/trigger checks
   - score/status state
   - fail/retry state
   - minimal HUD state
   - one audio/VFX feedback hook
5. Add diagnostics when possible:
   - `window.__THREE_GAME_DIAGNOSTICS__`
   - renderer info
   - game state snapshot
   - input state
   - active entity counts
6. Verify build, browser, console/page errors, screenshot, nonblank canvas, and one real input path.

Reject a slice that cannot be controlled or restarted. Also reject a slice where the level/arena/track/wave/table/puzzle is purely decorative and does not shape the player's decisions.

## Architecture Boundaries

Prefer simple modules once the prototype grows beyond one file:

- `main`: DOM bootstrap, app lifecycle, CSS imports.
- `core`: renderer, loop, resize, input, diagnostics.
- `game`: orchestration, state transitions, update order, scoring/objectives.
- `entities`: player, enemies, pickups, projectiles, obstacles.
- `systems`: camera, collision/physics, spawning, animation, audio, UI bridge, debug.
- `assets`: material libraries, procedural textures, model factories, loaders, disposal.
- `tests`: browser, visual, interaction, mobile, performance smoke checks.

Keep update order explicit:

```text
input -> fixed physics if any -> gameplay systems -> animation/VFX -> camera -> UI bridge -> render
```

Do not invent abstractions before the mechanics need them. Do extract duplicated entity, input, collision, and asset logic once multiple features share it.

## Imported Local 3D Assets And Animation

When gameplay uses project-owned or user-supplied GLB/FBX assets:

- Load GLB assets with `GLTFLoader` from `three/addons/loaders/GLTFLoader.js`.
- Keep imported model loading in the asset layer, not inside entity update loops.
- Wrap imported scenes in game entities with explicit scale, bounds, collision proxy, and state hooks.
- Use `AnimationMixer` for rigged/animated GLBs and update mixers with `deltaSeconds`.
- Map gameplay states to clips: idle, walk/run, jump, attack/slash/shoot, hurt, fall, turn.
- Decide whether root motion is used. For arcade games, prefer in-place animation and move the entity in code.
- Keep simple collision proxies independent from the detailed imported mesh.
- Add an actionable loading/error state if an asset fails to load. Use a
  clearly labeled local placeholder only when it preserves useful progress.
- Report file size, clip names, approximate triangles, and texture count after import.

## Input And Intent

- Convert keyboard, pointer, touch, and gamepad where relevant into game intents.
- Keep input collection separate from simulation.
- Support both desktop and mobile when the user asks for a browser game unless explicitly desktop-only.
- Handle pointer release/cancel/blur so controls do not stick.
- Keep CSS `touch-action` intentional and scoped.
- Preserve focus and restart controls after fail/pause.

## Camera And Controls

Tune controls and camera together.

- Movement: acceleration, deceleration, friction, turn rate, max speed, jump/gravity/boost.
- Camera: follow lag, look-ahead, FOV, height, distance, shake, collision/framing.
- Readability: next decision visible, player centered enough, threats not hidden by UI.
- Feedback: hit pause, camera impulse, FOV kick, meter pulse, audio pitch, VFX socket.
- Accessibility: avoid excessive shake, strobe, and uncontrollable motion.

Use a small project-local DOM panel for live constants when repeated tuning is
likely, and gate it behind a local debug flag. Preserve an existing tuning
library only when the project already owns that dependency.

## Collision And Physics

Use dependency-free custom collision and authored kinematics for new work:
triggers, lanes, runners, pickups, bullets, arenas, balls, rails, ramps, moving
platforms, and bounded arcade dynamics. When physics is in scope, read
`physics.md` before designing the collider and fixed-step model. Preserve an
engine already owned by an existing project when replacing it is out of scope,
but do not install or expand one through this skill.

Rules:

- Keep collision proxies simple and visible in debug mode.
- Do not use detailed visual meshes for collision.
- Clamp delta or use fixed-step simulation for physics.
- Reconcile physics transforms and visual transforms in one place.
- Test high-speed movement against tunneling and camera loss.
- Report collision model, timestep, body count, collider count, swept/substep
  strategy, sensors, and risky colliders.
- For fast objects, use swept tests or bounded substeps and report the maximum
  designed speed.

## Gameplay Implementation Loop

For each mechanic:

1. Add state/data.
2. Add simulation/update.
3. Add visual representation.
4. Add feedback: UI, audio, VFX, camera, animation.
5. Add diagnostics.
6. Verify with real input and one failing edge case.

Examples:

- Pickup: spawn data, collision trigger, score/meter state, collect VFX/audio, HUD pulse, respawn/cleanup.
- Hazard: telegraph, movement/update, collision proxy, damage/fail state, hit feedback, restart.
- Combo: timer/state, reward multiplier, UI badge, audio ramp, reset rules.
- Weapon/action: cooldown, projectile/hit, impact feedback, ammo/charge UI, target readability.

## Game Feel Pass

Run several short loops and tune one axis at a time:

- Movement speed and acceleration.
- Camera distance, follow, and look-ahead.
- Reaction windows and obstacle spacing.
- Jump/boost/attack cooldowns.
- Pickup magnetism and reward timing.
- Hit feedback and restart speed.
- Difficulty ramp and pacing.

Record meaningful constants changed. If the game feels worse after a pass, revert or reduce the last tuning change instead of layering compensating changes.

## Design And Level Iteration

When a prototype is technically playable but bland, iterate the design before adding more art:

- Tighten the player promise and primary verb.
- Add a decision in the first 30 seconds.
- Move hazards/rewards so the player chooses between safety, speed, score, or resource gain.
- Add a learning beat before a punishing combination.
- Add one recovery beat after high pressure.
- Replace random placement with authored pacing rules or seeded patterns.
- Tune the camera to frame the next decision, not only the player object.
- Report what changed in the design brief, level plan, or difficulty curve.

## Audio Hooks

Use lightweight Web Audio or project audio utilities:

- UI click/pause/retry.
- Pickup/score.
- Damage/fail.
- Boost/speed.
- Combo/milestone.
- Ambient loop or procedural drone when appropriate.

Audio should reflect state, not play random decoration. Respect mute and reduced-motion/accessibility settings when present.

## Diagnostics

Expose:

- FPS/frame time if available.
- Renderer info.
- Current state.
- Player position/velocity.
- Entity counts.
- Active collisions/hits.
- Input intents.
- Tunable constants when using debug GUI.

Diagnostics should be easy to disable or gate for release.

## Verification

Minimum evidence after meaningful gameplay work:

- `npm run build` or equivalent.
- Local browser run.
- Console/page error check.
- Nonblank canvas pixel check.
- Desktop screenshot.
- Mobile screenshot when in scope.
- Main input path tested.
- Objective progression tested.
- Fail/retry tested when relevant.

## Common Failures

- Static scene instead of game.
- Multiple loops fighting.
- Camera clips, points away, or hides the next decision.
- Mechanic cannot be triggered from real input.
- HUD/audio/VFX do not reflect state changes.
- Faster movement breaks collision or camera framing.
- Restart leaves stale entities, timers, listeners, or effects.
- Mobile input works visually but does not emit game intents.
- Imported local model loads but has wrong scale, pivot, orientation, animation
  root motion, or no collision proxy.

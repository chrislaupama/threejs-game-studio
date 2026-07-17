# Gameplay Workflows

## Contents

- First playable and module ownership
- State transitions, time domains, lifecycle, and scene-graph ownership
- Local model and animation integration
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
sample devices -> player/AI intents -> fixed movement + collision/physics
               -> game rules/events -> animation/VFX -> camera
               -> UI/audio bridge -> render
```

Input handlers only update device state. At the start of each simulation step,
sample that state and run scheduled AI sensing/decision work so every actor has
an intent before movement and contact resolution. Collision/physics consumes
those intents and commits accepted authoritative poses; rules then resolve
contacts and emit events. Presentation systems and the camera read the committed
state rather than predicting a second movement path. AI may run at a lower
decision frequency, but its last intent remains stable between decision ticks.

Do not invent abstractions before the mechanics need them. Do extract duplicated entity, input, collision, and asset logic once multiple features share it.

## State Transition Contract

Keep one canonical state machine. UI, audio, input modes, and simulation observe
transitions; they do not independently decide whether the game is won, paused,
or over.

```ts
type GameState =
  | { name: 'loading'; progress: number }
  | { name: 'menu' }
  | { name: 'playing'; runId: number }
  | { name: 'paused'; runId: number }
  | { name: 'won'; runId: number; score: number }
  | { name: 'lost'; runId: number; reason: 'time' | 'health' | 'hazard' }
  | { name: 'error'; message: string };

const allowed: Record<GameState['name'], ReadonlySet<GameState['name']>> = {
  loading: new Set(['menu', 'error']),
  menu: new Set(['playing', 'loading']),
  playing: new Set(['paused', 'won', 'lost', 'menu']),
  paused: new Set(['playing', 'menu']),
  won: new Set(['playing', 'menu']),
  lost: new Set(['playing', 'menu']),
  error: new Set(['loading', 'menu']),
};

function canTransition(from: GameState, to: GameState): boolean {
  return allowed[from.name].has(to.name);
}
```

Put transition side effects in one place:

```ts
function enterState(next: GameState): void {
  if (!canTransition(state, next)) {
    throw new Error(`Invalid transition: ${state.name} -> ${next.name}`);
  }
  const previous = state;
  state = next;
  input.setContext(next.name);
  audio.onStateChanged(previous.name, next.name);
  hud.render(next);
}
```

Use a discriminated union for compile-time state data. For a tiny game, a
string enum and explicit transition function is sufficient; do not install a
state-machine package merely to avoid ten clear lines of code.

## Time Domains

Name time sources so pause, hitstop, slow motion, animation, UI, and physics do
not accidentally share the wrong clock:

- **real time:** browser frame delta; drives diagnostics and feedback decay
- **simulation time:** fixed or scaled steps; drives rules and collision
- **presentation time:** smooth visual animation and camera; may continue when
  simulation pauses by design
- **UI time:** CSS/WAAPI or a real-time delta; remains responsive while paused

Keep the shared `Timer` on real time and derive the other domains explicitly.
Changing its timescale changes every consumer of `getDelta()` and
`getElapsed()`, which is usually too broad for gameplay slow motion or pause:

```ts
const frameTimer = new THREE.Timer();
frameTimer.connect(document); // Page Visibility API avoids a hidden-tab spike

let simulationTimeScale = 1;

renderer.setAnimationLoop((timestamp) => {
  frameTimer.update(timestamp); // exactly once before any time query
  const realDelta = Math.min(frameTimer.getDelta(), 0.1);
  const simulationDelta = state.name === 'playing'
    ? realDelta * simulationTimeScale
    : 0;
  const presentationDelta = shouldAnimatePresentation(state)
    ? realDelta
    : 0;

  updateFrame({ realDelta, simulationDelta, presentationDelta });
  renderer.render(scene, camera);
});

async function disposeLoop(): Promise<void> {
  // WebGLRenderer returns void; the common/WebGPU Renderer returns a Promise.
  await renderer.setAnimationLoop(null);
  frameTimer.dispose();
}
```

Accumulate `simulationDelta` into fixed steps when fairness or contact depends
on timing. A presentation system may deliberately use scaled simulation time or
unscaled presentation time, but its owner must declare that choice. CSS/WAAPI
UI can use its own real-time timeline. Do not call `Timer.update()` from
separate systems, and stop the animation loop before disposing the timer.

## Lifecycle Contract

Use explicit lifecycle names even when implementation is a single class:

```ts
interface GameSystem {
  start?(): void;
  fixedUpdate?(stepSeconds: number): void;
  update?(deltaSeconds: number, presentationSeconds: number): void;
  reset?(runId: number): void;
  dispose(): void;
}
```

Register systems in update order and dispose them in reverse ownership order.
Reset must clear transient entities, contacts, input edges, timers, tweens,
animation actions, audio voices, UI overlays, and seeded RNG state that belongs
to the run. `dispose()` additionally removes listeners/workers and frees GPU or
audio resources; reset is not a substitute for disposal.

## Scene Graph And Transform Ownership

Treat the scene graph as a transform and presentation hierarchy, not the
canonical gameplay database. A useful entity shape is:

```text
entityRoot              authoritative world pose; normally unit scale
  visualRoot            asset axis/scale/pivot correction and interpolation
    model/skeleton
    authored sockets    muzzle, hand, VFX, nameplate anchor
  colliderDebugRoot     optional visualization of canonical colliders
```

The simulation or physics body owns the authoritative pose. Project it to
`entityRoot` or `visualRoot` in one reconciliation step; collision must never
read back an interpolated visual transform. Keep imported scale and orientation
corrections on `visualRoot` so they do not contaminate collider units, movement,
camera math, or child sockets.

`position`, `quaternion`, and `scale` are local to an object's parent. Use
`getWorldPosition()`, `getWorldQuaternion()`, `localToWorld()`, and
`worldToLocal()` at ownership boundaries. If a world-space query happens before
the renderer's normal matrix update, call `updateWorldMatrix(true, true)` on the
smallest relevant root first.

The following transform caveats are verified against r185. Recheck the
installed API documentation and migration notes on every Three.js upgrade:

- `Object3D.attach()` preserves world transform while reparenting, but does not
  support hierarchies containing non-uniformly scaled nodes.
- `Object3D.lookAt()` does not support an object with non-uniformly scaled
  parents. Keep dynamic gameplay roots and cameras under identity- or
  uniformly-scaled parents.
- `Object3D.pivot` changes the center used for rotation and scale; it does not
  redefine world position or the canonical collider origin. Prefer a dedicated
  normalization root when an imported asset needs several corrections.
- `Object3D.static` is a WebGPU-only optimization contract. Set it only for an
  object whose transform, geometry, and material will not change after its
  initial render; it is not a general freeze flag for dynamic entities.

## Imported Local 3D Assets And Animation

When gameplay uses project-owned or user-supplied GLB/FBX assets:

- Load GLB assets with `GLTFLoader` from `three/addons/loaders/GLTFLoader.js`.
- Keep imported model loading in the asset layer, not inside entity update loops.
- Wrap imported scenes in game entities with explicit scale, bounds, collision proxy, and state hooks.
- Use `AnimationMixer` for rigged/animated GLBs and assign each mixer one named
  time domain. Gameplay-character mixers use scaled simulation time and pause
  with gameplay; menu, ambient, and cosmetic mixers may use presentation time.
- Map gameplay states to clips: idle, walk/run, jump, attack/slash/shoot, hurt, fall, turn.
- Decide whether root motion is used. For arcade games, prefer in-place animation and move the entity in code.
- Keep simple collision proxies independent from the detailed imported mesh.
- Add an actionable loading/error state if an asset fails to load. Use a
  clearly labeled local placeholder only when it preserves useful progress.
- Report file size, clip names, approximate triangles, and texture count after import.

Create each action once, then transition actions instead of calling
`clipAction()` every frame. Cross-fade locomotion loops and configure one-shots
explicitly:

```ts
const mixer = new THREE.AnimationMixer(visualRoot);
const actions = new Map(
  gltf.animations.map((clip) => [clip.name, mixer.clipAction(clip)] as const),
);
let activeAction: THREE.AnimationAction | undefined;

type ActionTransition = {
  fadeSeconds?: number;
  once?: boolean;
};

function playAction(
  name: string,
  { fadeSeconds = 0.15, once = false }: ActionTransition = {},
): THREE.AnimationAction {
  const next = actions.get(name);
  if (!next) throw new Error(`Missing animation clip: ${name}`);
  if (next === activeAction && !once) return next;

  const previous = activeAction;
  next.reset().setEffectiveTimeScale(1).setEffectiveWeight(1);
  next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
  next.clampWhenFinished = once;
  next.fadeIn(fadeSeconds).play();
  if (previous && previous !== next) previous.fadeOut(fadeSeconds);
  activeAction = next;
  return next;
}

function updateGameplayAnimation(simulationAnimationDelta: number): void {
  mixer.update(simulationAnimationDelta);
}
```

An independently owned cosmetic mixer would call `update(presentationDelta)`
from the presentation update instead.

Listen for the mixer's `finished` event when a one-shot must return to an idle
or locomotion state, and remove that listener during teardown. Deterministic hit
windows, damage, and collision remain simulation events; mixer callbacks only
drive presentation or request a canonical state transition.

Before releasing an animated instance, remove mixer listeners, call
`mixer.stopAllAction()`, then `mixer.uncacheRoot(visualRoot)`. Remove the visual
root only after the mixer no longer owns bindings to it.

## Input And Intent

- Convert keyboard, pointer, touch, and gamepad where relevant into game intents.
- Keep input collection separate from simulation.
- Support both desktop and mobile when the user asks for a browser game unless explicitly desktop-only.
- Handle pointer release/cancel/blur so controls do not stick.
- Keep CSS `touch-action` intentional and scoped.
- Preserve focus and restart controls after fail/pause.

Track sources independently, then compose the action. Releasing one key or
pointer must not cancel the same action still held by another source.

```ts
type Action = 'move-left' | 'move-right' | 'jump' | 'dash' | 'pause';

class ActionMap {
  private readonly sources = new Map<Action, Set<string>>();
  private readonly pressed = new Set<Action>();

  set(action: Action, source: string, down: boolean): void {
    const active = this.sources.get(action) ?? new Set<string>();
    this.sources.set(action, active);
    const wasDown = active.size > 0;
    if (down) active.add(source);
    else active.delete(source);
    if (!wasDown && active.size > 0) this.pressed.add(action);
  }

  held(action: Action): boolean {
    return (this.sources.get(action)?.size ?? 0) > 0;
  }

  consumePressed(action: Action): boolean {
    const value = this.pressed.has(action);
    this.pressed.delete(action);
    return value;
  }

  clear(): void {
    this.sources.clear();
    this.pressed.clear();
  }
}
```

Use stable source IDs such as `keyboard:Space`, `pointer:17`,
`gamepad:0:button:1`. Clear sources on blur, visibility loss, pointer cancel,
controller disconnect, pause, and teardown.

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

Use dependency-free custom collision and authored kinematics for bounded arcade
work such as triggers, lanes, pickups, bullets, rails, ramps, and simple moving
platforms. Use official Three.js math addons such as `Capsule`, `Octree`, and
`OBB` when their collision model fits. General rigid-body dynamics, stable
stacks, constraints, ragdolls, or many interacting bodies justify an explicit
physics-engine decision instead of a growing custom solver.

When physics is in scope, read `physics.md` and the official physics manual
before choosing colliders and a fixed-step model. Preserve an engine already
owned by an existing project when replacement is out of scope. For a new
dependency, record why simple/addon collision is insufficient, confirm the
runtime and licensing footprint, and obtain the same dependency approval used
for other architecture changes; never install or expand an engine silently.

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

## Official Documentation

- [Timer](https://threejs.org/docs/pages/Timer.html)
- [Object3D](https://threejs.org/docs/pages/Object3D.html)
- [Scene graph manual](https://threejs.org/manual/en/scenegraph.html)
- [AnimationMixer](https://threejs.org/docs/pages/AnimationMixer.html)
- [AnimationAction](https://threejs.org/docs/pages/AnimationAction.html)
- [Physics manual](https://threejs.org/manual/en/physics.html)

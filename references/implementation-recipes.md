# Cross-System Game Implementation Recipes

## Contents

- Choose this reference when
- Novice mental model
- Smallest correct game core
- Production recipes
- Action map
- Game-state machine
- Fixed-step loop and interpolation
- Pools and projectiles
- Third-person camera rig
- Asset ownership and reference counting
- Enemy steering and wave scheduling
- Settings and save snapshots
- Deterministic replay
- Common failures
- Performance
- Disposal
- Verification
- Official documentation

## Choose This Reference When

Read this file when several systems must work together: input and simulation,
game state and UI, pooled entities and rendering, a player and camera, loaded
assets and disposal, enemies and wave timing, settings and saves, or replay and
bot tests. These recipes are plain TypeScript patterns around Three.js; adapt
them to the existing project rather than installing a framework.

Use them to establish one owner for each responsibility before adding content.
Do not introduce all recipes into a focused fix. Choose only the contracts the
game actually needs.

## Novice Mental Model

A game is not the scene graph. The scene graph presents game state. Keep the
authoritative flow explicit:

```text
device input
  -> semantic actions
  -> fixed simulation
  -> rules and state transitions
  -> presentation transforms, animation, VFX, camera, UI, audio
  -> renderer
```

Each fact has one owner. The player controller owns accepted player movement;
the camera follows it. The game-state machine owns whether simulation runs; the
pause menu reflects it. The asset store owns shared GPU resources; individual
enemies borrow them. Replay supplies recorded actions to the same simulation;
it does not call DOM handlers.

Prefer simple data and explicit functions. Three.js objects are presentation
and spatial tools, not a substitute for rules, saves, or deterministic state.

## Smallest Correct Game Core

Start with a phase, a fixed simulation step, one timing owner, and a separate
render/presentation call:

```ts
import * as THREE from 'three';

type Phase =
  | 'loading'
  | 'load-error'
  | 'menu'
  | 'playing'
  | 'paused'
  | 'won'
  | 'lost';

const FIXED_STEP = 1 / 60;
const MAX_STEPS_PER_FRAME = 5;
const timer = new THREE.Timer();
timer.connect(document);

let phase: Phase = 'loading';
let accumulator = 0;

renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const frameDelta = Math.min(timer.getDelta(), 0.1);
  input.sampleDevices();

  if (phase === 'playing') accumulator += frameDelta;
  else accumulator = 0; // this recipe never carries partial time across phases

  let steps = 0;
  while (
    phase === 'playing' &&
    accumulator >= FIXED_STEP &&
    steps < MAX_STEPS_PER_FRAME
  ) {
    input.beginStep();
    updateSimulation(FIXED_STEP);
    input.endStep();
    accumulator -= FIXED_STEP;
    steps += 1;

    // A win, loss, pause, or menu transition may occur inside the step. Do not
    // simulate another playing step, and do not carry stale fractional time.
    if (phase !== 'playing') accumulator = 0;
  }

  if (
    phase === 'playing' &&
    steps === MAX_STEPS_PER_FRAME &&
    accumulator >= FIXED_STEP
  ) {
    telemetry.count('simulation-overload');
    accumulator = 0; // protect the interactive session from a spiral
  }

  const alpha = phase === 'playing' ? accumulator / FIXED_STEP : 0;
  presentInterpolatedState(alpha, frameDelta);
  renderer.render(scene, camera);
});
```

This real-time overload policy drops excess accumulated time. A deterministic
offline replay must not drop steps; run it as fast as needed without a render
deadline. Keep loading/menu/pause presentation alive while their gameplay
simulation is stopped. This recipe deliberately clears the accumulator whenever
play stops and checks `phase` before every step, so a transition raised by
`updateSimulation()` takes effect immediately. If a game chooses to preserve a
partial step across pause instead, declare and test that policy explicitly.

## Production Recipes

### Action map

Map keyboard, pointer, touch, and gamepad into stable meanings such as `jump`
and `fire`. Queue edges so a quick press between simulation steps is not lost:

```ts
type ButtonAction = 'jump' | 'fire' | 'interact' | 'pause';
type ButtonSource = string; // stable binding ID, e.g. "keyboard:Space"

class ActionMap {
  private readonly heldSources = new Map<ButtonAction, Set<ButtonSource>>();
  private readonly pendingPressed = new Set<ButtonAction>();
  private readonly pendingReleased = new Set<ButtonAction>();
  private readonly stepPressed = new Set<ButtonAction>();
  private readonly stepReleased = new Set<ButtonAction>();

  moveX = 0;
  moveY = 0;
  lookX = 0;
  lookY = 0;

  setButton(source: ButtonSource, action: ButtonAction, down: boolean) {
    let sources = this.heldSources.get(action);
    if (!sources) {
      if (!down) return;
      sources = new Set();
      this.heldSources.set(action, sources);
    }

    const wasDown = sources.size > 0;
    if (down) sources.add(source);
    else sources.delete(source);
    const isDown = sources.size > 0;

    if (sources.size === 0) this.heldSources.delete(action);
    if (isDown === wasDown) return;
    (isDown ? this.pendingPressed : this.pendingReleased).add(action);
  }

  clearSource(source: ButtonSource) {
    for (const [action, sources] of this.heldSources) {
      const wasDown = sources.size > 0;
      sources.delete(source);
      if (sources.size === 0) this.heldSources.delete(action);
      if (wasDown && sources.size === 0) this.pendingReleased.add(action);
    }
  }

  beginStep() {
    this.stepPressed.clear();
    this.stepReleased.clear();
    for (const action of this.pendingPressed) this.stepPressed.add(action);
    for (const action of this.pendingReleased) this.stepReleased.add(action);
    this.pendingPressed.clear();
    this.pendingReleased.clear();
  }

  isDown(action: ButtonAction) {
    return (this.heldSources.get(action)?.size ?? 0) > 0;
  }

  wasPressed(action: ButtonAction) {
    return this.stepPressed.has(action);
  }

  wasReleased(action: ButtonAction) {
    return this.stepReleased.has(action);
  }

  endStep() {
    this.stepPressed.clear();
    this.stepReleased.clear();
  }

  clear() {
    this.heldSources.clear();
    this.pendingPressed.clear();
    this.pendingReleased.clear();
    this.endStep();
    this.moveX = this.moveY = this.lookX = this.lookY = 0;
  }
}
```

DOM listeners call only `setButton(source, action, down)` or update raw axes.
An action is held while *any* mapped source remains held, so releasing Space
cannot cancel a jump still held on gamepad A. Pressed/released edges describe
the aggregate action transition, not every device transition. Call
`clearSource()` when one controller/binding disconnects and `clear()` only when
the whole input context loses ownership. The simulation reads the action map.
Normalize diagonal movement once:

```ts
const move = new THREE.Vector2(actions.moveX, actions.moveY);
if (move.lengthSq() > 1) move.normalize();
```

Resolve multiple devices with a declared rule: most-recent device, maximum
magnitude, or user-selected device. Clear actions on blur, visibility loss,
pointer cancel/unlock, pause, and gamepad disconnect. Make bindings,
sensitivity, inversion, dead zones, and hold/toggle behavior settings rather
than scattered conditions.

### Game-state machine

Make legal transitions explicit and put side effects at state boundaries:

```ts
type GamePhase =
  | 'boot'
  | 'loading'
  | 'load-error'
  | 'menu'
  | 'playing'
  | 'paused'
  | 'won'
  | 'lost';

const allowed: Record<GamePhase, readonly GamePhase[]> = {
  boot: ['loading'],
  loading: ['menu', 'load-error'],
  'load-error': ['loading', 'menu'], // retry or return safely
  menu: ['playing'],
  playing: ['paused', 'won', 'lost', 'menu'],
  paused: ['playing', 'menu'],
  won: ['playing', 'menu'],
  lost: ['playing', 'menu'],
};

class GameStateMachine {
  phase: GamePhase = 'boot';

  transition(next: GamePhase) {
    if (!allowed[this.phase].includes(next)) {
      throw new Error(`Illegal game transition: ${this.phase} -> ${next}`);
    }

    const previous = this.phase;
    this.exit(previous);
    this.phase = next;
    this.enter(next, previous);
  }

  private exit(phase: GamePhase) {
    if (phase === 'playing') input.clearTransientLook();
  }

  private enter(phase: GamePhase, previous: GamePhase) {
    input.clear();
    ui.showPhase(phase);
    audio.onPhaseChanged(previous, phase);
    if (phase === 'playing') timer.reset();
  }
}
```

Keep transition code idempotent and small. A state boundary may enable systems,
switch UI, lock/unlock input, pause audio, capture a save, or reset a level, but
it must not leave two phase owners active. Use sub-state machines for a boss or
player only when their lifecycle is independent of the global phase.

On a required asset failure, transition from `loading` to `load-error` and keep
the failure visible. Retry creates a fresh loading attempt/manager first, then
transitions back to `loading`; it never bypasses the state machine or lets the
failed attempt later enter `menu`.

### Fixed simulation and render interpolation

Store previous and current authoritative transforms around each fixed update:

```ts
type BodyState = {
  previous: THREE.Vector3;
  current: THREE.Vector3;
  velocity: THREE.Vector3;
  visual: THREE.Object3D;
};

function simulateBody(body: BodyState, dt: number) {
  body.previous.copy(body.current);
  body.current.addScaledVector(body.velocity, dt);
}

function presentBody(body: BodyState, alpha: number) {
  body.visual.position.lerpVectors(body.previous, body.current, alpha);
}
```

Interpolate presentation only. Collision and rules always use `current` fixed
state. For rotations, keep previous/current quaternions and `slerpQuaternions`.
Run systems in a stable order, for example:

```text
actions -> player/controllers -> physics/collision -> rules/triggers
-> enemy steering/spawns -> state events -> snapshot previous/current
```

After the fixed loop, update visual animation/VFX, camera, UI/audio bridges,
then render. Do not let render interpolation feed back into simulation.

### Pools and projectiles

Preallocate frequently spawned short-lived objects. This projectile pool shares
one geometry/material and stores simulation separately from visual state:

```ts
type Projectile = {
  active: boolean;
  ownerId: string;
  age: number;
  maxAge: number;
  radius: number;
  previous: THREE.Vector3;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  mesh: THREE.Mesh;
};

class ProjectilePool {
  readonly geometry = new THREE.SphereGeometry(0.08, 8, 6);
  readonly material = new THREE.MeshBasicMaterial({ color: 0xffd36b });
  readonly items: Projectile[];

  constructor(private readonly scene: THREE.Scene, capacity = 64) {
    this.items = Array.from({ length: capacity }, () => {
      const mesh = new THREE.Mesh(this.geometry, this.material);
      mesh.visible = false;
      scene.add(mesh);
      return {
        active: false,
        ownerId: '',
        age: 0,
        maxAge: 0,
        radius: 0.08,
        previous: new THREE.Vector3(),
        position: new THREE.Vector3(),
        velocity: new THREE.Vector3(),
        mesh,
      };
    });
  }

  spawn(
    ownerId: string,
    origin: THREE.Vector3,
    direction: THREE.Vector3,
    speed: number,
    lifetime: number,
  ) {
    const projectile = this.items.find((item) => !item.active);
    if (!projectile) return false; // explicit pool-exhaustion policy
    projectile.active = true;
    projectile.ownerId = ownerId;
    projectile.age = 0;
    projectile.maxAge = lifetime;
    projectile.position.copy(origin);
    projectile.previous.copy(origin);
    projectile.velocity.copy(direction).normalize().multiplyScalar(speed);
    projectile.mesh.position.copy(origin);
    projectile.mesh.visible = true;
    return true;
  }

  update(dt: number, collisions: CollisionQueries) {
    for (const projectile of this.items) {
      if (!projectile.active) continue;
      projectile.age += dt;
      projectile.previous.copy(projectile.position);
      projectile.position.addScaledVector(projectile.velocity, dt);

      const hit = collisions.sweepSphere(
        projectile.previous,
        projectile.position,
        projectile.radius,
        projectile.ownerId,
      );
      if (hit) {
        events.emit('projectile-hit', { projectile, hit });
        this.release(projectile);
      } else if (projectile.age >= projectile.maxAge) {
        this.release(projectile);
      }
    }
  }

  present(alpha: number) {
    for (const projectile of this.items) {
      if (!projectile.active) continue;
      projectile.mesh.position.lerpVectors(
        projectile.previous,
        projectile.position,
        alpha,
      );
    }
  }

  private release(projectile: Projectile) {
    projectile.active = false;
    projectile.mesh.visible = false;
    projectile.ownerId = '';
    projectile.velocity.set(0, 0, 0);
  }

  dispose() {
    for (const projectile of this.items) this.scene.remove(projectile.mesh);
    this.geometry.dispose();
    this.material.dispose();
  }
}
```

Sweep from previous to next position so fast projectiles do not tunnel through
thin targets. Call `projectilePool.present(alpha)` once from
`presentInterpolatedState()` after the fixed-step loop; gameplay collision reads
`position`, never the interpolated mesh position. Use collision proxies, not
render triangles. Decide whether pool exhaustion rejects the spawn, recycles
the oldest projectile, or expands the pool only in development.

### Pickup / VFX event bus

Keep collectibles and presentation effects out of each other's ownership. Emit
gameplay events; let a single VFX owner react (see `vfx.md`):

```ts
type GameEvent =
  | { type: 'pickup-collected'; id: string; position: THREE.Vector3; value: number }
  | { type: 'player-hit'; position: THREE.Vector3; intensity: number };

class EventBus {
  private readonly listeners = new Map<string, Set<(event: GameEvent) => void>>();

  on(type: GameEvent['type'], fn: (event: GameEvent) => void): () => void {
    const set = this.listeners.get(type) ?? new Set();
    set.add(fn);
    this.listeners.set(type, set);
    return () => set.delete(fn);
  }

  emit(event: GameEvent): void {
    for (const fn of this.listeners.get(event.type) ?? []) fn(event);
  }
}

// Gameplay
bus.emit({ type: 'pickup-collected', id, position: pickup.position.clone(), value: 1 });

// Presentation (one subscriber)
bus.on('pickup-collected', (event) => {
  if (event.type !== 'pickup-collected') return;
  vfx.emit({ type: 'pickup', position: event.position });
  audio.play('pickup', { position: event.position });
});
```

Do not spawn meshes or particles inside the pickup collision handler beyond
updating authoritative score/state.
the oldest, or grows only at a safe transition; never allocate unpredictably
during peak combat.

For hundreds of visually identical items, project pool state into an
`InstancedMesh`. Keep pool slot and `instanceId` aligned, update matrices in one
batch, and mark `instanceMatrix.needsUpdate` once.

### Third-person camera rig

Follow one semantic target, derive a desired boom pose, solve camera collision,
then smooth. Reuse all temporary values:

```ts
class ThirdPersonCamera {
  private readonly targetPosition = new THREE.Vector3();
  private readonly desiredPosition = new THREE.Vector3();
  private readonly offset = new THREE.Vector3(0, 2.6, 5.5);
  private readonly direction = new THREE.Vector3();
  private readonly targetQuaternion = new THREE.Quaternion();
  private readonly raycaster = new THREE.Raycaster();

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly target: THREE.Object3D,
    private readonly blockers: THREE.Object3D[],
  ) {}

  update(deltaSeconds: number) {
    this.target.getWorldPosition(this.targetPosition);
    this.targetPosition.y += 1.35;
    this.target.getWorldQuaternion(this.targetQuaternion);

    this.desiredPosition
      .copy(this.offset)
      .applyQuaternion(this.targetQuaternion)
      .add(this.targetPosition);

    this.direction.subVectors(this.desiredPosition, this.targetPosition);
    const desiredDistance = this.direction.length();
    this.direction.normalize();
    this.raycaster.set(this.targetPosition, this.direction);
    this.raycaster.far = desiredDistance;

    const [hit] = this.raycaster.intersectObjects(this.blockers, true);
    if (hit) {
      const safeDistance = Math.max(0.25, hit.distance - 0.2);
      this.desiredPosition.copy(this.targetPosition)
        .addScaledVector(this.direction, safeDistance);
    }

    const blend = 1 - Math.exp(-10 * deltaSeconds);
    const movingInward = hit !== undefined &&
      this.camera.position.distanceTo(this.targetPosition) >
        this.desiredPosition.distanceTo(this.targetPosition);

    if (movingInward) this.camera.position.copy(this.desiredPosition);
    else this.camera.position.lerp(this.desiredPosition, blend);
    this.camera.lookAt(this.targetPosition);
  }
}
```

Use a yaw-only gameplay root for the target quaternion unless pitch/roll should
rotate the boom. Raycast against simple camera blockers on a dedicated layer.
Snap inward to prevent wall clipping; smooth outward to avoid pops. For a
camera inside a collider, add an overlap recovery strategy rather than trusting
one ray.

Apply camera shake/kick after the stable rig pose as a bounded presentation
offset. Restore the stable pose every frame so impulses do not accumulate.

### Asset ownership and reference counting

Deduplicate in-flight loads and release shared GPU resources only after the last
borrower:

```ts
type OwnedAsset<T> = { value: T; dispose(): void };
type Entry<T> = {
  promise: Promise<OwnedAsset<T>>;
  asset?: OwnedAsset<T>;
  references: number;
};

class AssetStore<T> {
  private readonly entries = new Map<string, Entry<T>>();

  async acquire(key: string, load: () => Promise<OwnedAsset<T>>) {
    let entry = this.entries.get(key);
    if (!entry) {
      entry = { promise: load(), references: 0 };
      this.entries.set(key, entry);
    }
    entry.references += 1;

    try {
      const asset = await entry.promise;
      entry.asset ??= asset;
      let released = false;
      return {
        value: asset.value,
        release: () => {
          if (released) return;
          released = true;
          entry!.references -= 1;
          if (entry!.references === 0) {
            entry!.asset?.dispose();
            this.entries.delete(key);
          }
        },
      };
    } catch (error) {
      entry.references -= 1;
      if (entry.references === 0) this.entries.delete(key);
      throw error;
    }
  }
}
```

At application shutdown, assert that normal gameplay references reached zero.
A force-dispose method is acceptable only at final teardown after mixers,
instances, scenes, and render loops stop.

For animated glTF: the store owns the loaded source resources; a borrower uses
`SkeletonUtils.clone(source.scene)`, owns its mixer and instance-specific
materials, then removes the clone and releases the handle. Do not traverse and
dispose shared source resources from the clone.

### Enemy steering and wave scheduling

Use fixed-step steering for open-space motion. Seek computes a desired velocity
and clamps acceleration:

```ts
const desired = new THREE.Vector3();
const steering = new THREE.Vector3();

function steerToward(
  enemy: EnemyState,
  target: THREE.Vector3,
  dt: number,
) {
  desired.subVectors(target, enemy.position);
  desired.y = 0;
  if (desired.lengthSq() > 0.0001) desired.normalize();
  desired.multiplyScalar(enemy.maxSpeed);

  steering.subVectors(desired, enemy.velocity);
  steering.clampLength(0, enemy.maxAcceleration);
  enemy.velocity.addScaledVector(steering, dt);
  enemy.velocity.clampLength(0, enemy.maxSpeed);
  enemy.position.addScaledVector(enemy.velocity, dt);
}
```

Add separation from neighbors returned by a spatial grid, not an all-pairs scan
for a large crowd. Clamp each contribution, weight seek/separation/avoidance,
then clamp final acceleration. Steering does not find a path through a maze;
use authored routes, a navigation graph/mesh, or flow field when obstacles
require global planning.

Schedule waves by simulation time, not `setTimeout()`, so pause and replay are
correct:

```ts
type SpawnEvent = {
  at: number;
  kind: 'grunt' | 'runner' | 'tank';
  count: number;
  radius: number;
};

class WaveDirector {
  private time = 0;
  private eventIndex = 0;

  constructor(
    private readonly events: readonly SpawnEvent[],
    private readonly rng: SeededRandom,
  ) {}

  update(dt: number, center: THREE.Vector3) {
    this.time += dt;
    while (
      this.eventIndex < this.events.length &&
      this.events[this.eventIndex].at <= this.time
    ) {
      const event = this.events[this.eventIndex++];
      for (let i = 0; i < event.count; i += 1) {
        const angle = this.rng.float() * Math.PI * 2;
        enemyPool.spawn(event.kind, {
          x: center.x + Math.cos(angle) * event.radius,
          z: center.z + Math.sin(angle) * event.radius,
        });
      }
    }
  }

  reset() {
    this.time = 0;
    this.eventIndex = 0;
    this.rng.reset();
  }
}
```

Sort events by `at` during content validation, not every update. Validate spawn
points against navigation/collision and the camera's unfair-spawn exclusion
zone. Pool enemies and make a clear policy when capacity is exhausted.
Give each director an exclusive seeded random stream if `reset()` owns that
stream; shared random streams need a higher-level snapshot/restore owner.

### Settings and save snapshots

Save plain versioned data, never Three.js objects:

```ts
type SettingsV1 = {
  version: 1;
  masterVolume: number;
  lookSensitivity: number;
  invertY: boolean;
  reducedMotion: boolean;
};

const defaultSettings: SettingsV1 = {
  version: 1,
  masterVolume: 0.8,
  lookSensitivity: 1,
  invertY: false,
  reducedMotion: false,
};

function loadSettings(): SettingsV1 {
  try {
    const raw = localStorage.getItem('game.settings');
    if (!raw) return { ...defaultSettings };
    const value = JSON.parse(raw) as Partial<SettingsV1>;
    if (value.version !== 1) return { ...defaultSettings };
    const volume = Number(value.masterVolume);
    const sensitivity = Number(value.lookSensitivity);
    return {
      version: 1,
      masterVolume: THREE.MathUtils.clamp(
        Number.isFinite(volume) ? volume : defaultSettings.masterVolume,
        0,
        1,
      ),
      lookSensitivity: THREE.MathUtils.clamp(
        Number.isFinite(sensitivity)
          ? sensitivity
          : defaultSettings.lookSensitivity,
        0.1,
        4,
      ),
      invertY: value.invertY === true,
      reducedMotion: value.reducedMotion === true,
    };
  } catch {
    return { ...defaultSettings };
  }
}

function saveSettings(settings: SettingsV1) {
  try {
    localStorage.setItem('game.settings', JSON.stringify(settings));
  } catch (error) {
    console.warn('Settings could not be saved', error);
  }
}
```

Avoid `Number(value) || default` because it replaces a valid zero and handles
corrupt values inconsistently. Parse, test `Number.isFinite`, fall back to a
known default, then clamp to the supported range.

A game snapshot should contain a schema version, content/build version, level
ID, seed, simulation tick, progression, stable entity IDs, and canonical
numbers/booleans/strings. Reconstruct scene objects and cached resources from
that data. Write at checkpoints or transitions, not every frame. Validate and
migrate old versions; never evaluate data or store credentials/secrets.

### Deterministic replay

Route every gameplay random decision through a seeded generator:

```ts
class SeededRandom {
  private readonly initialState: number;
  private state: number;

  constructor(seed: number) {
    this.initialState = (seed >>> 0) || 0x6d2b79f5;
    this.state = this.initialState;
  }

  uint32() {
    let value = this.state;
    value ^= value << 13;
    value ^= value >>> 17;
    value ^= value << 5;
    this.state = value >>> 0;
    return this.state;
  }

  float() {
    return this.uint32() / 0x1_0000_0000;
  }

  reset() {
    this.state = this.initialState;
  }

  getState() {
    return this.state;
  }
}
```

Record semantic input per simulation tick, not DOM events or render frames:

```ts
type ReplayHeader = {
  schema: 1;
  build: string;
  level: string;
  seed: number;
  fixedStep: number;
};

type ReplayFrame = {
  buttons: number; // stable bit field
  moveX: number;   // quantized signed byte -127..127
  moveY: number;
  lookX: number;
  lookY: number;
};
```

Playback supplies each `ReplayFrame` to the same action/simulation function and
advances exactly one fixed step. Disable live gameplay input, wall-clock timers,
`Math.random()`, asynchronous rule decisions, and frame-rate-dependent motion.
Keep stable entity iteration order; assign deterministic IDs rather than using
random UUIDs for rule ordering.

Add periodic canonical checksums over quantized gameplay data and compare them
during playback. Hash positions, velocities, health, scores, active IDs, RNG
state, wave index, and phase—not render matrices, GPU particles, audio state, or
wall time. Store occasional snapshots for seek/debug, but keep input frames as
the source of truth.

Browser floating-point and physics implementations can differ. Define the
supported determinism boundary: normally the same build, content, fixed step,
and simulation implementation. Replay is a QA/debug artifact, not an anti-cheat
security system.

## Common Failures

- **Two systems move the player/camera:** authority was never declared; visual
  and collision transforms drift.
- **Jump fires twice or is missed:** device held state was read as an edge, or a
  fast edge was not queued until the next fixed step.
- **Game speeds up with FPS:** simulation uses per-frame increments instead of
  seconds/fixed steps.
- **Spiral after tab resume:** delta was not clamped and Timer was not connected
  to document visibility.
- **Paused game still spawns enemies:** waves use `setTimeout()` or update
  outside the playing-state gate.
- **Projectile tunnels:** only its final point was tested; sweep previous to
  next.
- **Pool still allocates:** spawn creates vectors/materials/listeners, or pool
  grows during peak play.
- **Camera clips into walls:** it smooths before collision or only tests the
  final point.
- **Camera jitters:** it follows fixed state without interpolation, two owners
  write it, or target/camera smoothing is stacked.
- **Asset unload turns other models black:** a borrower disposed shared source
  geometry/material/texture.
- **Duplicate local loads:** cache stores only completed assets rather than the
  in-flight promise.
- **Enemies clump or oscillate:** steering contributions are unbounded, neighbor
  query/order is unstable, or no spatial broadphase exists.
- **Wave differs after pause/replay:** wall time or unseeded randomness controls
  spawning.
- **Save cannot load after update:** snapshot lacks version/content migration or
  stores scene serialization as canonical game state.
- **Replay diverges:** live input, `Math.random`, wall time, unordered rule
  iteration, dropped steps, or build/content mismatch remains.

## Performance

- Profile systems independently: fixed simulation, collision, steering,
  animation, camera, UI, render CPU, and GPU.
- Keep fixed-step work allocation-free; reuse vectors and arrays.
- Use dense pools and swap-remove active records when iteration cost matters.
- Replace all-pairs enemy/projectile checks with a uniform grid, spatial hash,
  sweep-and-prune, or measured physics broadphase.
- Project many identical pooled visuals through `InstancedMesh`; use
  `BatchedMesh` for compatible mixed geometry.
- Update instance buffers once after the simulation batch.
- Keep camera blockers simple and on an intentional layer.
- Memoize in-flight asset promises and retain decoded shared sources.
- Save at checkpoints, debounce settings writes, and never serialize every
  render frame.
- Quantize replay axes and snapshot fields to control file size and checksum
  noise.
- Treat overload counters as defects to investigate, not permission to keep
  dropping simulation time.

## Disposal

Teardown in reverse ownership order:

1. Stop `renderer.setAnimationLoop(null)` and disconnect the `Timer`.
2. Stop accepting device input; remove listeners and clear action state.
3. Exit the active game state and cancel transitions/waves.
4. Stop mixers, audio voices, particles, projectiles, and pooled effects.
5. Remove game instances and release their asset handles.
6. Dispose shared asset sources after the final reference reaches zero.
7. Dispose pool geometry/materials, camera controls/proxies, render targets,
   scene resources, and renderer as owned.
8. Clear DOM UI/debug panels and any remaining references.

Each release handle must be idempotent. In development, assert negative or
nonzero reference counts, double releases, active pool items at level teardown,
remaining mixer listeners, and live timers. A final forced asset-store disposal
must happen only after borrowers stop.

## Verification

1. Run the same input at 30, 60, 120, and throttled frame rates; compare final
   authoritative state, not only visuals.
2. Press/release actions between fixed steps, hold across focus loss, pause,
   pointer unlock, and controller disconnect.
3. Exercise every legal and illegal game-state transition, including repeated
   pause/resume, retry, win/loss, and return to menu.
4. Exhaust each pool and verify its declared policy, collision sweep, reuse,
   active count, and zero hot-path allocations.
5. Move the third-person camera against walls, corners, low ceilings, inside a
   blocker, during teleport, and during target destruction.
6. Acquire one asset concurrently from multiple callers, release in different
   orders, then reload after final disposal.
7. Run maximum enemy count and verify steering, spatial query, fair spawn
   exclusion, wave completion, pause, and retry reset.
8. Corrupt, omit, downgrade, and migrate settings/save data. Test storage quota
   or unavailable storage without blocking play.
9. Record a replay, play it twice, compare periodic checksums, then deliberately
   change one input frame and confirm divergence is localized.
10. Teardown/re-enter repeatedly and verify listeners, pools, timers, mixers,
    assets, geometries, materials, textures, and render targets return to the
    same steady state.

## Official Documentation

- [Timer](https://threejs.org/docs/pages/Timer.html)
- [WebGLRenderer.setAnimationLoop](https://threejs.org/docs/pages/WebGLRenderer.html)
- [Object3D transforms](https://threejs.org/docs/pages/Object3D.html)
- [Vector2](https://threejs.org/docs/pages/Vector2.html)
- [Vector3](https://threejs.org/docs/pages/Vector3.html)
- [Quaternion](https://threejs.org/docs/pages/Quaternion.html)
- [MathUtils](https://threejs.org/docs/pages/MathUtils.html)
- [Raycaster](https://threejs.org/docs/pages/Raycaster.html)
- [InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html)
- [BatchedMesh](https://threejs.org/docs/pages/BatchedMesh.html)
- [GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html)
- [SkeletonUtils](https://threejs.org/docs/pages/module-SkeletonUtils.html)
- [AnimationMixer](https://threejs.org/docs/pages/AnimationMixer.html)
- [Cleanup manual](https://threejs.org/manual/en/cleanup.html)
- [How to dispose of objects](https://threejs.org/manual/en/how-to-dispose-of-objects.html)

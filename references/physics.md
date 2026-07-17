# Physics And Collision

Use this reference before changing collision-heavy gameplay, projectiles,
vehicles, ball games, platforms, sensors, or fast movement. Start with Three.js
math, official math addons, and project code when those honestly fit. Adding a
physics engine is an architecture and dependency decision: obtain explicit
approval, pin and host it according to the project's local-first policy, and
define its world, stepping, synchronization, teardown, and asset ownership.
Preserve an engine already owned by an existing project unless migration is in
scope; do not expand it merely to avoid a small, well-bounded collision query.

## Contents

- Scope and simulation ownership
- Fixed stepping and collider data
- Overlap, sweep, and response patterns
- Broadphase and official Three.js collision addons
- Arcade bodies, surfaces, and sensors
- Diagnostics, verification, and limits

## Choose The Smallest Honest Model

Use authored kinematics and simple colliders for:

- triggers, pickups, checkpoints, goals, and damage volumes
- arena, lane, runner, shooter, racer, and top-down movement
- bullets, beams, missiles, balls, bumpers, rails, and simple ramps
- moving platforms and scripted obstacles
- mini-golf, pinball, or pool-like arcade behavior with a bounded number of
  spheres and explicitly authored surfaces

Do not pretend a small custom solver provides general rigid-body stacks,
ragdolls, arbitrary convex contacts, or production vehicle suspension. When a
requested design fundamentally needs those features, choose deliberately:

| Need | Smallest honest model |
|---|---|
| triggers, pickups, simple projectiles, rails, authored movement | project-owned overlap/sweep code using `Box3`, `Sphere`, `Ray`, and planes |
| character against a static triangle world | official `Capsule` plus `Octree`, built from a simplified collision-only scene |
| rotated rigid bounds without dynamics | official `OBB`, transformed from canonical local bounds |
| stacks, joints, ragdolls, arbitrary convex dynamics, robust vehicles | explicitly approved and locally pinned physics engine |

Three.js also ships `AmmoPhysics`, `JoltPhysics`, and `RapierPhysics` convenience
addons. In r185 these automatically import their engines from a CDN. That
violates an offline/local-first runtime unless the external engine is deliberately
vendored and the integration adapted. Do not copy those wrappers unchanged into
a project that promises local-only runtime assets.

## One Simulation Owner

Keep collider state in a gameplay system, not in render code. Visual meshes
project from canonical position, velocity, orientation, and state after each
simulation step.

```text
input intents
  -> fixed simulation and collision resolution
  -> gameplay events/state
  -> animation/VFX/camera/UI/audio
  -> render
```

Use stable entity IDs and explicit collider data. A collider should reference
an entity or gameplay callback without owning its mesh.

```ts
type SphereCollider = {
  id: number
  center: THREE.Vector3
  radius: number
  layer: number // one bit flag, for example 1 << 2; not the ordinal 2
  mask: number
  sensor: boolean
}

type AabbCollider = {
  id: number
  min: THREE.Vector3
  max: THREE.Vector3
  layer: number
  mask: number
  sensor: boolean
}
```

Share simple immutable shapes when possible. Keep temporary vectors on the
system and reuse them in hot loops.

## Fixed-Step Simulation

Use a fixed step when results depend on timing, speed, bounce, or repeated
contacts. Clamp tab-sleep spikes and cap catch-up work.

```ts
const FIXED_DT = 1 / 60
const MAX_STEPS = 5
let accumulator = 0

function frame(deltaSeconds: number) {
  accumulator += Math.min(deltaSeconds, 0.1)
  let steps = 0
  while (accumulator >= FIXED_DT && steps < MAX_STEPS) {
    simulate(FIXED_DT)
    accumulator -= FIXED_DT
    steps += 1
  }
  if (steps === MAX_STEPS && accumulator >= FIXED_DT) accumulator = 0
}
```

This is the package's interactive overload policy: if a full step still remains
after five catch-up steps, clear the remaining accumulator—including its
fractional remainder—so a slow frame cannot create a spiral. Deterministic
offline replay must process all steps without this real-time deadline.

Variable-delta movement is acceptable for slow, non-physical UI-like motion,
but collision tests must use the same committed transforms as gameplay.

## Overlap Tests

Sphere-sphere trigger:

```ts
const delta = new THREE.Vector3()

function spheresOverlap(a: SphereCollider, b: SphereCollider): boolean {
  const radius = a.radius + b.radius
  return delta.copy(a.center).sub(b.center).lengthSq() <= radius * radius
}
```

Sphere-AABB trigger or penetration candidate:

```ts
const closest = new THREE.Vector3()

function sphereAabbOverlap(sphere: SphereCollider, box: AabbCollider): boolean {
  closest.copy(sphere.center).clamp(box.min, box.max)
  return closest.distanceToSquared(sphere.center) <= sphere.radius * sphere.radius
}
```

For capsules, represent the center line plus radius. Find the closest point on
the segment to the other primitive, then compare squared distance. For oriented
boxes, first transform the query point or segment into box-local space; keep
the collider's inverse matrix cached until its transform changes.

Filter before narrow-phase work:

```ts
const shouldTest = (a: SphereCollider, b: SphereCollider) =>
  (a.mask & b.layer) !== 0 && (b.mask & a.layer) !== 0
```

`layer` is a bit flag and `mask` is a set of accepted bits. Centralize named
flags, keep them within JavaScript's 32-bit bitwise range, and test the filter in
both directions as above.

## Broadphase Before Narrow Phase

Do not compare every dynamic collider with every other collider once counts
grow. Use a measured broadphase such as a uniform grid/spatial hash for a
bounded arena, sweep-and-prune for mostly coherent motion, or an `Octree` for a
static triangle world. A grid insertion spans every cell overlapped by the
collider's AABB; querying only the center cell misses large bodies and boundary
contacts. The compact example partitions a ground-based game in XZ; include Y
cells for free-flight or tall multi-level spaces.

```ts
const cells = new Map<string, SphereCollider[]>()

function rebuildSphereGrid(colliders: readonly SphereCollider[], cellSize: number) {
  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    throw new RangeError('cellSize must be finite and positive')
  }
  cells.clear()
  for (const collider of colliders) {
    const minX = Math.floor((collider.center.x - collider.radius) / cellSize)
    const maxX = Math.floor((collider.center.x + collider.radius) / cellSize)
    const minZ = Math.floor((collider.center.z - collider.radius) / cellSize)
    const maxZ = Math.floor((collider.center.z + collider.radius) / cellSize)
    for (let z = minZ; z <= maxZ; z += 1) {
      for (let x = minX; x <= maxX; x += 1) {
        const key = `${x},${z}`
        const bucket = cells.get(key)
        if (bucket) bucket.push(collider)
        else cells.set(key, [collider])
      }
    }
  }
}
```

Deduplicate candidate pairs by stable sorted IDs because a pair may share more
than one cell. Measure rebuild cost and candidate count. For a hot loop, pool
buckets or use integer-keyed typed structures rather than allocating strings and
arrays each step; the readable version above defines the contract first.

## Official Collision Math Addons

`Capsule`, `Octree`, and `OBB` are explicit addons; they are not properties on
the `THREE` namespace. Build a static octree from a simplified collision root,
not a detail-heavy render scene:

```ts
import { Capsule } from 'three/addons/math/Capsule.js'
import { Octree } from 'three/addons/math/Octree.js'

staticCollisionRoot.updateWorldMatrix(true, true)
const worldOctree = new Octree().fromGraphNode(staticCollisionRoot)
const playerCapsule = new Capsule(
  new THREE.Vector3(0, 0.35, 0),
  new THREE.Vector3(0, 1.45, 0),
  0.35,
)
const playerVelocity = new THREE.Vector3()
const correction = new THREE.Vector3()

function resolvePlayerWorld(): void {
  const hit = worldOctree.capsuleIntersect(playerCapsule)
  if (hit === false) return
  correction.copy(hit.normal).multiplyScalar(hit.depth)
  playerCapsule.translate(correction)
  removeIntoSurface(playerVelocity, hit.normal)
}
```

`fromGraphNode()` snapshots the supplied world geometry; rebuild it only at a
controlled transition when static collision geometry changes. `OBB.applyMatrix4()`
is useful for synchronizing an authored local OBB with an object's world matrix.
Keep canonical local bounds and copy them before applying a new world transform,
rather than accumulating transforms into the same OBB.

## Continuous Tests For Fast Objects

Never rely on end-of-frame overlap when a projectile can travel farther than
its radius in one step. Test the swept segment from previous to next position.

```ts
const segment = new THREE.Vector3()
const toCenter = new THREE.Vector3()

function pointSweepSphereTime(
  start: THREE.Vector3,
  end: THREE.Vector3,
  center: THREE.Vector3,
  radius: number,
): number | null {
  segment.copy(end).sub(start)
  toCenter.copy(start).sub(center)
  const a = segment.lengthSq()
  const b = 2 * toCenter.dot(segment)
  const c = toCenter.lengthSq() - radius * radius
  // A sweep that starts inside the target is already in contact.
  if (c <= 0) return 0
  if (a === 0) return null
  const discriminant = b * b - 4 * a * c
  if (discriminant < 0) return null
  const root = Math.sqrt(discriminant)
  const t0 = (-b - root) / (2 * a)
  const t1 = (-b + root) / (2 * a)
  if (t0 >= 0 && t0 <= 1) return t0
  if (t1 >= 0 && t1 <= 1) return t1
  return null
}

function sphereSphereSweepTime(
  movingStart: THREE.Vector3,
  movingEnd: THREE.Vector3,
  movingRadius: number,
  target: SphereCollider,
): number | null {
  return pointSweepSphereTime(
    movingStart,
    movingEnd,
    target.center,
    movingRadius + target.radius,
  )
}
```

The quadratic helper sweeps a point against a sphere. Sweeping a sphere against
a sphere uses the sum of radii, as the wrapper shows. If both objects move, use
relative start/end motion and the combined radius. For sphere-versus-box, expand
the box by the moving radius before the segment test, then handle rounded edge
and corner regions when exact contact normals matter.

Choose the earliest hit, move to the contact point, emit one semantic event,
then stop, reflect, slide, pierce, or consume the remaining time according to
the mechanic. Cap recursive impacts per step.

## Authored Resolution

For character and vehicle-like motion, authored response is usually better
than generic dynamics:

1. Integrate the proposed displacement.
2. Resolve floor/ceiling and arena bounds.
3. Resolve obstacles one axis or contact at a time.
4. Remove velocity into the contact normal to slide.
5. Apply gameplay response: damage, bounce, stun, checkpoint, or fail.
6. Commit the final transform once.

Slide velocity away from a surface:

```ts
function removeIntoSurface(velocity: THREE.Vector3, normal: THREE.Vector3) {
  const into = velocity.dot(normal)
  if (into < 0) velocity.addScaledVector(normal, -into)
}
```

Simple bounce with restitution:

```ts
function reflectVelocity(
  velocity: THREE.Vector3,
  normal: THREE.Vector3,
  restitution: number,
) {
  const into = velocity.dot(normal)
  if (into < 0) velocity.addScaledVector(normal, -(1 + restitution) * into)
}
```

Both formulas require a finite unit-length normal. Normalize once when a contact
is created or assert `Math.abs(normal.lengthSq() - 1) < epsilon` in development;
normalizing independently in every response function hides bad collision data
and wastes hot-loop work.

Apply friction or damping separately and consistently. Avoid multiplying by a
frame-rate-dependent constant; use exponential decay such as
`velocity.multiplyScalar(Math.exp(-drag * dt))`.

## Balls, Rails, And Surfaces

For a bounded arcade ball model:

- keep position, linear velocity, radius, mass, restitution, rolling drag, and
  sleep threshold
- integrate gravity at the fixed step
- resolve planes/rails by signed distance and normal
- resolve sphere pairs in deterministic ID order
- correct penetration conservatively, then apply a normal impulse
- use swept tests or substeps for fast travel
- cap velocity and repeated contacts when the design needs stability
- sleep only after speed stays below threshold for a duration

Use raycasts or authored height functions for ground/slope samples. Return
point, normal, surface type, and region through the shared world-query contract
in `spatial-contracts.md`. Do not raycast dense render geometry repeatedly when
a plane, rail segment, height field, or simplified proxy describes the rule.

## Moving Platforms And Sensors

- Move scripted platforms in the fixed simulation, then compute their delta.
- Resolve passengers against the platform's committed transform and carry them
  by its delta before player intent.
- Keep sensors non-blocking and deduplicate enter/stay/exit events by collider
  pair.
- Clear pair caches, timers, and pooled bodies on restart.
- Keep damage, scoring, and win/fail rules in game state, not in colliders.

## Diagnostics

Expose enough to reason about behavior:

```ts
const physicsDiagnostics = {
  collision: {
    model: 'custom-fixed-step',
    timestep: FIXED_DT,
    dynamicBodies: bodies.length,
    colliders: colliders.length,
    activePairs,
    sweepTests,
    droppedSimulationSteps,
  },
};
```

Add a local debug flag that draws wireframe spheres, boxes, capsules, normals,
and swept paths. Debug visuals must consume the same collider data as the
simulation and stay gated from release.

## Verification

- Build/typecheck and browser console/page errors.
- Real input changes canonical body state.
- Trigger, blocking contact, and response paths work.
- Restart clears bodies, pair caches, timers, and effects.
- Fast objects do not tunnel at maximum designed speed.
- Low-FPS spikes do not create unbounded catch-up or divergent state.
- Corners, simultaneous contacts, spawn overlap, and arena edges are tested.
- Results are stable under a seeded input replay when determinism matters.
- Report collision model, timestep, counts, sweeps/substeps, and known limits.

## Common Failures

- Render transforms and collider state have separate owners.
- Variable delta changes bounce, jump, or contact results.
- Collision uses detailed visual meshes instead of simple proxies.
- Penetration correction adds energy every frame.
- A projectile tunnels because only its final position is tested.
- Pair events fire once per frame instead of enter/stay/exit semantics.
- Restart leaves stale colliders or contact caches.
- A custom arcade solver is described as general rigid-body physics.

## Official Documentation

- [Three.js physics manual](https://threejs.org/manual/en/physics.html)
- [Box3](https://threejs.org/docs/pages/Box3.html) and [Sphere](https://threejs.org/docs/pages/Sphere.html)
- [Capsule](https://threejs.org/docs/pages/Capsule.html)
- [Octree](https://threejs.org/docs/pages/Octree.html) and the [official FPS example](https://threejs.org/examples/games_fps.html)
- [OBB](https://threejs.org/docs/pages/OBB.html)
- [AmmoPhysics](https://threejs.org/docs/pages/AmmoPhysics.html), [JoltPhysics](https://threejs.org/docs/pages/JoltPhysics.html), and [RapierPhysics](https://threejs.org/docs/pages/RapierPhysics.html)

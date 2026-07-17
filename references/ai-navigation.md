# AI, Navigation, And Steering

Use this reference when actors need perception, patrols, pursuit, obstacle-aware
movement, coordinated crowds, or reproducible decisions. For one actor moving
directly toward one target in open space, the compact steering recipe in
`implementation-recipes.md` is enough.

Three.js supplies spatial math, scene transforms, bounds, layers, and ray
queries. It does **not** supply behavior trees, A*, navigation meshes, crowd
simulation, or an AI scheduler. Those are game-layer algorithms. Keep the
authoritative AI state independent from `Object3D`; project the result to the
visual scene after simulation.

## Contents

- Choose the smallest navigation representation
- Deterministic simulation contract
- Decision architecture
- Perception and line of sight
- Deterministic graph search
- Path following and local steering
- Scheduling, invalidation, and workers
- Debug presentation
- Performance and lifecycle
- Verification
- Official Three.js API boundary

## Choose The Smallest Navigation Representation

| World and movement | Start with | Escalate when |
| --- | --- | --- |
| Open arena, few blockers | Seek/arrive plus local avoidance | Actors repeatedly trap behind concave obstacles |
| Authored patrol or lane | Directed waypoint graph | Free-form destinations are required |
| Tile or voxel world | Grid A* | Terrain cost or many same-destination agents justify hierarchy/flow fields |
| Walkable polygon world | Authored navmesh plus corridor/funnel | Dynamic topology needs deliberate rebuilds or links |
| Large crowd to one goal | Flow field plus separation | Goals vary enough that field rebuild cost dominates |

Navigation answers “which corridor reaches the goal?” Steering answers “what
acceleration should I apply now?” Collision resolves the proposed movement.
Do not ask steering to solve a maze or use the visible high-detail mesh as the
canonical navigation surface.

Author navigation data in world units with the basis from
`spatial-contracts.md`. Give nodes, polygons, links, regions, and dynamic
obstacles stable IDs. Validate connectivity, one-way links, agent clearance,
step height, slopes, and off-mesh links as content—not every frame.

## Deterministic Simulation Contract

Run AI from the fixed simulation step and separate its phases:

```text
perception snapshot -> decision/path requests -> steering intent
-> collision resolution -> canonical transform commit -> Three.js presentation
```

- Read the same frame-start snapshot for every actor, or explicitly document a
  sequential policy. Never let scene traversal order choose winners.
- Sort actors, neighbors, goals, and equal-cost search candidates by stable ID.
- Use simulation ticks and seeded random streams, never `Date.now()`, render
  delta, `setTimeout()`, `Math.random()`, or `Object3D.uuid` for gameplay rules.
- Quantize only at a declared boundary. Rendering may interpolate canonical
  positions; AI must not read those interpolated transforms back.
- Give expensive decisions a cadence in ticks. Perception at 10 Hz and movement
  at 60 Hz can be correct when reaction latency is part of the design.

Use explicit state with serializable IDs:

```ts
import * as THREE from 'three';

type AgentState = {
  id: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  radius: number;
  path: readonly number[];
  waypointIndex: number;
  targetId: number | null;
  thinkAtTick: number;
};
```

Vectors are convenient game-layer values, but saves and worker messages should
convert them to number tuples. `Object3D` remains presentation.

## Decision Architecture

Start with the smallest inspectable model:

- A finite-state machine suits patrol/alert/chase/attack/recover behavior.
- A behavior tree suits reusable hierarchical sequences and fallbacks.
- Utility scoring suits several competing goals whose priority changes.
- Goal planners are justified only when authored state/action search is the
  intended game and its worst-case budget is bounded.

Keep blackboards plain and scoped: stable entity IDs, last-known positions,
ticks, flags, and small numeric facts. State enter/exit owns animation intent,
cooldowns, subscriptions, and cancellation. Decision code emits gameplay
intents/events; it does not add scene children, play audio, or mutate materials.

A stable utility selector is enough for many encounters:

```ts
type DecisionContext = Readonly<{
  healthRatio: number;
  targetDistance: number;
  hasLineOfSight: boolean;
}>;

type Choice = Readonly<{
  id: string;
  score(context: DecisionContext): number;
}>;

export function chooseAction(
  choices: readonly Choice[],
  context: DecisionContext,
): string | null {
  const scored = choices.map((choice) => {
    const raw = choice.score(context);
    return {
      id: choice.id,
      score: Number.isFinite(raw)
        ? Math.min(1, Math.max(0, raw))
        : 0,
    };
  });
  scored.sort(
    (a, b) =>
      b.score - a.score ||
      (a.id === b.id ? 0 : a.id < b.id ? -1 : 1),
  );
  return scored[0]?.id ?? null;
}
```

Validate unique IDs and content-defined score ranges at boot. Evaluate on a
declared think tick, not every render frame. Tie-breaking by stable ID prevents
array insertion or scene order from changing the winner. Add hysteresis,
minimum state duration, or explicit interrupt rules so near-equal scores do not
thrash; do not hide the problem with frame-time debounce.

## Perception And Line Of Sight

Start with a cheap broad phase: squared distance, field-of-view dot product,
team/state filters, then an occlusion query only for survivors. Cache a
snapshot per decision tick so one actor does not observe a half-updated world.

`Raycaster` can test static, deliberately simple occluder meshes. Put those on
an intentional layer and reuse the ray, direction, and result array:

```ts
import * as THREE from 'three';

const OCCLUSION_LAYER = 2;
const raycaster = new THREE.Raycaster();
const direction = new THREE.Vector3();
const hits: THREE.Intersection<THREE.Object3D>[] = [];
raycaster.layers.set(OCCLUSION_LAYER);

export function hasLineOfSight(
  from: THREE.Vector3,
  to: THREE.Vector3,
  blockers: THREE.Object3D[],
): boolean {
  direction.subVectors(to, from);
  const distance = direction.length();
  if (distance <= 0.001) return true;

  const endpointMargin = Math.min(0.02, distance * 0.25);
  direction.multiplyScalar(1 / distance);
  raycaster.set(from, direction);
  raycaster.near = endpointMargin;
  raycaster.far = distance - endpointMargin;
  hits.length = 0; // optional-target arrays are not cleared by Raycaster
  raycaster.intersectObjects(blockers, true, hits);
  return hits.length === 0;
}
```

Update blocker world matrices after authored transform changes. For many
agents, use a measured physics/spatial-query backend or simplified partitions;
recursive render-mesh raycasts do not scale into a crowd visibility system.
Treat hearing, memory, threat scoring, and cover selection as game-layer data.

## Deterministic Graph Search

For a modest waypoint graph, this dependency-free A* is a useful baseline.
Node links must be sorted by `to` and costs must be finite and nonnegative. The
closed-set implementation requires a **consistent** heuristic: `h(goal) = 0`
and `h(node) <= edgeCost + h(neighbor)` for every directed link. The example
validates that contract before searching. Its default Euclidean heuristic is
consistent when every link cost is at least the world-space distance between
its endpoints. Pass `() => 0` for Dijkstra behavior when content uses another
cost scale or no proven-consistent heuristic is available.

```ts
import * as THREE from 'three';

type NavLink = Readonly<{ to: number; cost: number }>;
type NavNode = Readonly<{
  id: number;
  position: THREE.Vector3;
  links: readonly NavLink[];
}>;
type NavGraph = ReadonlyMap<number, NavNode>;
type Candidate = { id: number; total: number; heuristic: number };
type EstimateCost = (from: NavNode, to: NavNode) => number;

function validateAStarContract(
  graph: NavGraph,
  goal: NavNode,
  estimateCost: EstimateCost,
): ReadonlyMap<number, number> {
  const heuristicById = new Map<number, number>();

  for (const [key, node] of graph) {
    if (key !== node.id || !Number.isFinite(node.id)) {
      throw new Error(`Invalid navigation node identity: key=${key}`);
    }
    if (
      !Number.isFinite(node.position.x) ||
      !Number.isFinite(node.position.y) ||
      !Number.isFinite(node.position.z)
    ) {
      throw new Error(`Navigation node ${node.id} has a non-finite position`);
    }

    const heuristic = estimateCost(node, goal);
    if (!Number.isFinite(heuristic) || heuristic < 0) {
      throw new Error(`Invalid heuristic at navigation node ${node.id}`);
    }
    heuristicById.set(node.id, heuristic);

    let previousTarget = Number.NEGATIVE_INFINITY;
    for (const link of node.links) {
      if (!Number.isFinite(link.cost) || link.cost < 0) {
        throw new Error(`Invalid link cost: ${node.id} -> ${link.to}`);
      }
      if (!graph.has(link.to)) {
        throw new Error(`Missing navigation node ${link.to}`);
      }
      if (link.to < previousTarget) {
        throw new Error(`Links from node ${node.id} must be sorted by target`);
      }
      previousTarget = link.to;
    }
  }

  const goalHeuristic = heuristicById.get(goal.id)!;
  if (goalHeuristic !== 0) {
    throw new Error('A* heuristic must be zero at the goal');
  }

  for (const node of graph.values()) {
    const fromHeuristic = heuristicById.get(node.id)!;
    for (const link of node.links) {
      const toHeuristic = heuristicById.get(link.to)!;
      const tolerance = 1e-9 * Math.max(
        1,
        Math.abs(fromHeuristic),
        Math.abs(link.cost),
        Math.abs(toHeuristic),
      );
      if (fromHeuristic > link.cost + toHeuristic + tolerance) {
        throw new Error(
          `Inconsistent A* heuristic on link ${node.id} -> ${link.to}`,
        );
      }
    }
  }

  return heuristicById;
}

export function findPath(
  graph: NavGraph,
  startId: number,
  goalId: number,
  estimateCost: EstimateCost = (from, to) =>
    from.position.distanceTo(to.position),
): number[] | null {
  const start = graph.get(startId);
  const goal = graph.get(goalId);
  if (!start || !goal) return null;

  const heuristicById = validateAStarContract(graph, goal, estimateCost);
  const startHeuristic = heuristicById.get(startId)!;
  const open: Candidate[] = [{
    id: startId,
    total: startHeuristic,
    heuristic: startHeuristic,
  }];
  const closed = new Set<number>();
  const previous = new Map<number, number>();
  const cost = new Map<number, number>([[startId, 0]]);

  while (open.length > 0) {
    open.sort(
      (a, b) =>
        a.total - b.total ||
        a.heuristic - b.heuristic ||
        a.id - b.id,
    );
    const currentId = open.shift()!.id;
    if (closed.has(currentId)) continue;
    if (currentId === goalId) return rebuildPath(previous, startId, goalId);
    closed.add(currentId);

    const current = graph.get(currentId)!;
    const currentCost = cost.get(currentId)!;
    for (const link of current.links) {
      const next = graph.get(link.to)!;
      if (closed.has(next.id)) continue;
      const nextCost = currentCost + link.cost;
      if (nextCost >= (cost.get(next.id) ?? Number.POSITIVE_INFINITY)) continue;

      const heuristic = heuristicById.get(next.id)!;
      cost.set(next.id, nextCost);
      previous.set(next.id, currentId);
      open.push({ id: next.id, total: nextCost + heuristic, heuristic });
    }
  }
  return null;
}

function rebuildPath(
  previous: ReadonlyMap<number, number>,
  startId: number,
  goalId: number,
): number[] | null {
  const path = [goalId];
  let cursor = goalId;
  while (cursor !== startId) {
    const parent = previous.get(cursor);
    if (parent === undefined) return null;
    cursor = parent;
    path.push(cursor);
  }
  return path.reverse();
}
```

The array sort keeps the example compact, not optimal. Replace it with a stable
binary heap after profiling large graphs. Preserve the same `total`, heuristic,
then ID tie-break. This compact version validates the graph on every query;
cache validation only when graph content is immutable or explicitly versioned.
Treat a validation error as a content/configuration defect, while `null` means
the endpoints are missing or no path exists. A navmesh implementation
additionally needs point-to-polygon projection, polygon adjacency, portal
clearance, corridor search, and a funnel; Three.js does not implement those
operations.

## Path Following And Local Steering

Follow a path with arrive behavior, not a sequence of teleports. Advance a
waypoint when the actor enters a radius derived from speed and agent size. Slow
near the final goal, clamp acceleration and speed, then pass the proposed
displacement to the collision owner.

Combine bounded contributions in a stable order:

```text
path/goal velocity + separation + static avoidance + formation bias
-> clamp acceleration -> integrate velocity -> collision resolve -> commit
```

- Query nearby agents from a uniform grid/spatial hash. Do not run all-pairs
  separation for a large crowd.
- Sort returned neighbors by stable ID before accumulating forces; floating
  point addition order otherwise changes results.
- Weight and clamp each contribution before clamping the sum. Unbounded
  separation causes oscillation and corner pinning.
- Use local avoidance for temporary blockers. Replan when progress is below a
  threshold for a measured number of ticks, the goal moves regions, or a path
  link becomes invalid—not every frame.
- Keep visual facing independent. Use `Quaternion.rotateTowards()` to present a
  bounded turn after canonical velocity is committed; animation does not own
  navigation position.

Dynamic obstacles should normally toggle authored links/regions or update a
small local overlay. Rebuilding an entire navigation representation whenever a
door or crate moves is rarely a good first design.

## Scheduling, Invalidation, And Workers

Give path requests a stable request ID, actor ID, nav revision, start, goal, and
priority. Sort the queue by priority then actor/request ID and process a fixed
budget per simulation tick. Cache only when the cache key includes the nav
revision and movement class/clearance.

Async completion order is nondeterministic. Whether work runs in a worker or
the main thread:

1. discard a result if actor, request, goal, or nav revision is stale;
2. enqueue valid results;
3. apply them at a fixed-step boundary in request-ID order;
4. define a deterministic fallback if a result misses its deadline.

Use local module workers only after profiling proves path work causes main-thread
spikes. Send plain objects and transferable typed arrays, not `Object3D`,
`Vector3`, materials, or geometries. Terminate owned workers and cancel pending
requests during level/app teardown. See `production-runtime.md` for the worker
protocol and cancellation contract.

## Debug Presentation

Debug geometry is presentation, not authority. A reusable `Line`/`LineSegments`
overlay can show graph edges, chosen corridors, perception rays, and velocity.
Update one dynamic `BufferGeometry` in batches and gate it behind a debug flag.
For wide lines, use the renderer-specific variants described in `overlays.md`.

Also expose local counters: path queue length, searches/tick, expanded nodes,
cache hit rate, stale results, perception candidates, ray queries, neighbors,
replans, and stuck actors. Never ship a hidden network analytics sink.

## Performance And Lifecycle

- Measure decision, search, neighbor query, raycast, and movement separately.
- Stagger think ticks deterministically by stable actor ID.
- Pool request records and scratch math only when allocation profiles justify it.
- Avoid cloning the render scene into AI structures; ingest small authored nav
  metadata and dedicated query proxies.
- On level exit: stop requests, bump the nav revision, discard late results,
  remove debug objects, dispose their owned geometry/materials, clear caches and
  grids, terminate owned workers, and release references to actors and assets.
- On reset: restore AI tick, seeded RNG state, stable IDs, queues, path indices,
  cooldowns, memory, and nav revision according to the save/replay contract.

## Verification

1. Run identical input/seed at 30, 60, 120, and throttled render rates; compare
   canonical actor paths, decisions, and checksums at fixed ticks.
2. Reverse actor insertion and scene-child order; results remain unchanged.
3. Validate disconnected graphs, one-way links, bad costs, narrow clearance,
   unreachable goals, same start/goal, and deterministic equal-cost routes.
4. Open/close dynamic links, move a goal, despawn an actor with a pending path,
   and rebuild navigation; stale results never apply.
5. Crowd-test corners, doorways, opposing flows, spawn overlap, and a blocked
   goal. Measure queue latency and worst-step time, not average FPS alone.
6. Confirm occlusion proxies and layers match the intended world and that
   perception never depends on decorative LOD visibility.
7. Pause, save/load, retry, unload/re-enter, and teardown repeatedly; no live
   workers, requests, debug resources, listeners, or actor references remain.
8. Unit-test graph validation and A* against known paths and a zero-heuristic
   oracle; fuzz small seeded graphs when search is production-critical.
9. Force equal utility scores, rapid score crossings, state interruption, and
   target despawn; choice order and enter/exit cleanup remain stable.

## Official Three.js API Boundary

Verified against the current r185 API surface. These are the Three.js pieces
used by the examples; navigation and AI algorithms remain game code:

- [Vector3](https://threejs.org/docs/pages/Vector3.html) and [Quaternion](https://threejs.org/docs/pages/Quaternion.html)
- [Raycaster](https://threejs.org/docs/pages/Raycaster.html) and [Layers](https://threejs.org/docs/pages/Layers.html)
- [Box3](https://threejs.org/docs/pages/Box3.html), [Sphere](https://threejs.org/docs/pages/Sphere.html), and [Frustum](https://threejs.org/docs/pages/Frustum.html)
- [Object3D](https://threejs.org/docs/pages/Object3D.html) for presentation transforms and culling

# Production Runtime: Saves, Streaming, Workers, And Local Telemetry

Use this reference when a game must survive updates, load/unload world regions,
move measured work off the main thread, or produce release evidence. These are
game/runtime systems around Three.js—not features provided by the renderer.

The default remains local-first: runtime assets, saves, diagnostics, and worker
modules are local. Do not add cloud saves, remote configuration, analytics,
crash-upload SDKs, service workers, or networking without explicit approval and
the boundary in `networking-boundary.md`.

## Contents

- Ownership and decision table
- Versioned save contract and migrations
- Crash-safe-enough local commits
- Chunk residency and race-safe streaming
- Worker protocol and deterministic application
- Local diagnostics and explicit export
- Performance and lifecycle
- Verification
- Official Three.js API boundary

## Ownership And Decision Table

| Need | Owner | Three.js role |
| --- | --- | --- |
| Settings/checkpoint/progression | Game persistence | Reconstruct Three objects; never serialize them as canonical state |
| Region residency | World streamer/asset store | Load and attach local scene roots; release GPU resources explicitly |
| Background planning/data transforms | Local worker pool | Optional math/data consumer; no DOM or shared Three object graph |
| Frame/resource evidence | Local diagnostics | Read `renderer.info`; rendering does not upload telemetry |

Keep four clocks separate: fixed simulation tick, render time, asynchronous I/O
completion, and wall-clock metadata. Only the simulation tick may control
gameplay. Async results enter through a deliberate fixed-step boundary.

## Versioned Save Contract And Migrations

Save plain, bounded, schema-validated data. Include a schema version, content
compatibility ID, fixed-step tick, seeded RNG state, stable entity IDs, and
canonical gameplay fields. Exclude scene graphs, matrices/quaternions derived
from canonical state, materials, textures, mixers, callbacks, caches, and
credentials.

```ts
type Vec3Tuple = readonly [number, number, number];

type SaveV1 = {
  schema: 1;
  level: string;
  playerPosition: Vec3Tuple;
  score: number;
};

type SaveV2 = {
  schema: 2;
  build: string;
  content: string;
  level: string;
  tick: number;
  seed: number;
  rngState: number;
  player: { position: Vec3Tuple; health: number };
  score: number;
  flags: string[];
};

const CURRENT_CONTENT = 'campaign-2026-07';
const CURRENT_BUILD = '1.4.0';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function boundedText(value: unknown, maxLength = 128): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function vec3(value: unknown): Vec3Tuple | null {
  if (!Array.isArray(value) || value.length !== 3) return null;
  return value.every(
    (component) => finiteNumber(component) && Math.abs(component) <= 1_000_000,
  )
    ? [value[0], value[1], value[2]]
    : null;
}

export function migrateSave(input: unknown): SaveV2 | null {
  if (!isRecord(input)) return null;

  if (input.schema === 1) {
    const position = vec3(input.playerPosition);
    if (
      !boundedText(input.level) ||
      !position ||
      !finiteNumber(input.score)
    ) return null;

    const old = input as unknown as SaveV1;
    return {
      schema: 2,
      build: CURRENT_BUILD,
      content: CURRENT_CONTENT,
      level: old.level,
      tick: 0,
      seed: 1,
      rngState: 1,
      player: { position, health: 100 },
      score: Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, Math.trunc(old.score))),
      flags: [],
    };
  }

  if (input.schema !== 2 || !isRecord(input.player)) return null;
  const position = vec3(input.player.position);
  const flags = input.flags;
  if (
    !boundedText(input.build) ||
    !boundedText(input.content) ||
    input.content !== CURRENT_CONTENT ||
    !boundedText(input.level) ||
    !Number.isSafeInteger(input.tick) || Number(input.tick) < 0 ||
    !Number.isSafeInteger(input.seed) || Number(input.seed) < 0 ||
    Number(input.seed) > 0xffff_ffff ||
    !Number.isSafeInteger(input.rngState) || Number(input.rngState) < 0 ||
    Number(input.rngState) > 0xffff_ffff ||
    !position ||
    !finiteNumber(input.player.health) || Math.abs(input.player.health) > 1_000_000_000 ||
    !Number.isSafeInteger(input.score) ||
    !Array.isArray(flags) ||
    flags.length > 512 ||
    !flags.every((flag): flag is string => boundedText(flag))
  ) return null;

  return {
    schema: 2,
    build: input.build,
    content: input.content,
    level: input.level,
    tick: Number(input.tick),
    seed: Number(input.seed) >>> 0,
    rngState: Number(input.rngState) >>> 0,
    player: {
      position,
      health: Math.max(0, input.player.health),
    },
    score: Math.max(0, Math.trunc(Number(input.score))),
    flags: [...new Set(flags)].sort(),
  };
}
```

Make every migration a pure `Vn -> Vn+1` function in a real project; chain
them until current. Keep fixtures for every shipped schema. Separate schema
compatibility from content compatibility: a structurally valid save can still
refer to a removed level or entity. Keep `build` as provenance, not a blanket
compatibility gate. The example rejects every v2 content ID except
`CURRENT_CONTENT`. If shipped content can be upgraded, map each known old
content ID through an explicit, fixture-tested migration before canonical
validation; otherwise offer a clear new-game/fallback path. Never silently load
a partly understood snapshot.

Capture a snapshot immediately after a fixed simulation tick. Save at
checkpoints/transitions or debounce settings changes; synchronous browser
storage must not run in a frame hot path. Larger saves belong in IndexedDB with
the same envelope/migration contract.

## Crash-Safe-Enough Local Commits

`localStorage` has no multi-key transaction and can throw for privacy, quota,
or policy reasons. A staging value plus last-known-good backup gives a small
offline game a recoverable commit; it is not a database transaction.

```ts
const SAVE = 'game.save.v2';
const STAGING = `${SAVE}.staging`;
const BACKUP = `${SAVE}.backup`;

export function commitLocalSave(save: SaveV2): boolean {
  try {
    const normalized = migrateSave(save);
    if (!normalized) return false;
    const encoded = JSON.stringify(normalized);
    localStorage.setItem(STAGING, encoded);
    if (!migrateSave(JSON.parse(localStorage.getItem(STAGING)!))) return false;

    const previous = localStorage.getItem(SAVE);
    if (previous !== null) localStorage.setItem(BACKUP, previous);
    localStorage.setItem(SAVE, encoded);
    localStorage.removeItem(STAGING);
    return true;
  } catch (error) {
    console.warn('Save commit failed; gameplay can continue', error);
    return false;
  }
}

export function loadLocalSave(): SaveV2 | null {
  for (const key of [SAVE, STAGING, BACKUP]) {
    try {
      const encoded = localStorage.getItem(key);
      if (!encoded) continue;
      const save = migrateSave(JSON.parse(encoded));
      if (save) return save;
    } catch {
      // Try the next local recovery candidate.
    }
  }
  return null;
}
```

If the staging write validates but a later write fails, it remains a recovery
candidate. Bound string/array/entity counts before allocating reconstruction
objects. Treat local save data as untrusted input: parse JSON only, validate,
clamp, and never evaluate strings. A checksum detects accidental corruption,
not malicious tampering; local saves are not a security boundary.

## Chunk Residency And Race-Safe Streaming

Three's renderer frustum-culls draw submission, but that does not unload CPU/GPU
resources, mixers, collision, AI, audio, or listeners. Streaming is a game-layer
residency system around local loader calls.

Author a local manifest with stable chunk IDs, URLs, bounds, dependencies,
navigation/collision metadata, and separate load/unload radii. The larger
unload radius supplies hysteresis. Do not discover files by probing remote URLs.

```ts
import * as THREE from 'three';

type ChunkDef = Readonly<{
  id: string;
  url: string;
  center: readonly [number, number, number];
  loadRadius: number;
  unloadRadius: number;
}>;

type ChunkHandle = {
  root: THREE.Object3D;
  dispose(): void;
};

interface ChunkLoader {
  load(definition: ChunkDef): Promise<ChunkHandle>;
}

type Entry = {
  definition: ChunkDef;
  generation: number;
  state: 'idle' | 'loading' | 'loaded';
  handle?: ChunkHandle;
};

export class ChunkStreamer {
  private readonly entries = new Map<string, Entry>();
  private activeLoads = 0;
  private disposed = false;

  constructor(
    definitions: readonly ChunkDef[],
    private readonly scene: THREE.Scene,
    private readonly loader: ChunkLoader,
    private readonly maxConcurrentLoads = 2,
  ) {
    if (!Number.isSafeInteger(maxConcurrentLoads) || maxConcurrentLoads < 1) {
      throw new Error('maxConcurrentLoads must be a positive integer');
    }
    for (const definition of definitions) {
      const centerIsFinite = definition.center.every(Number.isFinite);
      if (
        definition.id.length === 0 ||
        definition.url.length === 0 ||
        !centerIsFinite ||
        !Number.isFinite(definition.loadRadius) ||
        !Number.isFinite(definition.unloadRadius) ||
        definition.loadRadius <= 0 ||
        definition.unloadRadius <= definition.loadRadius
      ) {
        throw new Error(`Chunk ${definition.id} needs unload hysteresis`);
      }
      if (this.entries.has(definition.id)) {
        throw new Error(`Duplicate chunk id: ${definition.id}`);
      }
      this.entries.set(definition.id, {
        definition,
        generation: 0,
        state: 'idle',
      });
    }
  }

  update(observer: THREE.Vector3): void {
    if (this.disposed) return;
    const starts: Array<{ entry: Entry; distanceSq: number }> = [];

    for (const entry of this.entries.values()) {
      const [x, y, z] = entry.definition.center;
      const dx = observer.x - x;
      const dy = observer.y - y;
      const dz = observer.z - z;
      const distanceSq = dx * dx + dy * dy + dz * dz;
      const radius = entry.state === 'idle'
        ? entry.definition.loadRadius
        : entry.definition.unloadRadius;
      const wanted = distanceSq <= radius * radius;

      if (wanted && entry.state === 'idle') starts.push({ entry, distanceSq });
      if (!wanted && entry.state !== 'idle') this.unload(entry);
    }

    starts.sort(
      (a, b) =>
        a.distanceSq - b.distanceSq ||
        (a.entry.definition.id === b.entry.definition.id
          ? 0
          : a.entry.definition.id < b.entry.definition.id ? -1 : 1),
    );
    for (const { entry } of starts) {
      if (this.activeLoads >= this.maxConcurrentLoads) break;
      this.start(entry);
    }
  }

  private start(entry: Entry): void {
    const generation = ++entry.generation;
    entry.state = 'loading';
    this.activeLoads += 1;

    void Promise.resolve().then(() => this.loader.load(entry.definition)).then((handle) => {
      if (
        this.disposed ||
        entry.generation !== generation ||
        entry.state !== 'loading'
      ) {
        handle.dispose();
        return;
      }
      entry.handle = handle;
      entry.state = 'loaded';
      this.scene.add(handle.root);
    }).catch((error: unknown) => {
      if (entry.generation === generation && entry.state === 'loading') {
        entry.state = 'idle';
        console.warn(`Chunk ${entry.definition.id} failed`, error);
      }
    }).finally(() => {
      this.activeLoads -= 1;
    });
  }

  private unload(entry: Entry): void {
    entry.generation += 1; // invalidates a late load completion
    entry.handle?.root.removeFromParent();
    entry.handle?.dispose();
    entry.handle = undefined;
    entry.state = 'idle';
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const entry of this.entries.values()) this.unload(entry);
    this.entries.clear();
  }
}
```

The injected loader/asset store must own the complete glTF resource graph and
return an idempotent `dispose()`. Shared textures/geometries need reference
counts; a chunk borrower must not dispose another chunk's resources. `GLTFLoader.loadAsync()`
is the normal local integration. A dedicated `LoadingManager` can track a level
and its current `abort()` is best-effort because cancellation depends on loader
support. Generation checks and late-result disposal are still required.

Streaming completion order must not decide gameplay. Attach decorative roots
as they finish if acceptable, but activate collision/navigation/spawns at a
fixed-step boundary in stable chunk-ID order after the required set is ready.
Use authored chunk bounds for residency. `Box3`, `Sphere`, and `Frustum` can aid
debug/priority queries, but camera visibility alone causes thrash during turns
and does not predict fast travel. Preload around velocity and known portals.

Budget requests, decoded bytes, GPU memory, mixers, lights/shadows, physics
bodies, and activation work. Warm shaders only when measured, after renderer
initialization. When compiling a detached chunk for an existing world, use
`compileAsync(chunkRoot, camera, scene)` after the target scene's lighting and
environment are configured. Compilation does not replace asset readiness or
first-use testing.

## Worker Protocol And Deterministic Application

Prefer workers for measured CPU tasks with coarse inputs/outputs: path search,
procedural data, static analysis, or parsing that is not already worker-backed.
Create a local module worker through the bundler:

```ts
type PlanRequest = {
  type: 'plan';
  requestId: number;
  generation: number;
  graph: Float32Array;
};

type PlanResponse = {
  type: 'planned';
  requestId: number;
  generation: number;
  path: Uint32Array;
};

function isPlanResponse(value: unknown): value is PlanResponse {
  if (typeof value !== 'object' || value === null) return false;
  const candidate = value as Partial<PlanResponse>;
  return candidate.type === 'planned' &&
    Number.isSafeInteger(candidate.requestId) &&
    Number.isSafeInteger(candidate.generation) &&
    candidate.path instanceof Uint32Array &&
    candidate.path.length <= 100_000;
}

const worker = new Worker(
  new URL('./planner.worker.ts', import.meta.url),
  { type: 'module', name: 'local-planner' },
);

let generation = 1;
let nextRequestId = 1;
let disposed = false;
let workerError: unknown;
const pending = new Set<number>();
const requestOrder: number[] = [];
const completedById = new Map<number, PlanResponse>();

worker.addEventListener('message', (event: MessageEvent<unknown>) => {
  const response = event.data;
  if (
    !isPlanResponse(response) ||
    response.generation !== generation ||
    !pending.has(response.requestId) ||
    completedById.has(response.requestId)
  ) return;
  completedById.set(response.requestId, response);
});

worker.addEventListener('error', (event: ErrorEvent) => {
  workerError = event.error ?? new Error(event.message);
  disposed = true;
  generation += 1;
  clearRequests();
  worker.terminate();
});

export function requestPlan(graph: Float32Array): number {
  if (disposed) {
    throw new DOMException('Planner disposed', 'AbortError');
  }
  if (pending.size >= 128) {
    throw new Error('Planner queue capacity exceeded');
  }
  if (graph.length === 0 || graph.length > 1_000_000) {
    throw new Error('Planner graph payload is outside the supported bounds');
  }
  if (!Number.isSafeInteger(nextRequestId)) {
    throw new Error('Planner request ID space exhausted');
  }
  const requestId = nextRequestId++;
  // Transfer a dedicated/copy buffer: the sender loses access after transfer.
  const payload = graph.slice();
  pending.add(requestId);
  requestOrder.push(requestId);
  try {
    worker.postMessage(
      { type: 'plan', requestId, generation, graph: payload } satisfies PlanRequest,
      [payload.buffer],
    );
  } catch (error) {
    pending.delete(requestId);
    requestOrder.pop();
    throw error;
  }
  return requestId;
}

/** Call once at a declared fixed-step boundary. */
export function drainPlannerResults(): PlanResponse[] {
  if (workerError !== undefined) {
    const error = workerError;
    workerError = undefined;
    throw error;
  }
  const results: PlanResponse[] = [];
  while (requestOrder.length > 0) {
    const requestId = requestOrder[0];

    // Cancellation removes the head without allowing its late response back.
    if (!pending.has(requestId)) {
      requestOrder.shift();
      completedById.delete(requestId);
      continue;
    }

    // Hold a later response until every earlier live request is ready. Sorting
    // only the responses received in this frame would still reorder frames.
    const response = completedById.get(requestId);
    if (!response) break;

    requestOrder.shift();
    pending.delete(requestId);
    completedById.delete(requestId);
    results.push(response);
  }
  return results;
}

export function cancelPlan(requestId: number): void {
  pending.delete(requestId);
  completedById.delete(requestId);
  const orderIndex = requestOrder.indexOf(requestId);
  if (orderIndex >= 0) requestOrder.splice(orderIndex, 1);
}

export function cancelAllPlans(): void {
  if (disposed) return;
  generation += 1; // late responses now fail the generation check
  clearRequests();
}

function clearRequests(): void {
  pending.clear();
  requestOrder.length = 0;
  completedById.clear();
}

export function disposePlanner(): void {
  if (disposed) return;
  disposed = true;
  generation += 1;
  clearRequests();
  worker.terminate();
}
```

Validate every response type, generation, ID, length, and numeric range. Keep
IDs monotonically increasing for the worker owner's full lifetime and apply
responses from the queue head, not merely in arrival order within one frame.
Bound the queue and define overload behavior. Cancel an actor's request when it
despawns; cancel the generation at level reset; terminate the worker at app
teardown. Never transfer a buffer still owned by gameplay; transfer a dedicated
buffer or copy.

Worker completion timing cannot be deterministic. Queue valid results and
apply them at declared simulation ticks in request-ID order, or keep the task
outside authoritative simulation. Record request inputs/results when replay
requires them. Workers cannot access the DOM. Do not clone Three scene graphs
through messages; send compact data. Rendering through `OffscreenCanvas` is a
separate, feature-detected architecture with a main-thread fallback and explicit
input/resize proxying—not a generic optimization switch.

## Local Diagnostics And Explicit Export

Collect only the evidence needed to debug the current build. Keep a bounded
ring buffer in memory and expose it through the local debug surface. No request
leaves the origin.

Prefer typed, bounded counters/events: load duration/failure, save migration or
fallback, streaming queue/activation, worker queue/stale result, simulation
overload, context/device loss, and long-frame bursts. Include build, content,
scenario, tick, and quality context once per exported session rather than on
every sample. Avoid free-form strings and unbounded per-frame event logs.

```ts
type FrameSample = {
  tick: number;
  frameMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  activeChunks: number;
  pathQueue: number;
};

type RendererCounters = {
  info: {
    render: { calls?: number; drawCalls?: number; triangles: number };
    memory: { geometries: number; textures: number };
  };
};

export class LocalDiagnostics {
  private readonly samples: Array<FrameSample | undefined>;
  private next = 0;
  private count = 0;

  constructor(private readonly capacity = 600) {
    if (!Number.isSafeInteger(capacity) || capacity < 1) {
      throw new Error('Diagnostics capacity must be a positive integer');
    }
    this.samples = new Array<FrameSample | undefined>(capacity);
  }

  capture(
    tick: number,
    frameMs: number,
    renderer: RendererCounters,
    activeChunks: number,
    pathQueue: number,
  ): void {
    const drawCalls = renderer.info.render.drawCalls
      ?? renderer.info.render.calls;
    if (drawCalls === undefined) {
      throw new Error('Renderer draw-call counter is unavailable');
    }
    this.samples[this.next] = {
      tick,
      frameMs,
      drawCalls,
      triangles: renderer.info.render.triangles,
      geometries: renderer.info.memory.geometries,
      textures: renderer.info.memory.textures,
      activeChunks,
      pathQueue,
    };
    this.next = (this.next + 1) % this.capacity;
    this.count = Math.min(this.count + 1, this.capacity);
  }

  snapshot(): readonly FrameSample[] {
    const result: FrameSample[] = [];
    for (let offset = 0; offset < this.count; offset += 1) {
      const index = (this.next - this.count + offset + this.capacity)
        % this.capacity;
      result.push({ ...this.samples[index]! });
    }
    return result;
  }

  clear(): void {
    this.samples.fill(undefined);
    this.next = 0;
    this.count = 0;
  }
}
```

Sample at a controlled cadence if snapshot copying is measurable. The structural
counter type accepts both current renderer families. For multi-pass WebGL, set
`renderer.info.autoReset = false`, reset once at the outer frame boundary, and
publish the complete-frame counts as described in `debugging-performance.md`.
Keep CPU timings from
`performance.mark/measure`; label GPU timings separately and never infer them
from FPS.

Export only through an explicit debug/user action. Serialize a copy with build,
content, scenario, quality, viewport, DPR, seed, and schema metadata; create a
temporary `Blob` download URL and revoke it after the click. Exclude names,
free-form player text, file paths, tokens, and persistent device identifiers.
Diagnostics reset on restart unless the brief explicitly requires local
session history.

## Performance And Lifecycle

- Profile before adding streaming or workers; both add queues, copies, races,
  memory duplication, startup cost, and teardown paths.
- Keep main-thread activation bounded even when loading/worker work is async.
- Coordinate worker counts across Draco, KTX2, physics, and game systems.
- Do not enable global `THREE.Cache` casually. It changes residency ownership;
  define eviction/clear behavior and measure memory before adopting it.
- On level exit: stop new requests, invalidate generations, detach roots, stop
  mixers/audio/AI/physics, release asset handles, clear diagnostics for the
  level, and abort a level-owned loading manager where supported.
- On app teardown: additionally terminate workers, reject pending promises,
  revoke object URLs, remove observers/listeners, clear save timers, dispose
  renderer-owned resources, and assert stable resource counts after soak cycles.

## Verification

1. Unit-test every save fixture and migration. Try missing, corrupt, oversized,
   future-schema, old-content, `NaN`-like, negative, duplicate, and unknown data.
2. Simulate unavailable/quota-limited storage and interruption after staging,
   backup, and primary writes; gameplay continues and recovery order is clear.
3. Cross chunk boundaries rapidly, teleport, turn the camera, fail loads, unload
   while loading, and teardown with requests in flight. Late roots never attach.
4. Soak unload/reload and compare renderer memory, mixers, lights, audio,
   colliders, AI actors, workers, listeners, and asset-store references.
5. Verify local manifests and worker URLs in a production build/preview with the
   network blocked after initial localhost load.
6. Reverse worker completion timing and inject stale/invalid responses; fixed
   simulation state and application order remain deterministic.
7. Measure request queue, decode, activation, worst frame, memory, and traversal
   costs in the same worst-case scenario before and after streaming/worker work.
8. Inspect the browser network log: no diagnostics, save data, analytics,
   runtime assets, or worker modules leave the local origin.
9. Export diagnostics manually, inspect schema/privacy fields, then confirm the
   temporary object URL and observers are released during teardown.

## Official Three.js API Boundary

Verified against the current r185 API surface. The surrounding persistence,
streaming scheduler, worker protocol, and diagnostics policy are game/browser
code:

- [GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html), [Loader](https://threejs.org/docs/pages/Loader.html), and [LoadingManager](https://threejs.org/docs/pages/LoadingManager.html)
- [Box3](https://threejs.org/docs/pages/Box3.html), [Sphere](https://threejs.org/docs/pages/Sphere.html), [Frustum](https://threejs.org/docs/pages/Frustum.html), and [LOD](https://threejs.org/docs/pages/LOD.html)
- [WebGLRenderer.info and compileAsync](https://threejs.org/docs/pages/WebGLRenderer.html), plus renderer-common [Info](https://threejs.org/docs/pages/Info.html) and [Renderer](https://threejs.org/docs/pages/Renderer.html)
- [How to dispose of objects](https://threejs.org/manual/en/how-to-dispose-of-objects.html)
- [OffscreenCanvas and workers](https://threejs.org/manual/en/offscreencanvas.html)

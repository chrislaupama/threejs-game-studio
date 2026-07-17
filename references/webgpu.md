# WebGPU For Heavy Three.js Games And 3D Sites

## Contents

- Modern contract and product status verified against r185
- Heavy-3D renderer decision
- Renderer family and fallback boundaries
- TypeScript boot, backend reporting, resize, and teardown
- Built-in materials, node materials, and TSL
- GPU compute and GPU-driven effects
- Clustered lighting for many-light scenes
- RenderPipeline post-processing
- Compressed textures and output bandwidth
- Profiling, errors, device loss, and quality tiers
- Deprecation guardrails and release gate

Read `official-docs.md`, `rendering.md`, and this file before selecting
`WebGPURenderer`. Read `shaders.md` before writing TSL or post-processing nodes,
and `webxr.md` when XR is in scope.

Asset-loading examples use the project-owned `publicAssetUrl()` helper from
`local-assets.md`; import it from the local asset boundary in real code.

## Modern Contract And Status

This reference is verified against **Three.js r185**. Prefer the project's
installed revision and live docs over any frozen patch string, and recheck the
official API, source, types, migration notes, and examples on every upgrade.
The official
[WebGPURenderer guide](https://threejs.org/manual/en/webgpurenderer) calls
`WebGPURenderer` the next-generation alternative to `WebGLRenderer`, with a
WebGPU backend and automatic WebGL 2 fallback. It also explicitly says the
renderer remains experimental and that some applications may still have
missing features or better performance with `WebGLRenderer`.

Use that complete statement. Do not describe WebGPU as universally faster,
universally supported, or a drop-in renderer swap. Its strongest value is the
modern renderer architecture: node materials, TSL that can target WGSL or GLSL,
the node post stack, GPU compute, and newer renderer features.

r185 changed WebGPU premultiplied-alpha handling. For an opaque game canvas,
set an opaque `scene.background` or use `renderer.setClearColor(color, 1)`;
reserve a transparent background or clear alpha for a canvas that intentionally
composites with HTML, and regression-test that composition after an r184→r185
upgrade.

The [WebGPURenderer API](https://threejs.org/docs/pages/WebGPURenderer.html),
[Renderer API](https://threejs.org/docs/pages/Renderer.html),
[TSL specification](https://threejs.org/docs/TSL.html), matching r185 source,
and official r185 examples are the implementation authorities.

Public API guidance can be rechecked against the installed live docs. Claims
in this reference derived from implementation details—such as backend flags,
cluster assignment behavior, target ownership, type/runtime mismatches, and
timestamp hooks—are scoped to r185 only. Re-read the matching source, types,
migration notes, and official examples on every Three.js upgrade.

## Offer The Heavy-3D Choice

For every graphics-heavy or compute-heavy 3D request, present the choice before
custom materials or post-processing make it expensive to change:

```text
Renderer recommendation: WebGLRenderer | WebGPURenderer
Why: [measured or designed need: GPU compute / TSL / many lights / node post]
Status: experimental in Three.js r185
Fallback: WebGPURenderer's WebGL 2 backend for the compatible TSL/node path
Compatibility constraint: no ShaderMaterial, RawShaderMaterial,
  onBeforeCompile, or EffectComposer on this renderer family
Proof required: representative WebGPU and fallback browser measurements
Alternative: WebGLRenderer for mature GLSL/addon compatibility
```

Do not ask a novice to decide from renderer names alone. Explain the visible
impact, target devices, fallback, and maintenance cost, then recommend one.

### Initial decision matrix

| Evidence | Lean toward |
| --- | --- |
| Existing GLSL shaders, `onBeforeCompile()`, or `EffectComposer` | Preserve `WebGLRenderer` unless a deliberate port is funded |
| Simple learning scene or wide mature compatibility is the main goal | `WebGLRenderer` |
| TSL-first custom materials and node post stack | `WebGPURenderer` |
| Large GPU-updated particle, flock, fluid, or procedural simulation | `WebGPURenderer`, after a compute spike |
| Dense real-depth scene with many point lights | `WebGPURenderer` plus measured `ClusteredLighting` candidate |
| Many ordinary meshes but no compute/node need | Benchmark both; instancing, batching, LOD, culling, and asset cost matter more than the API name |
| Required feature is uncertain on fallback/headset/mobile | Build the smallest representative compatibility spike first |

WebGPU does not excuse weak content architecture. Share resources, instance or
batch repeated objects, cap DPR, use compressed textures, control shadows and
transparent overdraw, stream content deliberately, and profile the worst active
state on either renderer.

## Renderer Family Boundaries

Use one customization family per renderer path:

| Area | `WebGLRenderer` | `WebGPURenderer` |
| --- | --- | --- |
| Core import | `three` | `three/webgpu` |
| Custom shading | GLSL `ShaderMaterial`, `RawShaderMaterial`, `onBeforeCompile()` | Node materials and `three/tsl` |
| Post | `EffectComposer` and addon passes | `RenderPipeline` and TSL nodes |
| Backend | WebGL 2 | WebGPU, or WebGL 2 fallback |
| Initialization | Synchronous renderer setup | `setAnimationLoop()` auto-initializes, or `await renderer.init()` |

The WebGPURenderer's WebGL 2 fallback still uses the node/TSL renderer family.
It does not enable `ShaderMaterial`, `RawShaderMaterial`, `onBeforeCompile()`, or
`EffectComposer`. If one product must keep those features and also offer a
WebGPU build, preserve two renderer adapters and choose at boot. Share game
state, input, simulation, content metadata, and semantic render roles—not GPU
objects or renderer-specific materials.

r185's separate `WebGLRenderer` has a limited migration bridge through
`setNodesHandler(new WebGLNodesHandler())` and `setEffects()`. It can help port
supported node materials/effects incrementally. It does **not** allow
`RenderPipeline` on `WebGLRenderer`, and it does not relax any restriction on a
`WebGPURenderer` instance. The effects bridge must be chosen at construction:
`WebGLRenderer` requires `outputBufferType: HalfFloatType` or `FloatType` before
`setEffects()`; its default `UnsignedByteType` output is rejected. Clear the
bridge with `renderer.setEffects(null)` during teardown. See `rendering.md` for
the compile-checked setup.

Choose at boot and reload to change renderer/backend. Live hot-swapping makes
resource ownership, material identity, render targets, caches, and recovery
unnecessarily fragile.

## TypeScript Boot And Actual Backend

This complete pattern initializes before renderer-dependent setup, reports the
actual backend after fallback has resolved, uses one animation-loop owner, and
cleans up in dependency order:

```ts
import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';

type BackendName = 'webgpu' | 'webgl2-fallback' | 'unknown';

function backendErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const detail = error as {
      api?: unknown;
      type?: unknown;
      message?: unknown;
    };
    const tags = [detail.api, detail.type]
      .filter((value): value is string => typeof value === 'string')
      .join('/');
    const message = typeof detail.message === 'string'
      ? detail.message
      : 'Unknown backend error';
    return tags ? `${tags}: ${message}` : message;
  }
  return String(error);
}

function backendName(renderer: THREE.WebGPURenderer): BackendName {
  const backend = renderer.backend;
  if ('isWebGPUBackend' in backend && backend.isWebGPUBackend === true) {
    return 'webgpu';
  }
  if ('isWebGLBackend' in backend && backend.isWebGLBackend === true) {
    return 'webgl2-fallback';
  }
  return 'unknown';
}

async function createWebGpuGame(canvas: HTMLCanvasElement) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x08111d);

  const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 500);
  camera.position.set(0, 2.5, 7);

  const renderer = new THREE.WebGPURenderer({
    canvas,
    antialias: true,
    alpha: false,
    stencil: false,
    powerPreference: 'high-performance',
    outputBufferType: THREE.HalfFloatType,
  });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1;
  // Native WebGPU reads this during init when requesting an XR-compatible adapter.
  renderer.xr.enabled = true;

  renderer.onError = (error) => {
    console.error(`Three.js backend error: ${backendErrorMessage(error)}`);
  };
  const defaultDeviceLost = renderer.onDeviceLost.bind(renderer);
  renderer.onDeviceLost = (info) => {
    // Preserve Three.js's internal device-lost state before app recovery.
    defaultDeviceLost(info);
    void renderer.setAnimationLoop(null);
    console.error(`${info.api} device/context lost: ${info.message}`);
  };

  await renderer.init();

  const scenePass = pass(scene, camera);
  const pipeline = new THREE.RenderPipeline(renderer);
  pipeline.outputNode = scenePass;

  const timer = new THREE.Timer();
  timer.connect(document);
  timer.reset();
  let lastWidth = 0;
  let lastHeight = 0;
  let lastDpr = 0;

  function resize() {
    const width = Math.max(1, Math.floor(canvas.clientWidth));
    const height = Math.max(1, Math.floor(canvas.clientHeight));
    const requestedDpr = Math.min(window.devicePixelRatio || 1, 1.5);
    const budgetDpr = Math.sqrt((1920 * 1080) / (width * height));
    const dpr = Math.min(requestedDpr, budgetDpr);
    if (width === lastWidth && height === lastHeight && dpr === lastDpr) return;

    lastWidth = width;
    lastHeight = height;
    lastDpr = dpr;
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  function frame(timestamp: number) {
    timer.update(timestamp);
    const delta = Math.min(timer.getDelta(), 0.1);
    resize();
    updateGame(delta);
    if (renderer.xr.isPresenting) {
      renderer.render(scene, camera); // correct XR views; desktop post is off
    } else {
      pipeline.render();
    }
  }

  function updateGame(_delta: number) {
    // Input -> fixed simulation -> rules -> animation/VFX -> camera -> render.
  }

  await renderer.setAnimationLoop(frame);

  return {
    renderer,
    backend: backendName(renderer),
    async dispose() {
      const session = renderer.xr.getSession();
      if (session) await session.end();

      // r185 restores the pre-session callback while ending XR. Clear that
      // restored loop before releasing anything the callback can reach.
      await renderer.setAnimationLoop(null);
      timer.dispose();
      pipeline.dispose();
      scenePass.dispose();
      // Dispose scene-owned geometries, materials, textures, skeletons, and
      // audio before the renderer. This minimal scene owns none yet.
      renderer.dispose();
    },
  };
}
```

Catch that boot promise at the UI boundary. An initialization rejection is a
recoverable product state, not permission to leave a blank canvas:

```ts
try {
  const game = await createWebGpuGame(canvas);
  console.info(`Active renderer backend: ${game.backend}`);
} catch (error) {
  showRendererFailure(error, {
    retry: true,
    offerWebGLRenderer: true,
  });
}
```

`setAnimationLoop()` can initialize the first frame automatically. The explicit
`await renderer.init()` above is required because the code needs the resolved
backend and creates renderer-dependent systems before that frame. Use current
synchronous `render()`, `clear()`, `hasFeature()`, `initTexture()`, and PMREM
methods after initialization.

The optional scaffold adapter at
`assets/threejs-vite-game/src/examples/WebGpuRendererOption.ts` packages this
ownership pattern in compile-checked form.

### Force and verify the fallback

Use `forceWebGL` only at construction:

```ts
const renderer = new THREE.WebGPURenderer({
  canvas,
  antialias: true,
  forceWebGL: true,
  alpha: false,
});
await renderer.init();
```

This tests the WebGPURenderer's WebGL 2 backend. It is different from testing a
separate `WebGLRenderer` path. Record these independently:

```text
Renderer class: WebGPURenderer
Requested backend: automatic / forced WebGL2
Actual backend after init: WebGPU / WebGL2
Material family: built-in mapped material / node material + TSL
Post family: direct / RenderPipeline
```

## Materials And TSL

`WebGPURenderer` maps supported built-in materials internally, so ordinary
`MeshStandardMaterial` and `MeshPhysicalMaterial` content can render. Use node
materials when custom shader behavior is required. Do not translate GLSL line
by line; rebuild the semantic inputs and outputs with TSL.

```ts
import * as THREE from 'three/webgpu';
import { color, mix, time, uniform } from 'three/tsl';

const cool = uniform(new THREE.Color(0x16457a));
const hot = uniform(new THREE.Color(0x31dcff));
const pulse = time.mul(2).sin().mul(0.5).add(0.5);

const material = new THREE.MeshStandardNodeMaterial();
material.colorNode = mix(cool, hot, pulse.mul(0.35));
material.emissiveNode = color(0x14bde8).mul(pulse.mul(1.5));
material.roughness = 0.45;
material.metalness = 0.1;

cool.value.set(0x1c4f8f);
```

Use JavaScript branches outside a TSL function for CPU-side material selection.
For a value that varies per vertex, fragment, or compute invocation, put flow
inside `Fn()` and use TSL `If()`, `Switch()`, or `Loop()`:

```ts
// Continuing the material example above.
import { Fn, If, float } from 'three/tsl';

const shapePulse = Fn(([value]: [typeof pulse]) => {
  const result = value.toVar();

  If(value.greaterThan(0.65), () => {
    result.assign(float(1));
  });

  return result;
});

material.emissiveNode = color(0x14bde8).mul(shapePulse(pulse));
```

Read the official [TSL specification](https://threejs.org/docs/TSL.html) for
typed constants, variables, functions, arrays, loops, texture sampling,
material slots, render passes, and storage. Keep reusable graph functions small
and name important uniforms/functions so generated shader diagnostics remain
readable.

Keep color-space semantics identical to the WebGL path: color and emissive maps
use `SRGBColorSpace`; normal, roughness, metalness, AO, masks, and other data
maps use `NoColorSpace`; HDR loader output remains in its provided linear
space. Let `GLTFLoader` apply glTF material conventions.

TSL changes quickly. Resolve every import against the installed `three/tsl`
export, typecheck it, and compare it with the version-matching official example.
Use `setName()`, `isolate()`, `Stack()`, `packNormalToRGB()`,
`unpackRGBToNormal()`, and current node names—not compatibility aliases.

## GPU Compute

GPU compute is a strong reason to offer WebGPU when many similar elements can
remain on the GPU: particles, boids, cellular fields, procedural deformation,
fluid-like effects, visibility preparation, and other data-parallel work. Keep
authoritative gameplay state on the CPU unless the design accepts asynchronous
readback and a different determinism/debugging model.

The current pattern creates storage-backed instanced arrays, initializes them
after renderer initialization, dispatches with `renderer.compute()`, and reads
the same data as vertex attributes:

```ts
import * as THREE from 'three/webgpu';
import {
  Fn,
  If,
  hash,
  instanceIndex,
  instancedArray,
  uniform,
  vec3,
} from 'three/tsl';

const COUNT = 65_536;
const positions = instancedArray(COUNT, 'vec3');
const velocities = instancedArray(COUNT, 'vec3');
const simulationDelta = uniform(1 / 60).setName('Simulation delta seconds');

const initialize = Fn(() => {
  const id = instanceIndex;
  positions.element(id).assign(vec3(
    hash(id).sub(0.5).mul(20),
    hash(id.add(17)).mul(10),
    hash(id.add(31)).sub(0.5).mul(20),
  ));
  velocities.element(id).assign(vec3(0, -0.2, 0));
});

const simulate = Fn(() => {
  const position = positions.element(instanceIndex);
  const velocity = velocities.element(instanceIndex);
  velocity.y.subAssign(simulationDelta.mul(9.8));
  position.addAssign(velocity.mul(simulationDelta));

  If(position.y.lessThan(-5), () => {
    position.y.assign(5);
    velocity.y.assign(0);
  });
});

const initCompute = initialize().compute(COUNT).setName('Initialize particles');
const updateCompute = simulate().compute(COUNT).setName('Simulate particles');

await renderer.init();
renderer.compute(initCompute);

const particleMaterial = new THREE.SpriteNodeMaterial({
  blending: THREE.AdditiveBlending,
  depthWrite: false,
});
particleMaterial.positionNode = positions.toAttribute();

// Sprite.count is the WebGPURenderer instancing path used by the official
// compute-particles example. SpriteNodeMaterial is a sprite material, not a
// mesh material for an InstancedMesh/PlaneGeometry pair.
const particles = new THREE.Sprite(particleMaterial);
particles.count = COUNT;
particles.scale.setScalar(0.04);
scene.add(particles);
// GPU-updated positions are not reflected in CPU-computed instance bounds.
// Disabling culling is conservative; partition large effects into bounded
// emitters when their draw cost makes that worthwhile.
particles.frustumCulled = false;

const timer = new THREE.Timer();
timer.connect(document);
timer.reset();

await renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  simulationDelta.value = Math.min(timer.getDelta(), 1 / 30);
  renderer.compute(updateCompute);
  renderer.render(scene, camera);
});

async function disposeParticles() {
  const session = renderer.xr.getSession();
  if (session) await session.end();

  // Session end can restore the pre-XR compute/render callback in r185.
  await renderer.setAnimationLoop(null);
  scene.remove(particles);
  timer.dispose();
  initCompute.dispose();
  updateCompute.dispose();
  particleMaterial.dispose();
  positions.value.dispose();
  velocities.value.dispose();
}
```

This is a presentation effect, not a collision system. Keep player hits,
objectives, scores, and other authoritative rules in deterministic CPU state or
design an explicit, infrequent readback boundary with loading/error handling.
Avoid GPU-to-CPU readback in the frame hot path. When a deliberate checkpoint
needs a snapshot, use the current renderer readback API and remember that WGSL
storage `vec3` data may be padded to a four-float stride:

```ts
const positionBytes = await renderer.getArrayBufferAsync(positions.value);
const positionFloats = new Float32Array(positionBytes);
const storageStride = positions.value.itemSize;
const firstPosition = positionFloats.subarray(0, Math.min(3, storageStride));
```

For repeated diagnostics, a
[ReadbackBuffer](https://threejs.org/docs/pages/ReadbackBuffer.html) can reuse
the intermediate GPU buffer, but it must be `release()`d between mappings and
`dispose()`d at teardown. Readback still stalls asynchronous GPU work; it is not
a substitute for CPU-authoritative collision or per-frame telemetry.

The bounded delta makes motion independent of display refresh within the
integrator's limits and avoids a large hidden-tab step. A fixed compute cadence
is preferable when repeatability matters. The second TSL `.compute()` argument
is the workgroup size—`simulate().compute(COUNT, [64])` makes the default
one-dimensional size explicit. Tune it only with target-device measurements and
device-limit checks. `renderer.compute(node, [x, y, z])` also accepts a runtime
multidimensional dispatch override, or an `IndirectStorageBufferAttribute` for
indirect dispatch. Atomics and `workgroupBarrier()` solve specific shared-data
hazards; a workgroup barrier does not synchronize separate workgroups or
dispatches.

Stop the animation loop and dispose the `Timer`, compute nodes, node material,
and storage attribute owners during teardown, as the example does.

`computeAsync()` remains a current method on modern revisions. Prefer `compute()` after
explicit initialization for the ordinary frame loop; use async APIs only when
their actual promise/readback semantics are needed. Do not repeat the migration
guide's ambiguous `computerAsync` spelling as an API name.

## Many Lights With ClusteredLighting

r185 includes the official
[ClusteredLighting](https://threejs.org/docs/pages/ClusteredLighting.html) addon,
a Forward+ clustered system for scenes with many point lights and real depth
complexity. It partitions the view frustum so fragments evaluate lights that
reach their cluster.

Assign the lighting system before `renderer.init()`:

```ts
import * as THREE from 'three/webgpu';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';

const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: false });
renderer.lighting = new ClusteredLighting(
  1024, // maximum point lights
  32,   // tile size in pixels
  24,   // depth slices
  64,   // maximum lights per cluster
);
await renderer.init();
```

Use it only after the lighting design truly needs many local point lights.
Baked emissive art, environment lighting, a small key/fill rig, pooled lights,
and fewer shadow casters remain cheaper.

The r185 implementation clusters only `PointLight` instances whose
`castShadow` is not `true`; shadow-casting point lights and every other light
type stay in the ordinary material-light path. Give clustered point lights a
finite, positive `distance`. Although ordinary `PointLight.distance = 0` means
unbounded illumination, **distance zero is unsupported by r185
`ClusteredLighting`**: its z-range candidate step substitutes the camera range,
while its cluster sphere test still uses the literal zero radius, so assignment
is not reliable. Use bounded point lights or a non-clustered light type for
unbounded illumination.

Treat `maxLights` and `maxLightsPerCluster` as capacities, not aspirations.
Keep the active unshadowed-point-light count at or below `maxLights`, and build a
stress view in which many ranges overlap the same screen tile and depth slice.
The r185 source does not emit an application-facing overflow warning;
per-cluster construction stops when `maxLightsPerCluster` is full. Expose active
candidate count and the configured capacities in diagnostics, then reduce light
count/range or raise a measured capacity before visible light loss can occur.

Measure cluster construction/compute, fragment cost, light overlap, shadow
maps, and target-device behavior. Validate the WebGL 2 fallback separately; do
not infer compatibility from WebGPU success.

## RenderPipeline Post-Processing

Use [RenderPipeline](https://threejs.org/docs/pages/RenderPipeline.html), not
`EffectComposer` or the deprecated `PostProcessing` alias:

```ts
import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

const scenePass = pass(scene, camera);
const sceneColor = scenePass.getTextureNode('output');
const glow = bloom(sceneColor, 0.45, 0.25, 0.9);
glow.setResolutionScale(0.5);

const pipeline = new THREE.RenderPipeline(renderer);
pipeline.outputNode = sceneColor.add(glow);

function renderPostFrame() {
  if (renderer.xr.isPresenting) {
    renderer.render(scene, camera);
  } else {
    pipeline.render();
  }
}

await renderer.setAnimationLoop(renderPostFrame);

async function disposePost() {
  const session = renderer.xr.getSession();
  if (session) await session.end();

  // Clear the callback restored by XRManager before disposing its graph.
  await renderer.setAnimationLoop(null);
  glow.dispose();
  scenePass.dispose();
  pipeline.dispose();
}
```

Changing uniforms such as bloom strength updates the existing graph. Replacing
the graph after its first render requires the documented invalidation flag and
an explicit ownership handoff for every target-owning node retired with the old
graph:

```ts
type DisposableNodeOwner = { dispose(): void };

async function replacePostGraph(
  nextOutputNode: THREE.Node,
  retiredOwners: readonly DisposableNodeOwner[],
) {
  if (renderer.xr.getSession()) {
    throw new Error('Defer post-graph replacement until the XR session ends');
  }

  await renderer.setAnimationLoop(null);
  pipeline.outputNode = nextOutputNode;
  pipeline.needsUpdate = true;
  for (const owner of retiredOwners) owner.dispose();
  await renderer.setAnimationLoop(renderPostFrame);
}
```

Only pass owners that are absent from the new graph; shared scene passes and
history targets must stay alive until their final consumer releases them. Keep
the loop stopped from graph detachment through retired-owner disposal so no
frame can observe a half-replaced graph.

When an effect needs more than beauty color, capture only the required outputs
with MRT. This selective-bloom form renders beauty and emissive data together,
then blooms only the emissive channel:

```ts
import { emissive, mrt, output, pass as renderMrtPass } from 'three/tsl';
import { bloom as bloomEmissive } from 'three/addons/tsl/display/BloomNode.js';

const selectivePass = renderMrtPass(scene, camera);
selectivePass.setMRT(mrt({ output, emissive }));

const beauty = selectivePass.getTextureNode('output');
const emissiveOnly = selectivePass.getTextureNode('emissive');
const selectiveGlow = bloomEmissive(emissiveOnly, 0.45, 0.25, 0.9);

const selectivePipeline = new THREE.RenderPipeline(renderer);
selectivePipeline.outputNode = beauty.add(selectiveGlow);

async function disposeSelectivePost() {
  const session = renderer.xr.getSession();
  if (session) await session.end();

  // Clear the callback restored by XRManager before disposing target owners.
  await renderer.setAnimationLoop(null);
  selectiveGlow.dispose();
  selectivePass.dispose();
  selectivePipeline.dispose();
}
```

Depth is available from `getTextureNode('depth')` without adding an MRT color
attachment. Normals, velocity, emissive, and custom outputs add target memory
and bandwidth, so request them only when a downstream effect consumes them and
choose their texture types deliberately. See the official
[TSL MRT contract](https://threejs.org/docs/TSL.html#multiple-render-targets-mrt)
and [BloomNode](https://threejs.org/docs/pages/BloomNode.html) selective example.

In r185, `RenderPipeline.render()` temporarily disables `renderer.xr.enabled`
while it owns rendering. It is therefore a desktop/non-XR post path. During an
XR session, branch on `renderer.xr.isPresenting`, call
`renderer.render(scene, camera)` directly, and disclose that the desktop node
post effects are unavailable in-headset. The pipeline resumes automatically
after the session. Use a different XR post path only when it is verified
against the exact installed revision and tested on the target headset.

`RenderPipeline` applies tone mapping and output color conversion by default.
Do not add a second conversion. For an effect that must run after conversion,
use the current `renderOutput()` node deliberately and set
`pipeline.outputColorTransform = false`.

In r185, `PassNode` and the bundled self-sizing effect nodes read the renderer's
drawing-buffer size. Resize the renderer and camera from one owner. There is no
`RenderPipeline.setSize()` method. Custom targets and history buffers remain
their creator's resize/disposal responsibility. Re-verify this target-ownership
behavior when upgrading before removing or adding manual resize calls.

When XR may be active, end and await the session first because r185 restores its
saved pre-session callback. Then clear that restored loop and dispose the
pipeline plus every target-owning node, as `disposePost()` demonstrates. The
r185 runtime `BloomNode` and `PassNode` have `dispose()`, while some
`@types/three` releases may omit a runtime method — cast or extend locally when
types lag the installed runtime, and keep the guarded cleanup described in
`shaders.md` until the declaration catches up.

## Texture Compression And Output Bandwidth

For heavy 3D, reduce upload size, GPU memory, and sampling bandwidth before
assuming a renderer change will solve content cost. Prefer glTF/GLB plus local
KTX2 textures when the pipeline supports them.

Initialize WebGPU before KTX2 capability detection:

```ts
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';

await renderer.init();
const ktx2 = new KTX2Loader()
  .setTranscoderPath(publicAssetUrl('assets/basis/'))
  .detectSupport(renderer);

const texture = await ktx2.loadAsync(
  publicAssetUrl('assets/textures/world-color.ktx2'),
);
```

Keep the transcoder files project-local. Dispose the loader when loading is
complete and dispose textures when their owning content is released.

`WebGPURenderer` defaults `outputBufferType` to `HalfFloatType` for quality.
The official API allows `UnsignedByteType` to save memory and bandwidth at a
quality cost. Treat this as a measured quality-tier choice, not an automatic
mobile switch:

```ts
const renderer = new THREE.WebGPURenderer({
  canvas,
  alpha: false,
  outputBufferType: lowBandwidthTier
    ? THREE.UnsignedByteType
    : THREE.HalfFloatType,
});
```

Changing renderer options requires rebuilding the renderer path at boot.

## Diagnostics And Profiling

Report the renderer class and actual backend after initialization. For the
WebGPU renderer family, the current common
[Info](https://threejs.org/docs/pages/Info.html) shape includes draw calls,
triangles, compute calls, resource counts, and tracked byte sizes:

```ts
function readWebGpuStats(renderer: THREE.WebGPURenderer) {
  const { render, compute, memory } = renderer.info;
  return {
    backend: backendName(renderer),
    drawCalls: render.drawCalls,
    triangles: render.triangles,
    computeCalls: compute.frameCalls,
    geometries: memory.geometries,
    textures: memory.textures,
    textureBytes: memory.texturesSize,
    renderTargets: memory.renderTargets,
    totalTrackedBytes: memory.total,
  };
}
```

These counters do not replace a GPU timeline. Measure representative frame
captures, not empty scenes. Compare native WebGPU and every claimed fallback at
the same CSS size, DPR, scene state, camera, quality tier, and warm-up state.

For diagnostic sampling, the r185 backend option `trackTimestamp: true`
requests timing support. This option and `resolveTimestampsAsync()` are r185
source-backed diagnostic surfaces, but they are not documented on the generated
public `WebGPURenderer`/`Renderer` API pages. Treat them as experimental,
r185-pinned instrumentation; re-verify the installed source and types on every
upgrade, or use
the official [Inspector](https://threejs.org/examples/jsm/inspector/Inspector.js)
integration instead of building a permanent game dependency on them.

After initialization, guard timestamp use and resolve render and compute pools
explicitly—the method's no-argument default resolves render timing only:

```ts
if (renderer.hasFeature('timestamp-query')) {
  const renderMs = await renderer.resolveTimestampsAsync(
    THREE.TimestampQuery.RENDER,
  );
  const computeMs = await renderer.resolveTimestampsAsync(
    THREE.TimestampQuery.COMPUTE,
  );
  console.debug({ renderMs, computeMs });
}
```

Resolve outside the ordinary per-frame hot path; frequent query resolution and
GPU readback can disturb the workload being measured. The WebGL 2 fallback can
report different feature support, so perform the guard after the actual backend
has initialized.

Track at least:

- CPU frame/update/render-submit time and GPU frame/pass time
- actual backend, canvas buffer size, DPR, output buffer type, and MSAA
- draw calls, triangles, active programs/pipelines, compute dispatches
- texture/target/storage-buffer counts and tracked bytes
- transparent fill, particle area, shadow maps/casters, and post-pass cost
- compile hitches, asset decode/upload time, memory growth, and re-entry baseline

## Failure, Recovery, And Quality Tiers

Do not silently hide backend failures. Surface `renderer.onError` messages in a
diagnostic/loading-error UI. On `renderer.onDeviceLost`, stop simulation and
the loop, preserve recoverable game state, and offer a controlled renderer
rebuild or page restart. Test the chosen recovery path; callback presence is not
proof of recovery.

Build quality tiers from measured owners:

| Owner | Lower-cost response |
| --- | --- |
| Fill/post cost | Lower capped DPR, lower effect resolution, fewer passes |
| Many lights | Fewer active lights, smaller ranges, no low-value shadows, measured clustered path |
| Geometry submission | Instancing, batching, LOD, culling, fewer material variants |
| Texture bandwidth/memory | KTX2, lower resolution, atlas/packing, fewer simultaneous sets |
| Compute | Fewer elements/iterations/dispatches, lower update cadence, CPU alternative for small counts |
| Transparency | Smaller particle footprint, alpha test, pooled effects, less overlap |

Degrade visual density without changing authoritative gameplay, collision,
objectives, or timing. Use hysteresis so adaptive quality does not oscillate.

## Current Deprecation Guardrails

For WebGPU code verified against r185:

- use `RenderPipeline`, not the deprecated `PostProcessing` alias
- use `pipeline.render()`, not deprecated `pipeline.renderAsync()`
- initialize once, then use `renderer.render()`, `clear()`, `hasFeature()`,
  `initTexture()`, and synchronous PMREM generation methods
- do not use deprecated `renderer.renderAsync()`, `waitForGPU()`, async clear
  helpers, `hasFeatureAsync()`, or `initTextureAsync()`
- do not mark current `computeAsync()`, `compileAsync()`, readback methods, or
  `resolveTimestampsAsync()` deprecated merely because their names are async
- use `KTX2Loader.detectSupport()`, not `detectSupportAsync()`
- use `outputBufferType` and `getOutputBufferType()`, not the old color-buffer
  names
- use `PCFShadowMap`, not `PCFSoftShadowMap`
- use current TSL `setName()`, `isolate()`, `Stack()`,
  `packNormalToRGB()`, `unpackRGBToNormal()`, `screenSize`, and
  `setResolutionScale()` names
- use `BloomNode` for the relevant glow/anamorphic intent; do not restore the
  removed `AnamorphicNode`
- use `ClusteredLighting`; do not copy obsolete `TiledLighting` examples
- never combine this renderer with GLSL `ShaderMaterial`, `RawShaderMaterial`,
  `onBeforeCompile()`, or `EffectComposer`

Run `npm run audit:structure` when changing this skill: it scans executable
Markdown examples and scaffold TypeScript for the deprecated API set verified
against r185 and for renderer-family mixing. Re-audit the scanner rules on each
Three.js upgrade.

## WebGPU Release Gate

Before claiming a WebGPU game/site is complete, prove:

- exact installed Three.js revision, type package, lockfile, and build
- renderer class, requested backend, and actual backend after initialization
- no shader, TSL, validation, uncaptured backend, or device-loss errors
- material and post stack stay inside the WebGPU/TSL family
- native WebGPU works in every claimed target browser/device
- the WebGL 2 fallback works where claimed, with unsupported features declared
- a separate `WebGLRenderer` path is tested separately if the product claims it
- loaders that inspect renderer support run only after initialization
- worst-state CPU/GPU time, DPR, calls, triangles, compute, texture/target bytes,
  shadows, transparent fill, and post cost are recorded
- quality changes preserve gameplay state and readability
- resize, visibility pause/resume, loading failure, device/context loss policy,
  teardown, and re-entry are exercised
- no deprecated API warning appears in a clean production-preview run
- browser/mobile/XR checks not run are explicitly reported

Choose WebGPU because the project benefits from its architecture and passes
this evidence gate—not because the scene is merely called advanced.

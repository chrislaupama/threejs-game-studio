# WebGPU For Heavy Three.js Games And 3D Sites

## Contents

- Stable r185.1 contract and product status
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

## Stable Contract And Status

This reference targets **`three@0.185.1` (r185)**. The official
[WebGPURenderer guide](https://threejs.org/manual/en/webgpurenderer) calls
`WebGPURenderer` the next-generation alternative to `WebGLRenderer`, with a
WebGPU backend and automatic WebGL 2 fallback. It also explicitly says the
renderer remains experimental and that some applications may still have
missing features or better performance with `WebGLRenderer`.

Use that complete statement. Do not describe WebGPU as universally faster,
universally supported, or a drop-in renderer swap. Its strongest value is the
modern renderer architecture: node materials, TSL that can target WGSL or GLSL,
the node post stack, GPU compute, and newer renderer features.

The [WebGPURenderer API](https://threejs.org/docs/pages/WebGPURenderer.html),
[Renderer API](https://threejs.org/docs/pages/Renderer.html),
[TSL specification](https://threejs.org/docs/TSL.html), matching r185 source,
and official r185 examples are the implementation authorities.

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
`WebGPURenderer` instance. See `rendering.md` for the compile-checked boundary.

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
    dispose() {
      void renderer.setAnimationLoop(null);
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

const particles = new THREE.InstancedMesh(
  new THREE.PlaneGeometry(0.04, 0.04),
  particleMaterial,
  COUNT,
);
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
```

This is a presentation effect, not a collision system. Keep player hits,
objectives, scores, and other authoritative rules in deterministic CPU state or
design an explicit, infrequent readback boundary with loading/error handling.
Avoid GPU-to-CPU readback in the frame hot path.

The bounded delta makes motion independent of display refresh within the
integrator's limits and avoids a large hidden-tab step. A fixed compute cadence
is preferable when repeatability matters. Stop the animation loop and dispose
the `Timer`, geometry, node material, and storage owners during teardown.

`computeAsync()` remains a current r185.1 method. Prefer `compute()` after
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

const renderer = new THREE.WebGPURenderer({ canvas, antialias: true });
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
and fewer shadow casters remain cheaper. Measure cluster construction/compute,
fragment cost, light overlap, shadow maps, and target-device behavior. Validate
the WebGL 2 fallback separately; do not infer compatibility from WebGPU success.

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

await renderer.setAnimationLoop(() => {
  if (renderer.xr.isPresenting) {
    renderer.render(scene, camera);
  } else {
    pipeline.render();
  }
});
```

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

`PassNode` and current self-sizing effect nodes read the renderer's drawing
buffer size. Resize the renderer and camera from one owner. There is no
`RenderPipeline.setSize()` method. Custom targets and history buffers remain
their creator's resize/disposal responsibility.

Dispose the pipeline and every target-owning node after stopping the loop. The
r185 runtime `BloomNode` has `dispose()`, while `@types/three@0.185.1` omits that
declaration; keep the guarded cleanup described in `shaders.md` until the
installed type declaration changes.

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

For diagnostic sampling, `trackTimestamp: true` requests timing support. After
initialization, guard timestamp use with `renderer.hasFeature('timestamp-query')`.
Use `resolveTimestampsAsync()` outside the ordinary per-frame hot path; frequent
GPU readback can disturb the workload being measured.

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

For r185.1 WebGPU code:

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

Run `npm run audit:structure` when changing this skill: it scans
executable Markdown examples and scaffold TypeScript for the curated r185.1
deprecated API set and renderer-family mixing.

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

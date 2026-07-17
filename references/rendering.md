# Rendering, Cameras, Lighting, And Post

## Contents

- Renderer decision and WebGL baseline
- Pixel ratio, resize, and output ownership
- Linear workflow and texture color spaces
- Camera framing and depth precision
- PBR materials, environment, and lighting
- Shadows and transparency
- WebGL and WebGPU post-processing boundaries
- Renderer diagnostics and failure checks
- Performance and visual QA

Choose the renderer and output pipeline before authoring shaders or effects.
Keep all runtime modules, textures, environments, and decoder files local.
Official links in this reference document API intent; they are not runtime
dependencies.

Asset-loading examples use the project-owned `publicAssetUrl()` helper from
`local-assets.md`; import it from the local asset boundary in real code.

## Renderer Decision

Use [WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html) for the
mature WebGL 2 path, existing addon passes, GLSL materials, and broad
compatibility. WebGL 1 is not supported.

For a graphics-heavy or compute-heavy 3D site/game, always present
[WebGPURenderer](https://threejs.org/docs/pages/WebGPURenderer.html) as a
first-class option and recommend evaluating it first when the project benefits
from TSL, GPU compute, node post-processing, many-light clustered rendering, or
a modern renderer architecture. It uses WebGPU when available and can fall
back to a WebGL 2 backend. It remains experimental and is not guaranteed to
outperform `WebGLRenderer`, so the recommendation must include a representative
benchmark and fallback plan. Read the official
[WebGPURenderer guide](https://threejs.org/manual/en/webgpurenderer) and the
dedicated `webgpu.md` reference before choosing it.

Classify the workload before asking for a renderer decision:

| Workload evidence | Initial recommendation |
| --- | --- |
| Existing GLSL/onBeforeCompile/EffectComposer stack, broad legacy browser/device target, or simple teaching scene | `WebGLRenderer` |
| GPU compute, TSL-first materials/node post, or a measured many-point-light case suited to clustered lighting | Offer and lean toward `WebGPURenderer`, then benchmark |
| Many ordinary meshes or effects without a renderer-specific need | Offer both and benchmark both; optimize instancing/batching, LOD, culling, assets, overdraw, and post cost first |
| Uncertain target or no representative scene yet | Start with renderer-agnostic game state and a small WebGPU/WebGL spike before material/post architecture hardens |

Use these as the primary production stacks:

| Renderer | Custom material | Post-processing |
| --- | --- | --- |
| `WebGLRenderer` | GLSL `ShaderMaterial`, `RawShaderMaterial`, `onBeforeCompile` | `EffectComposer` and addon passes |
| `WebGPURenderer` | Node materials and TSL | `RenderPipeline` and TSL nodes |

r185 also provides a limited **WebGL migration bridge**. `WebGLRenderer` can
compile supported node materials after `setNodesHandler(new
WebGLNodesHandler())`, and `setEffects()` can host supported effect objects.
This helps stage a future WebGPU port; it does not turn `WebGLRenderer` into a
`RenderPipeline` renderer, and it does not make WebGL-only GLSL compatible with
`WebGPURenderer`. Validate every node/effect used on the exact fallback devices.

The installed r185 `WebGLNodesHandler` explicitly does not support VSM shadows,
MRT, transmission, the WebGPU post stack, or storage textures. Fog/environment
changes require material disposal/rebuild; instanced geometry cannot be shared;
and node materials are not supported by `renderer.compile()`. Treat these as
hard bridge constraints until the exact installed source proves otherwise.

```ts
import * as THREE from 'three';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { WebGLNodesHandler } from 'three/addons/tsl/WebGLNodesHandler.js';

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: false,
  outputBufferType: THREE.HalfFloatType,
});
renderer.setNodesHandler(new WebGLNodesHandler());

const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.45, 0.3, 0.9);
renderer.setEffects([bloom]);

// setEffects applies tone mapping/output conversion; do not add OutputPass.
renderer.setAnimationLoop(() => renderer.render(scene, camera));
```

`setEffects()` requires `HalfFloatType` or `FloatType` output buffers. Retain
and dispose each effect you create, then clear the renderer's reference with
`renderer.setEffects(null)` during teardown. Treat this bridge as a measured
migration aid, not a reason to combine every renderer architecture.

Declare what **WebGL fallback** means; two different architectures use that
phrase:

1. One `WebGPURenderer` can use its WebGPU backend normally and its WebGL 2
   backend with `forceWebGL: true`. This is appropriate only when the whole
   render path uses node materials/TSL and features supported by both backends.
2. A project that must preserve GLSL, `onBeforeCompile`, or `EffectComposer`
   needs a separate `WebGLRenderer` adapter plus a WebGPU/TSL adapter. The
   WebGPURenderer's WebGL backend does not make a WebGLRenderer-only shader or
   pass stack compatible.

Choose the backend at boot and reload when the player changes it. Do not hot
swap live GPU state. Record the renderer class and actual backend separately
after initialization, and exercise native WebGPU, `forceWebGL: true`, and the
preserved `WebGLRenderer` path only when each is genuinely claimed. A
`WebGPURenderer` instance that fell back to WebGL 2 is not evidence that native
WebGPU was tested.

## WebGL Renderer Baseline

Start with explicit ownership and conservative buffers:

```ts
import * as THREE from 'three';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) throw new Error('Missing #game canvas');

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: false,
  depth: true,
  stencil: false,
  powerPreference: 'high-performance',
});

renderer.outputColorSpace = THREE.SRGBColorSpace; // current default, explicit contract
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
renderer.setClearColor(0x0b1018, 1);
```

Only request `alpha`, `stencil`, logarithmic depth, preserve-drawing-buffer, or
other expensive/specialized options when the design needs them. Constructor
options cannot generally be changed later. Prefer an opaque canvas and scene
background unless the game must composite over HTML.

Do not set removed `outputEncoding`, gamma flags, `physicallyCorrectLights`, or
`useLegacyLights`. Retune lights under the current rendering model.

## Resize And Output Ownership

Keep one function responsible for renderer, camera, composer/pipeline, and any
screen-sized render targets. Resize only when CSS dimensions or capped DPR
change. The official [responsive guide](https://threejs.org/manual/en/responsive.html)
explains CSS pixels versus drawing-buffer pixels.

```ts
const composerOutputSizes = new WeakMap<
  EffectComposer,
  { width: number; height: number; dpr: number }
>();

function resizeFrame(
  renderer: THREE.WebGLRenderer,
  camera: THREE.PerspectiveCamera,
  composer?: EffectComposer,
) {
  const canvas = renderer.domElement;
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  const requestedDpr = Math.min(window.devicePixelRatio || 1, 1.5);
  const budgetDpr = Math.sqrt((1920 * 1080) / (width * height));
  const dpr = Math.min(requestedDpr, budgetDpr);
  const bufferWidth = Math.floor(width * dpr);
  const bufferHeight = Math.floor(height * dpr);

  const rendererChanged =
    renderer.getPixelRatio() !== dpr ||
    canvas.width !== bufferWidth ||
    canvas.height !== bufferHeight;
  const aspect = width / height;
  const cameraChanged = camera.aspect !== aspect;
  const previousComposerSize = composer
    ? composerOutputSizes.get(composer)
    : undefined;
  const composerChanged = Boolean(
    composer &&
    (!previousComposerSize ||
      previousComposerSize.width !== width ||
      previousComposerSize.height !== height ||
      previousComposerSize.dpr !== dpr),
  );

  if (!rendererChanged && !cameraChanged && !composerChanged) return;

  if (rendererChanged) {
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
  }
  if (cameraChanged) {
    camera.aspect = aspect;
    camera.updateProjectionMatrix();
  }

  if (composer && composerChanged) {
    composer.setPixelRatio(dpr);
    composer.setSize(width, height);
    composerOutputSizes.set(composer, { width, height, dpr });
  }
}
```

If post-processing renders the final image, call only `composer.render()` or
`renderPipeline.render()` for that frame. Do not also call
`renderer.render(scene, camera)` and accidentally render twice.

Apply tone mapping and output color conversion exactly once. For WebGL
`EffectComposer`, place `OutputPass` last. For WebGPU `RenderPipeline`, keep its
automatic output transform enabled unless a specific effect requires an
earlier `renderOutput()` node.

## Color Management

Three.js uses a Linear-sRGB working space and enables color management by
default. The renderer's output color space defaults to sRGB. Read the official
[color-management guide](https://threejs.org/manual/en/color-management.html)
and [Texture.colorSpace API](https://threejs.org/docs/pages/Texture.html).

Classify every texture by meaning:

```ts
const baseColor = await textureLoader.loadAsync(
  publicAssetUrl('assets/textures/hull-color.webp'),
);
baseColor.colorSpace = THREE.SRGBColorSpace;

const emissive = await textureLoader.loadAsync(
  publicAssetUrl('assets/textures/hull-emissive.webp'),
);
emissive.colorSpace = THREE.SRGBColorSpace;

const normal = await textureLoader.loadAsync(
  publicAssetUrl('assets/textures/hull-normal.webp'),
);
normal.colorSpace = THREE.NoColorSpace;

const roughness = await textureLoader.loadAsync(
  publicAssetUrl('assets/textures/hull-roughness.webp'),
);
roughness.colorSpace = THREE.NoColorSpace;
```

- Mark base color, emissive color, UI art, and other display-referred color
  textures as `SRGBColorSpace`.
- Leave normal, roughness, metalness, AO, displacement, masks, lookup data, and
  other non-color textures at `NoColorSpace`.
- Keep HDR/EXR environment data in its loader-provided linear color space.
- Let `GLTFLoader` apply the glTF color-space conventions; avoid overriding
  imported texture metadata without inspecting the material role.
- Treat numeric `Color` hex and CSS inputs as sRGB inputs converted into the
  working space. When setting raw linear components, state the source space.

Wrong color-space annotation cannot be fixed reliably by exposure or bloom.
Inspect a neutral gray, saturated color, matte dielectric, metal, and emissive
reference before grading the whole scene.

## Tone Mapping And Exposure

Choose a tone mapper based on the art direction and gameplay read. Current
[WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html) choices
include no tone mapping, Linear, Reinhard, Cineon, ACES Filmic, AgX, Neutral,
and custom tone mapping.

```ts
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
```

- Use one exposure control for the scene; do not compensate each material for
  an unstable global exposure.
- Check bright emissive cues, white UI, dark hazards, and adaptation between
  spaces.
- Do not let bloom become a replacement for an authored emissive hierarchy.
- Compare post on/off and preserve interaction readability in the unprocessed
  image.

## Camera Integration

Use a [PerspectiveCamera](https://threejs.org/docs/pages/PerspectiveCamera.html)
for most action games. Keep near/far tight and update projection after changes:

```ts
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 500);
camera.position.set(0, 5, 9);
camera.lookAt(0, 1, 0);
```

Frame a bounded subject without unexplained distance constants:

```ts
const bounds = new THREE.Box3().setFromObject(subject);
const sphere = bounds.getBoundingSphere(new THREE.Sphere());
const verticalHalfFov = THREE.MathUtils.degToRad(camera.fov * 0.5);
const horizontalHalfFov = Math.atan(
  Math.tan(verticalHalfFov) * Math.max(camera.aspect, 0.01),
);
const limitingHalfFov = Math.min(verticalHalfFov, horizontalHalfFov);
const distance = sphere.radius / Math.max(Math.sin(limitingHalfFov), 0.01);
const viewDirection = new THREE.Vector3(0.7, 0.45, 1).normalize();

camera.position.copy(sphere.center).addScaledVector(viewDirection, distance * 1.2);
camera.near = Math.max(0.05, distance / 100);
camera.far = Math.max(camera.near + 10, distance * 10);
camera.lookAt(sphere.center);
camera.updateProjectionMatrix();
```

Then tune for gameplay: show the player, next decision, threat, reward, and
route. Test narrow/mobile aspect ratios separately. Let one system own camera
pose and interpolation during a state transition; stacked controls, follow lag,
shake, and cutscene tweens create unpredictable framing.

Use [CameraHelper](https://threejs.org/docs/pages/CameraHelper.html) for shadow,
portal, minimap, and secondary-camera debugging. Remove or gate helpers in
production.

## PBR Materials And Environment

Use [MeshStandardMaterial](https://threejs.org/docs/pages/MeshStandardMaterial.html)
for most PBR surfaces. Use
[MeshPhysicalMaterial](https://threejs.org/docs/pages/MeshPhysicalMaterial.html)
only when clearcoat, transmission, sheen, iridescence, or another visible
physical feature earns its cost.

```ts
const paintedMetal = new THREE.MeshPhysicalMaterial({
  color: 0x245ec7,
  metalness: 0,
  roughness: 0.42,
  clearcoat: 0.75,
  clearcoatRoughness: 0.18,
});

const bareMetal = new THREE.MeshStandardMaterial({
  color: 0xaab2bd,
  metalness: 1,
  roughness: 0.36,
});

const rubber = new THREE.MeshStandardMaterial({
  color: 0x090a0d,
  metalness: 0,
  roughness: 0.92,
});
```

Metals require something meaningful to reflect. Load a project-local HDR
environment with the current [HDRLoader](https://threejs.org/docs/pages/HDRLoader.html):

```ts
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

const environment = await new HDRLoader().loadAsync(
  publicAssetUrl('assets/hdr/arena.hdr'),
);
environment.mapping = THREE.EquirectangularReflectionMapping;
scene.environment = environment;
scene.background = environment;
scene.backgroundBlurriness = 0.2;
```

Dispose the environment texture when its scene owner is destroyed. Use
`scene.environmentIntensity`, material `envMapIntensity`, and exposure as
separate controls; document which owner is allowed to tune each.

## Lighting Integration

Start with a small readable stack and inspect it without post-processing. The
official [lights manual](https://threejs.org/manual/en/lights.html) documents
the light families and their costs.

```ts
const skyFill = new THREE.HemisphereLight(0xbad8ff, 0x171a24, 1.1);
scene.add(skyFill);

const key = new THREE.DirectionalLight(0xfff1dc, 3);
key.position.set(8, 12, 6);
key.target.position.set(0, 0, 0);
scene.add(key, key.target);

const rim = new THREE.DirectionalLight(0x70a7ff, 1.5);
rim.position.set(-8, 5, -10);
scene.add(rim);
```

- Use the key to define form and direction.
- Use restrained fill to preserve readable shadow-side detail.
- Use rim/back light or authored emissive trim to separate important actors.
- Prefer emissive surfaces, light cards, or unlit decals over many repeated
  real-time lights.
- Limit shadow-casting lights. A point light shadow renders six directions.
- Profile the densest gameplay state, not an empty lighting test.

## Shadows

Enable current shadow mapping deliberately:

```ts
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;

key.castShadow = true;
key.shadow.mapSize.set(1024, 1024);
key.shadow.camera.near = 1;
key.shadow.camera.far = 40;
key.shadow.camera.left = -12;
key.shadow.camera.right = 12;
key.shadow.camera.top = 12;
key.shadow.camera.bottom = -12;
key.shadow.bias = -0.0002;
key.shadow.normalBias = 0.02;

hero.castShadow = true;
ground.receiveShadow = true;
```

Use `PCFShadowMap`, not deprecated `PCFSoftShadowMap`. Keep the shadow camera
tight, select the smallest map that holds up in the active camera, and inspect
it with `CameraHelper`. For static scenes, set `light.shadow.autoUpdate = false`
after the first render and set `needsUpdate = true` when a caster, receiver, or
light changes. See the official [shadow guide](https://threejs.org/manual/en/shadows.html)
and [LightShadow API](https://threejs.org/docs/pages/LightShadow.html).

Use cheap contact blobs for repeated or hovering objects when a full shadow
pass does not change gameplay understanding.

## Transparency And Layering

Treat transparency as sorted blending, not physical volume by default:

- Prefer opaque or alpha-tested surfaces where possible.
- Set `transparent: true` only when blending is required.
- Use `alphaTest` for foliage/cards with hard-enough cutouts.
- Disable `depthWrite` for selected additive or layered effects only after
  checking intersection artifacts.
- Use `renderOrder` as a narrow fix, not a substitute for correct depth and
  material grouping.
- Keep gameplay-critical silhouettes readable without transparent overlap.
- Reserve `MeshPhysicalMaterial.transmission` for a few hero surfaces; it adds
  extra rendering cost and can hide hazards behind refraction.

Inspect front/back side requirements. `DoubleSide` costs more and changes
raycasting/shading behavior; fix mesh winding or author thickness when possible.

## WebGL Post-Processing

Use `EffectComposer` only with `WebGLRenderer`. Start with a render pass and end
with `OutputPass`, which performs output color conversion and configured tone
mapping. Follow the official
[WebGL post-processing guide](https://threejs.org/manual/en/how-to-use-post-processing.html).

```ts
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const composerTarget = new THREE.WebGLRenderTarget(1, 1, {
  type: THREE.HalfFloatType,
  // Context antialiasing does not antialias this offscreen beauty target.
  samples: Math.min(4, renderer.capabilities.maxSamples),
});
const composer = new EffectComposer(renderer, composerTarget);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);

const bloom = new UnrealBloomPass(
  new THREE.Vector2(1, 1),
  0.45,
  0.3,
  0.9,
);
composer.addPass(bloom);
const outputPass = new OutputPass();
composer.addPass(outputPass);

renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const delta = Math.min(timer.getDelta(), 0.1);
  update(delta);
  resizeFrame(renderer, camera, composer);
  composer.render(delta);
});

function disposePost() {
  renderer.setAnimationLoop(null);
  outputPass.dispose();
  bloom.dispose();
  renderPass.dispose();
  // Owns composerTarget and its internal clone.
  composer.dispose();
}
```

Keep bloom threshold high enough that authored emissive cues contribute and
ordinary white surfaces do not wash out the frame. Measure every full-screen
pass at the actual drawing-buffer resolution. Provide low-quality and no-post
paths when the target device tier needs them.

When this composer is always active, construct the canvas renderer with
`antialias: false`; its default-framebuffer MSAA does not help the offscreen
composer target. Measure multisampled-target cost, or use a compatible
post-process AA pass in the correct order when MSAA is too expensive. Retain
and dispose every pass: `EffectComposer.dispose()` releases its ping-pong
targets and internal copy pass, not arbitrary passes added by the application.

## WebGPU Post-Processing

Do not use `EffectComposer` or GLSL passes with `WebGPURenderer`. Import the
renderer family and TSL separately, then build a current
[RenderPipeline](https://threejs.org/docs/pages/RenderPipeline.html):

```ts
import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';

const renderer = new THREE.WebGPURenderer({ antialias: true });
await renderer.init();
const pipeline = new THREE.RenderPipeline(renderer);
const scenePass = pass(scene, camera);

pipeline.outputNode = scenePass;

await renderer.setAnimationLoop(() => {
  if (renderer.xr.isPresenting) {
    renderer.render(scene, camera);
  } else {
    pipeline.render();
  }
});
```

This r185 branch is required for an XR-capable game: `RenderPipeline.render()`
temporarily disables XR while it owns rendering. Treat node post-processing as
a desktop/non-XR path, render the scene directly while `xr.isPresenting`, and
tell the player that those effects are disabled in-headset. Only use a
different XR post path after exact-version, on-device verification.

`RenderPipeline` applies tone mapping and output color conversion by default.
If an effect such as FXAA specifically needs display-referred input, use
[`renderOutput`](https://threejs.org/docs/pages/RenderOutputNode.html) at that
point and set `pipeline.outputColorTransform = false` so conversion occurs only
once.

The old WebGPU `PostProcessing` wrapper is deprecated since r183. Do not emit
it. Keep WebGPU examples behind an explicit renderer choice and verify both the
WebGPU backend and `forceWebGL: true` fallback when fallback support is claimed.

## Diagnostics

Inspect [renderer.info](https://threejs.org/docs/pages/WebGLRenderer.html) in a
repeatable worst-case scene:

```ts
function readRendererStats(renderer: THREE.WebGLRenderer) {
  const { render, memory, programs } = renderer.info;

  return {
    calls: render.calls,
    triangles: render.triangles,
    lines: render.lines,
    points: render.points,
    geometries: memory.geometries,
    textures: memory.textures,
    programs: programs?.length ?? 0,
  };
}
```

For multi-pass manual rendering, `renderer.info` can auto-reset before each
render. Set `renderer.info.autoReset = false`, reset once at the start of the
measured frame, and call `renderer.info.reset()` after collecting the whole
frame if aggregate numbers are required.

Also record:

- Canvas CSS size, drawing-buffer size, DPR, renderer, and backend.
- Tone mapper, exposure, shadow type/maps/casters, and post pass count.
- CPU frame time and GPU timing from browser profiling tools.
- Active meshes, visible materials, lights, transparent objects, particles,
  skinned meshes, morph targets, render targets, and local asset sizes.
- Console shader/link errors and WebGPU validation errors.

Use `await renderer.compileAsync(scene, camera)` after required local assets are
ready when a measured first-use shader hitch warrants precompilation. Do not
compile every speculative material variant.

Test context loss deliberately in a diagnostic route, stop simulation while
the context is unavailable, and verify resources recover or the game presents
a clear restart path. Do not use `forceContextLoss()` as ordinary cleanup.

```ts
const onContextLost = (event: Event) => {
  event.preventDefault();
  loop.stop();
  input.suspend();
  void audio.suspend();
  showRendererStatus('Graphics lost; recovery is in progress.');
};

const onContextRestored = () => {
  hideRendererStatus();
  loop.start(); // resets Timer/accumulator in the loop owner
  void audio.resume();
};

renderer.domElement.addEventListener('webglcontextlost', onContextLost);
renderer.domElement.addEventListener('webglcontextrestored', onContextRestored);

function removeContextLifecycle() {
  renderer.domElement.removeEventListener('webglcontextlost', onContextLost);
  renderer.domElement.removeEventListener(
    'webglcontextrestored',
    onContextRestored,
  );
}
```

The renderer recreates its internal WebGL state on restoration; the application
still owns simulation timing, held input, audio, loading/UI state, and the
choice to resume versus show a full restart. Test this path after local assets,
post targets, shadows, and dynamic resources have been created.

## Rendering QA

Before accepting a rendering change, prove:

- Color textures and data textures use the correct color-space annotations.
- Tone mapping and output conversion occur exactly once.
- The hero, threats, rewards, and route remain readable with post disabled.
- Camera near/far planes, FOV, aspect changes, and narrow/mobile framing work.
- Shadow acne, peter-panning, clipping, map boundaries, and moving casters are
  checked in active play.
- Transparent effects do not reorder unpredictably or hide collision reads.
- The measured worst case meets the target frame and memory budget.
- Resize does not allocate new render targets every frame.
- Repeated scene entry/exit returns renderer memory to its steady baseline.
- The production preview loads every runtime resource locally with no outbound
  requests, blank frames, console errors, or shader warnings.

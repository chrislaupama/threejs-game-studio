# Rendering, Cameras, Lighting, And Post (r185 Verified Baseline)

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

For a graphics-heavy or compute-heavy 3D site/game, present the experimental
[WebGPURenderer](https://threejs.org/docs/pages/WebGPURenderer.html) as a
first-class candidate and evaluate it when the project benefits
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
| GPU compute, TSL-first materials/node post, or a measured many-point-light case suited to clustered lighting | Offer experimental `WebGPURenderer`, then benchmark it against the mature path |
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
hard bridge constraints for r185, not promises about r186+. Re-read the
matching implementation and rerun fallback tests on every Three.js upgrade.

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
AR camera passthrough is another intentional transparent-output exception; its
session path must not install an opaque scene background.

`outputBufferType` defaults to `UnsignedByteType`. Keep that direct-display
default when the path does not need an HDR intermediate. Request
`HalfFloatType` when renderer-owned HDR effects/tone-mapped post require the
extra range, and measure bandwidth and compatibility; a custom composer render
target owns its own type separately.

For genuinely extreme WebGL depth ranges, evaluate `reversedDepthBuffer: true`
before `logarithmicDepthBuffer`. Reversed depth is faster and more accurate when
`EXT_clip_control` is present; verify
`renderer.capabilities.reversedDepthBuffer`, retain a fallback, and still keep
camera near/far tight. Either constructor choice requires rebuilding the
renderer.

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

const RENDER_TIERS = {
  desktop: { dprCap: 1.75, maxPixels: 2_073_600 }, // about 1920x1080
  mobile: { dprCap: 1.25, maxPixels: 1_100_000 },
  constrained: { dprCap: 1, maxPixels: 786_432 }, // about 1024x768
} as const;

type RenderTier = keyof typeof RENDER_TIERS;

function resizeFrame(
  renderer: THREE.WebGLRenderer,
  camera: THREE.PerspectiveCamera,
  tier: RenderTier,
  composer?: EffectComposer,
) {
  const canvas = renderer.domElement;
  const width = Math.max(1, canvas.clientWidth);
  const height = Math.max(1, canvas.clientHeight);
  const budget = RENDER_TIERS[tier];
  const requestedDpr = Math.min(window.devicePixelRatio || 1, budget.dprCap);
  const budgetDpr = Math.sqrt(budget.maxPixels / (width * height));
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

The numbers above match the starting budget bands in `technical-art.md`; tune
them from measurements on the declared support matrix. Select the initial tier
from product configuration or a conservative default, then adapt with measured
frame-time hysteresis. Do not infer capability from a device name or reuse the
desktop pixel cap for mobile. Report the selected tier, cap, actual DPR, and
`renderer.getDrawingBufferSize()` result after resize.

If post-processing renders the final image, call only `composer.render()` or
`renderPipeline.render()` for that frame. Do not also call
`renderer.render(scene, camera)` and accidentally render twice.

Apply tone mapping and output color conversion exactly once. For WebGL
`EffectComposer`, place linear/HDR effects before `OutputPass`; a pass requiring
display-referred sRGB input, such as FXAA, must follow `OutputPass`. For WebGPU
`RenderPipeline`, keep its automatic output transform enabled unless a specific
effect requires an earlier `renderOutput()` node.

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
and custom tone mapping. ACES below is a skill scaffold recommendation, not an
official universal game default; compare captures at fixed exposure.

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

Do not rely on `material.toneMapped = false` to protect in-scene HUD or authored
white values when rendering into a post target or with `WebGPURenderer`; the
official material API says that flag is ignored on those paths. Composite
display-referred UI after the output transform when the pipeline supports it,
use a DOM overlay, or author the element for the chosen output chain.

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

Background presentation and image-based lighting can be tuned independently:

```ts
scene.backgroundIntensity = 0.8;
scene.backgroundRotation.set(0, Math.PI * 0.15, 0);
scene.environmentIntensity = 1.1;
scene.environmentRotation.set(0, Math.PI * 0.35, 0);
```

Keep their rotations aligned when the visible light source must match the
reflections; separate them only as an intentional art-direction choice.

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
key.shadow.camera.updateProjectionMatrix();
key.shadow.bias = -0.0002;
key.shadow.normalBias = 0.02;

hero.castShadow = true;
ground.receiveShadow = true;
```

On verified-r185 `WebGLRenderer`, use soft `PCFShadowMap`, not deprecated
`PCFSoftShadowMap`. r185 WebGPU still exposes the soft constant, but the
current untagged 185→186 notes say it will be removed there too. Treat that as
upgrade-preview information and verify the installed revision. Keep the
shadow camera tight, select the smallest map that holds up, and inspect
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
- Evaluate `alphaHash` when sorted blending artifacts are worse than stochastic
  grain; temporal antialiasing can smooth the pattern.
- With an MSAA target, `alphaToCoverage` can soften `alphaTest`/clip edges.
- Disable `depthWrite` for selected additive or layered effects only after
  checking intersection artifacts.
- Use `renderOrder` as a narrow fix, not a substitute for correct depth and
  material grouping.
- Keep gameplay-critical silhouettes readable without transparent overlap.
- Reserve `MeshPhysicalMaterial.transmission` for a few hero surfaces; it adds
  extra rendering cost and can hide hazards behind refraction. On WebGL, test a
  lower `renderer.transmissionResolutionScale` as a measured quality tier.

Inspect front/back side requirements. `DoubleSide` costs more and changes
raycasting/shading behavior; fix mesh winding or author thickness when possible.
Double-sided transparent materials normally render back and front in two draw
calls; `forceSinglePass` can halve that cost for flat vegetation-like objects
only when visual comparison shows no ordering regression.

## WebGL Post-Processing

Use `EffectComposer` only with `WebGLRenderer`. Start with a render pass, keep
linear/HDR effects before `OutputPass`, and place any effect that requires sRGB
input after it. `OutputPass` performs output color conversion and configured
tone mapping. Follow the official
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
// If used: composer.addPass(fxaaPass); // FXAA requires sRGB input, so it follows OutputPass.
const renderTier: RenderTier = matchMedia('(pointer: coarse)').matches
  ? 'mobile'
  : 'desktop';

renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const delta = Math.min(timer.getDelta(), 0.1);
  update(delta);
  resizeFrame(renderer, camera, renderTier, composer);
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

`OutputPass` reads `renderer.toneMapping`, `toneMappingExposure`, and
`outputColorSpace`; keep those renderer settings as configuration and do not add
a second output transform. If FXAA is present, update its inverse-resolution
uniform from the actual drawing-buffer size in the resize owner.

When this composer is always active, construct the canvas renderer with
`antialias: false`; its default-framebuffer MSAA does not help the offscreen
composer target. Measure multisampled-target cost, or use a compatible
post-process AA pass in the correct order when MSAA is too expensive. Retain
and dispose every pass: `EffectComposer.dispose()` releases its ping-pong
targets and internal copy pass, not arbitrary passes added by the application.

## WebGPU Post-Processing

Do not use `EffectComposer` or GLSL passes with `WebGPURenderer`. Import the
renderer family and TSL separately, then build a current
[RenderPipeline](https://threejs.org/docs/pages/RenderPipeline.html). Read the
official [WebGPU post-processing guide](https://threejs.org/manual/en/webgpu-postprocessing)
for effect composition, output transforms, and MRT precision:

```ts
import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';

const renderer = new THREE.WebGPURenderer({ antialias: true, alpha: false });
// XRManager selection happens during initialization, so enable XR first when
// this renderer may enter an immersive session.
renderer.xr.enabled = true;
await renderer.init();
const pipeline = new THREE.RenderPipeline(renderer);

type OwnedOutputGraph = {
  node: THREE.Node;
  dispose(): void;
};

function createSceneOutputGraph(): OwnedOutputGraph {
  const scenePass = pass(scene, camera);
  return {
    node: scenePass,
    dispose: () => scenePass.dispose(),
  };
}

let activeOutputGraph = createSceneOutputGraph();

pipeline.outputNode = activeOutputGraph.node;
pipeline.needsUpdate = true;

const renderFrame = () => {
  if (renderer.xr.isPresenting) {
    renderer.render(scene, camera);
  } else {
    pipeline.render();
  }
};

await renderer.setAnimationLoop(renderFrame);

async function replacePipelineOutput(
  next: OwnedOutputGraph,
  restartLoop: boolean,
): Promise<void> {
  if (renderer.xr.getSession()) {
    throw new Error('Defer post graph replacement until the XR session ends');
  }

  // The lifecycle owner serializes swaps and decides whether the loop resumes.
  await renderer.setAnimationLoop(null);
  const retired = activeOutputGraph;
  activeOutputGraph = next; // ownership transfers before the old graph retires
  pipeline.outputNode = next.node;
  pipeline.needsUpdate = true;
  retired.dispose();
  if (restartLoop) await renderer.setAnimationLoop(renderFrame);
}

async function disposePost() {
  const session = renderer.xr.getSession();
  if (session) await session.end();
  await renderer.setAnimationLoop(null);
  activeOutputGraph.dispose();
  pipeline.dispose();
}
```

This branch is required for an XR-capable game: `RenderPipeline.render()`
temporarily disables XR while it owns rendering. Treat node post-processing as
a desktop/non-XR path, render the scene directly while `xr.isPresenting`, and
tell the player that those effects are disabled in-headset. Only use a
different XR post path after on-device verification for the installed revision.

`RenderPipeline` applies tone mapping and output color conversion by default.
If an effect such as FXAA specifically needs display-referred input, use
[`renderOutput`](https://threejs.org/docs/pages/RenderOutputNode.html) at that
point and set `pipeline.outputColorTransform = false` so conversion occurs only
once.

Whenever runtime quality settings replace `pipeline.outputNode`, stop the loop
and let its lifecycle owner transfer the next graph into `activeOutputGraph`, set
`pipeline.needsUpdate = true`, and dispose the retired graph before rendering
again. The replacement must exclusively own its target-owning nodes; do not
silently share a `PassNode` or effect target with the retired graph. Rebuild after
changing the output-transform topology as well. On final teardown, end an active
XR session before clearing the loop, then dispose the active graph and pipeline.

The old WebGPU `PostProcessing` wrapper is deprecated since r183. Do not emit
it. Keep WebGPU examples behind an explicit renderer choice and verify both the
WebGPU backend and `forceWebGL: true` fallback when fallback support is claimed.

## Diagnostics

The WebGL and common/WebGPU `renderer.info` schemas are different. Do not share
one untyped metric reader across renderer families.

### WebGLRenderer

Inspect [WebGL renderer info](https://threejs.org/docs/pages/WebGLRenderer.html)
in a repeatable worst-case scene:

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

### WebGPURenderer and its WebGL backend

The common [Info API](https://threejs.org/docs/pages/Info.html) separates render
invocations from draw calls and tracks compute plus resource byte sizes:

```ts
function readWebGpuStats(renderer: THREE.WebGPURenderer) {
  const { render, compute, memory } = renderer.info;

  return {
    renderCalls: render.frameCalls,
    drawCalls: render.drawCalls,
    triangles: render.triangles,
    computeCalls: compute.frameCalls,
    textures: memory.textures,
    renderTargets: memory.renderTargets,
    programs: memory.programs,
    trackedBytes: memory.total,
  };
}
```

Record the actual native-WebGPU or WebGL backend separately. See `webgpu.md`
for backend detection, timestamps, and the full common-info profile.

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
compile every speculative material variant. On the r185 WebGL node-material
migration bridge, `WebGLNodesHandler` does not support `compile()`;
`compileAsync()` delegates to that path and is unsupported too. Warm that bridge
only through measured representative renders.

### WebGL context loss

Test context loss deliberately in a diagnostic route, stop simulation while
the context is unavailable, and verify resources recover or the game presents
a clear restart path. Do not use `forceContextLoss()` as ordinary cleanup.

```ts
const onContextLost = (event: Event) => {
  event.preventDefault();
  lifecycle.suspendForGraphicsLoss({
    stopLoop: () => loop.stop(),
    suspendInput: () => input.suspend(),
    suspendAudio: () => void audio.suspend(),
  });
  showRendererStatus('Graphics lost; recovery is in progress.');
};

const onContextRestored = () => {
  hideRendererStatus();
  lifecycle.restoreFromGraphicsLoss({
    // The lifecycle owner restores the current phase's input map and resets
    // input edges before it invokes restartLoop.
    resumeInput: () => input.resume(),
    resumeAudio: () => void audio.resume(),
    restartLoop: () => loop.start(), // resets Timer/accumulator in loop owner
  });
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
choice to resume versus show a full restart. `restoreFromGraphicsLoss()` must
consult the canonical phase and the pre-loss loop state, call `resumeInput`
before `restartLoop`, and skip both callbacks when the current phase disallows
them. Do not restart directly from the DOM event. Test this path after local
assets, post targets, shadows, and dynamic resources have been created.

### WebGPU backend errors and device loss

The common [Renderer API](https://threejs.org/docs/pages/Renderer.html) exposes
`onError` for uncaptured validation, out-of-memory, and internal backend errors,
and `onDeviceLost` when rendering cannot continue. Override both before
initialization so failures reach the player-facing shell:

```ts
renderer.onError = (error) => {
  console.error('Graphics backend error', error);
  showRendererStatus('A graphics error occurred; reducing quality may help.');
};

const defaultDeviceLost = renderer.onDeviceLost.bind(renderer);
renderer.onDeviceLost = (info) => {
  // Preserve the renderer's own device-lost state before app-level handling.
  defaultDeviceLost(info);
  console.error('Graphics device lost', info);
  void renderer.setAnimationLoop(null);
  input.suspend();
  void audio.suspend();
  showRendererStatus('Graphics stopped; reload to restart safely.');
};
```

An uncaptured error need not become a device loss when the app surfaces it.
Once device loss occurs, do not promise transparent recovery: stop simulation,
preserve recoverable game state, and offer a tested renderer rebuild or reload.
Exercise native WebGPU and forced-WebGL backend failure policies separately.

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

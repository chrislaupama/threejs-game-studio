# Official Three.js Guidance (r185 Verified Baseline)

## Contents

- Version and source policy
- Local-first installation and imports
- Official source map
- Renderer compatibility boundary
- WebGPU alpha and tone-mapping defaults
- Verified-baseline stale-API denylist
- Stable-versus-next-release watchlist
- Documentation and example verification procedure

Use this reference before writing version-sensitive Three.js code. Treat the
live documentation as the discovery surface and the installed package plus the
matching release tag as the implementation contract.

## Version And Source Policy

Recipes are **verified against Three.js r185 / npm `three@0.185.1`**, not
guaranteed unchanged for every later release. Greenfield installs should check
and use the current stable package. Preserve an existing project's locked
version unless an upgrade is part of the request; read every intervening
section of the
[official migration guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide)
before changing it, and verify APIs against the installed revision.

Use this authority order when sources disagree:

1. Inspect the project's installed `three/package.json`, lockfile, runtime
   exports, and source. Runtime exports/source win for existence and behavior.
2. Inspect the matching source tag (for example
   [r185](https://github.com/mrdoob/three.js/tree/r185) or the installed
   revision's tag) and its examples for implementation-sensitive behavior.
3. Use the [live API docs](https://threejs.org/docs/) and
   [manual](https://threejs.org/manual/) for current intent and concepts.
4. Use official release notes and the migration guide for revision changes.
5. Use official examples as executable patterns, then adapt them to local
   modules, ownership, resize, failure, and teardown.
6. Inspect the separately installed `@types/three` version and declarations as
   compile-contract evidence. Three.js does not bundle declarations; the
   official installation guide identifies them as community-maintained. Align
   their revision with the runtime and document any mismatch; do not let types
   overrule runtime behavior.

Some live doc examples still show deprecated APIs. The installed package and the
denylist below win over stale examples.

**Last verified against (informational, not a pin):** npm `three@0.185.1`
(REVISION `185`), 2026-07-17. When npm or live docs move past that check, re-run
`npm ls three`, `THREE.REVISION`, and the skill's bounded `probe:three`, then
reconcile via the migration guide before treating skill recipes as current.

At discovery, compare the npm result from `probe:three` with the installed
revision. Its npm lookup times out after 20 seconds; an unavailable lookup is an
explicit offline result, not evidence that the verified baseline is still
latest. Record the installed target, offline status, and skill last-check note.

## Local-First Installation And Imports

Install dependencies at build time and serve all game code and assets locally:

```bash
npm install three
npm install --save-dev @types/three vite typescript
npm ls three @types/three
```

Confirm the runtime and type-package revisions intentionally align. For a
verified-baseline scaffold, use matching r185 packages; for a newly generated
game, resolve current stable versions together and record them in the lockfile.
Do not let an unconstrained latest `@types/three` describe an older preserved
runtime.

Use ES modules and the package export map:

```ts
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
```

For the WebGPU renderer family, switch the core import and add TSL explicitly:

```ts
import * as THREE from 'three/webgpu';
import { pass, texture, uniform, uv } from 'three/tsl';
```

Follow the official [installation guide](https://threejs.org/manual/en/installation.html),
but do not use its CDN option in generated games. Do not add import-map URLs,
remote decoder paths, remote fonts, hosted examples, or runtime network
fallbacks. Copy required decoder/transcoder support files into the project and
load project-relative URLs. Official links in this document are research
citations, not runtime dependencies.

## Official Source Map

### Foundation

- [Creating a scene](https://threejs.org/manual/en/creating-a-scene.html)
- [Fundamentals](https://threejs.org/manual/en/fundamentals.html)
- [Scene graph](https://threejs.org/manual/en/scenegraph.html)
- [Object3D](https://threejs.org/docs/pages/Object3D.html)
- [PerspectiveCamera](https://threejs.org/docs/pages/PerspectiveCamera.html)
- [OrthographicCamera](https://threejs.org/docs/pages/OrthographicCamera.html)
- [Timer](https://threejs.org/docs/pages/Timer.html)
- [Responsive rendering](https://threejs.org/manual/en/responsive.html)

### Renderers, Color, And Materials

- [WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html)
- [WebGPURenderer guide](https://threejs.org/manual/en/webgpurenderer)
- [WebGPURenderer API](https://threejs.org/docs/pages/WebGPURenderer.html)
- [Renderer base API](https://threejs.org/docs/pages/Renderer.html)
- [WebGPU renderer statistics](https://threejs.org/docs/pages/Info.html)
- [ClusteredLighting](https://threejs.org/docs/pages/ClusteredLighting.html)
- [Color management](https://threejs.org/manual/en/color-management.html)
- [Texture](https://threejs.org/docs/pages/Texture.html)
- [Materials](https://threejs.org/manual/en/materials.html)
- [MeshStandardMaterial](https://threejs.org/docs/pages/MeshStandardMaterial.html)
- [MeshPhysicalMaterial](https://threejs.org/docs/pages/MeshPhysicalMaterial.html)
- [Lights](https://threejs.org/manual/en/lights.html)
- [Shadows](https://threejs.org/manual/en/shadows.html)
- [LightShadow](https://threejs.org/docs/pages/LightShadow.html)

### Assets And Animation

- [Loading 3D models](https://threejs.org/manual/en/loading-3d-models.html)
- [GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html)
- [DRACOLoader](https://threejs.org/docs/pages/DRACOLoader.html)
- [KTX2Loader](https://threejs.org/docs/pages/KTX2Loader.html)
- [HDRLoader](https://threejs.org/docs/pages/HDRLoader.html)
- [LoadingManager](https://threejs.org/docs/pages/LoadingManager.html)
- [Animation system](https://threejs.org/manual/en/animation-system.html)
- [AnimationMixer](https://threejs.org/docs/pages/AnimationMixer.html)
- [AnimationAction](https://threejs.org/docs/pages/AnimationAction.html)

### Input, Scale, And Performance

- [OrbitControls](https://threejs.org/docs/pages/OrbitControls.html)
- [PointerLockControls](https://threejs.org/docs/pages/PointerLockControls.html)
- [Raycaster](https://threejs.org/docs/pages/Raycaster.html)
- [Picking](https://threejs.org/manual/en/picking.html)
- [InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html)
- [BatchedMesh](https://threejs.org/docs/pages/BatchedMesh.html)
- [LOD](https://threejs.org/docs/pages/LOD.html)
- [Optimizing many objects](https://threejs.org/manual/en/optimize-lots-of-objects.html)
- [Cleanup](https://threejs.org/manual/en/cleanup.html)
- [Disposal](https://threejs.org/manual/en/how-to-dispose-of-objects.html)

### Shaders And Post-Processing

- [ShaderMaterial](https://threejs.org/docs/pages/ShaderMaterial.html)
- [RawShaderMaterial](https://threejs.org/docs/pages/RawShaderMaterial.html)
- [Material.onBeforeCompile](https://threejs.org/docs/pages/Material.html)
- [TSL specification](https://threejs.org/docs/TSL.html)
- [MeshStandardNodeMaterial](https://threejs.org/docs/pages/MeshStandardNodeMaterial.html)
- [WebGL post-processing](https://threejs.org/manual/en/how-to-use-post-processing.html)
- [WebGPU post-processing](https://threejs.org/manual/en/webgpu-postprocessing)
- [RenderPipeline](https://threejs.org/docs/pages/RenderPipeline.html)
- [RenderOutputNode](https://threejs.org/docs/pages/RenderOutputNode.html)

### Overlays And Helpers

- [CSS2DRenderer](https://threejs.org/docs/pages/CSS2DRenderer.html)
- [CSS3DRenderer](https://threejs.org/docs/pages/CSS3DRenderer.html)
- [TransformControls](https://threejs.org/docs/pages/TransformControls.html)

### WebXR

- [WebXR basics](https://threejs.org/manual/en/webxr-basics.html)
- [WebXRManager](https://threejs.org/docs/pages/WebXRManager.html)
- [VRButton](https://threejs.org/docs/pages/VRButton.html)
- [ARButton](https://threejs.org/docs/pages/ARButton.html)
- [Raycaster.setFromXRController](https://threejs.org/docs/pages/Raycaster.html)

## Renderer Compatibility Boundary

Choose the renderer before choosing custom-material or post-processing APIs.

| Requirement | `WebGLRenderer` | `WebGPURenderer` |
| --- | --- | --- |
| Status | Maintained production WebGL 2 path | Experimental next-generation renderer |
| Core import | `three` | `three/webgpu` |
| Backend | WebGL 2; WebGL 1 is unsupported | WebGPU with WebGL 2 fallback |
| Custom material | GLSL `ShaderMaterial`, `RawShaderMaterial`, or fragile `onBeforeCompile` | Node materials and TSL |
| Post-processing | `EffectComposer` and addon passes | `RenderPipeline` and TSL nodes |
| Initialization | Synchronous | Use `setAnimationLoop()` or `await renderer.init()` |

Modern releases also expose a deliberately limited migration bridge on the
separate `WebGLRenderer` path: install `WebGLNodesHandler` with
`setNodesHandler()` for supported node materials, and use `setEffects()` for
supported effects. This does not add `RenderPipeline` support to
`WebGLRenderer`, does not relax the WebGPURenderer restrictions, and must be
checked feature-by-feature. See the current
[WebGLRenderer API](https://threejs.org/docs/pages/WebGLRenderer.html) and
`rendering.md` for the exact setup.

Default to `WebGLRenderer` for compatibility with existing GLSL, addons, broad
production history, and uncomplicated beginner work. For a graphics-heavy or
compute-heavy 3D experience, offer the experimental `WebGPURenderer` as a
first-class candidate when TSL, GPU compute, node post-processing, many-light
rendering, or another measured WebGPU benefit matches the target browsers. Do
not promise it will be
faster: the official
[WebGPURenderer guide](https://threejs.org/manual/en/webgpurenderer) marks it
experimental and notes that some applications still perform better with
`WebGLRenderer`.

Before the choice is accepted, explain that `WebGPURenderer` can fall back to
its own WebGL 2 backend only for a renderer path already built with compatible
node materials and TSL. That fallback does not make GLSL `ShaderMaterial`,
`onBeforeCompile()`, or `EffectComposer` compatible. Test and report the actual
backend after `await renderer.init()`.

Do not combine imports or recipes from both columns in one renderer path except
for that documented WebGL-only migration bridge.

## WebGPU Alpha And Tone-Mapping Defaults

`WebGPURenderer` documentation historically defaults `alpha: true`. Games should
override to opaque unless HTML compositing or AR camera passthrough is required:

```ts
import * as THREE from 'three/webgpu';

const renderer = new THREE.WebGPURenderer({
  canvas,
  antialias: true,
  alpha: false,
});
renderer.setClearColor(0x0b1020, 1);
scene.background = new THREE.Color(0x0b1020);

renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
```

Premultiplied-alpha compositing at the verified r185 baseline is easy to get
wrong when the canvas is transparent over a page background. Prefer opaque `alpha: false`
plus an opaque `Scene.background` / `setClearColor` for full-viewport games.
AR camera passthrough is an intentional transparent-output exception.

Skill recommendation: choose an intentional `ACESFilmicToneMapping`,
`AgXToneMapping`, or `NeutralToneMapping` look for lit PBR and validate it with
captures. The official API does not prescribe one universal game default. See
`tone-mapping-color.md`.

SVG shapes: prefer `shapePath.toShapes()` over the deprecated
`SVGLoader.createShapes()` helper. Some live doc examples may still show the
plural migration-wiki wording; installed source and this denylist are more
precise.

## Verified-Baseline Stale-API Denylist

Reject or rewrite these patterns during planning, implementation, and review.
Confirm the changes against the [migration guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide)
and the installed revision. Prefer current names; do not treat this table as
locked to a single patch string.

| Reject | Use at the verified r185 baseline |
| --- | --- |
| Global `THREE` scripts, `examples/js/*`, `build/three.js`, `three.min.js` | ES modules from `three`, `three/webgpu`, `three/tsl`, and `three/addons/*` |
| WebGL 1 compatibility code | WebGL 2 through `WebGLRenderer` |
| `THREE.Clock` | `THREE.Timer`; call `update(timestamp)` once per frame |
| Manual `requestAnimationFrame()` used without a renderer-family plan | Prefer `renderer.setAnimationLoop()`; WebXR requires the renderer-owned loop, while manual WebGPU loops must first `await renderer.init()` |
| `renderer.outputEncoding` | `renderer.outputColorSpace` |
| `texture.encoding` | `texture.colorSpace` |
| `sRGBEncoding`, `LinearEncoding`, gamma flags | `SRGBColorSpace`, `LinearSRGBColorSpace`, or `NoColorSpace` |
| `physicallyCorrectLights` or `useLegacyLights` | Remove; use current light behavior and retune intensities |
| Deprecated `RGBELoader` alias | `HDRLoader` |
| `PCFSoftShadowMap` on verified-r185 `WebGLRenderer` (deprecated; substituted with soft PCF) | `PCFShadowMap`; r185 WebGPU still exposes the soft constant, while untagged next-revision migration notes say it will be removed there too |
| `mergeBufferGeometries()` | `mergeGeometries()` |
| `PointerLockControls.getObject()` | `controls.object` |
| WebGPU `ShaderMaterial`, `RawShaderMaterial`, or `onBeforeCompile()` | Node materials and TSL |
| WebGPU `EffectComposer` | `RenderPipeline` |
| WebGPU `PostProcessing` wrapper | `RenderPipeline`; the wrapper is deprecated since r183 |
| `Renderer.renderAsync()`, async clear methods, `hasFeatureAsync()`, or `initTextureAsync()` | Initialize once, then use `render()`, `clear()`, `hasFeature()`, or `initTexture()` |
| Treating every async Renderer method as deprecated | `computeAsync()`, `compileAsync()`, readback methods, and `resolveTimestampsAsync()` remain current; verify each method individually against the installed revision |
| `WebGPURenderer.waitForGPU()` | Remove; profile with browser GPU tools and current renderer APIs |
| `RenderPipeline.renderAsync()` or `QuadMesh.renderAsync()` | Initialize the renderer, then use `render()` |
| `KTX2Loader.detectSupportAsync()` | Initialize the renderer, then call `detectSupport(renderer)` |
| `DRACOLoader.setDecoderConfig()` | Remove; deprecated in r185 |
| `DRACOExporter.parse()` | `await exporter.parseAsync()`; the sync method is a throwing compatibility stub |
| `SVGLoader.createShapes()` | Call `shapePath.toShapes()` |
| `USDZLoader` | `USDLoader` |
| `VTKLoader` or `LWOLoader` in new web content | Convert the source asset to glTF and load it with `GLTFLoader` |
| `LottieLoader` | Use `lottie-web` to create the animated texture only when that external dependency is explicitly approved; otherwise use local video/sprites/procedural animation |
| `PMREMGenerator.fromSceneAsync()`, `fromEquirectangularAsync()`, or `fromCubemapAsync()` | Initialize `WebGPURenderer`, then call the synchronous PMREM method |
| `FirstPersonControls.handleResize()` | Remove; current controls handle resize internally |
| Removed `SceneUtils.attach(child, scene, parent)` / `detach(child, parent, scene)` | `parent.attach(child)` / `scene.attach(child)` |
| `Box2.empty()` / `Sphere.empty()` | `isEmpty()` |
| `Box2.isIntersectionBox()`, `Ray.isIntersectionBox/Plane/Sphere()`, or `Plane.isIntersectionLine()` | Matching `intersectsBox/Plane/Sphere/Line()` method |
| `VOXMesh` / `VOXData3DTexture` | `buildMesh()` / `buildData3DTexture()` |
| `AnamorphicNode` | Use the current bloom node path where the visual requirement fits |
| `TiledLighting` | `ClusteredLighting` |
| `directionToColor()` / `colorToDirection()` | `packNormalToRGB()` / `unpackRGBToNormal()` |
| TSL `directionToFaceDirection()` | `negateOnBackSide()` |
| TSL `addNodeElement()` | Remove; import/export node elements directly so bundlers can tree-shake |
| GLSL `inverseTransformDirection` chunk helper | `transformDirectionByInverseViewMatrix` for directions, or `transformNormalByInverseViewMatrix` for normals |
| TSL `PI2` | `TWO_PI` |
| TSL `transformedNormalView` / `transformedNormalWorld` | `normalView` / `normalWorld` |
| TSL `transformedClearcoatNormalView` | `clearcoatNormalView` |
| TSL `label()` | `setName()` |
| TSL `cache(node)` | `isolate(node)`; preserve old `cache(node, false)` semantics with `isolate(node).setParent(false)` |
| Standalone TSL `append(node)` | `Stack(node)` |
| Chained TSL `node.append()` | `node.toStack()` |
| TSL `rangeFog()` / `densityFog()` | `fog()` with `rangeFogFactor()` / `densityFogFactor()` |
| TSL `viewportResolution` | `screenSize` |
| `PassNode.setResolution()` / `getResolution()` | `setResolutionScale()` / `getResolutionScale()` |
| `ReflectorNode.resolution` or `GaussianBlurNode.resolution` | `resolutionScale` |
| `premultipliedGaussianBlur()` | `gaussianBlur()` with `{ premultipliedAlpha: true }` |
| `Line2NodeMaterial.lineColorNode` | `colorNode` |
| `ColorManagement.fromWorkingColorSpace()` / `toWorkingColorSpace()` | `workingToColorSpace()` / `colorSpaceToWorking()` |
| `Matrix3.scale()` / `rotate()` / `translate()` | Rewrite composition deliberately; `make*()` overwrites the matrix and is not a mechanical replacement (see below) |
| `WebGLCubeRenderTarget` with `WebGPURenderer` | `CubeRenderTarget` |
| `SkyMesh.isSky` | `SkyMesh.isSkyMesh`; the separate legacy `Sky` addon still has a current `isSky` flag |
| Assuming `FileLoader.load()` or `ImageBitmapLoader.load()` returns a request | Use callbacks or supported `loadAsync()` flows |
| Manual +Z-up correction for every FBX | Inspect first; current `FBXLoader` converts +Z-up files to +Y-up |
| `Raycaster.firstHitOnly` presented as core | Mark it as third-party acceleration behavior |
| `SceneOptimizer` presented as stable or complete | Mark it experimental; measure explicit instancing/batching first |

## r185 Semantic Upgrade Notes

These r184→r185 changes require behavior checks, not only symbol replacement.
Use the matching official examples and source for any affected subsystem.

### Matrix3 composition

Deprecated `Matrix3.scale()`, `rotate()`, and `translate()` premultiply the
existing matrix. The `make*()` methods overwrite it. Old `rotate(theta)` also
premultiplies a rotation of `-theta`, so this is not equivalent:

```ts
matrix.makeRotation(theta); // overwrites matrix; not an automatic migration
```

Preserve the old behavior only when that behavior is intended:

```ts
const transform = new THREE.Matrix3();

matrix.premultiply(transform.makeScale(sx, sy));
matrix.premultiply(transform.makeRotation(-theta));
matrix.premultiply(transform.makeTranslation(tx, ty));
```

Prefer readable, explicit composition for new code. Add a transform-result test
before removing deprecated calls.

### Scene graph and node rendering

- When `matrixAutoUpdate = false` and code directly changes `object.matrix`, set
  `object.matrixWorldNeedsUpdate = true`. In r185, `updateWorldMatrix()` honors
  that flag.
- In r185 `material.positionNode`, `positionGeometry` is the raw geometry
  attribute before morphing, skinning, displacement, batching, or instancing;
  `positionLocal` includes those internal vertex transforms. Base additive
  deformations on `positionLocal`, and use `positionGeometry` only when the
  graph deliberately needs raw attribute-space input.
- `SSAAPassNode.clearColor` and `.clearAlpha` were removed. Configure clear
  color and alpha on the renderer.
- `GTAONode` is darker and wider after its r185 model change; retune `radius`
  and `scale` from captured scenes rather than preserving old numbers.
- `SSRNode` gained a changed API and optional denoiser; `SSGINode` changed its
  internal target to RG11B10. Port those graphs from matching r185 examples.

### PLY data types

`PLYLoader` now preserves PLY field types. A file with `float64` / `double`
positions produces `Float64Array` attributes, which must be converted to
`Float32BufferAttribute` before rendering. `PLYExporter` likewise honors
attribute types; only `Uint8Array` color attributes export as `uchar`. Validate
round trips with the actual target toolchain.

## Stable Versus Next-Release Watchlist

Re-check these when upgrading past the skill's last-verify note. Do not treat a
future migration entry as proof that a symbol is already absent in the installed
revision:

- `PCFSoftShadowMap` is already deprecated on the WebGL path and should not be
  used; later migration entries remove it from the WebGPU path too. Use
  `PCFShadowMap`.
- The current, untagged 185→186 notes say
  `BufferGeometryUtils.toTrianglesDrawMode()` will change the supplied
  geometry's index in place instead of returning an independent clone. This is
  upgrade-preview information only; when that revision is actually installed,
  clone explicitly first if non-mutating behavior is required.
- `TiledLighting` is replaced by `ClusteredLighting`; new heavy many-light
  scenes should start with the current clustered addon and measure it.
- Later migration entries may rename `LightProbeGrid` /
  `LightProbeGridHelper` on the WebGL side. Do not teach unreleased names as
  current imports; re-check when the installed revision changes.
- Later migration entries may make `SimplifyModifier.modify()` asynchronous.
  Treat simplification tooling as version-sensitive and verify its return type
  before integrating it into an asset pipeline.
- Later migration entries may deprecate some `GTAONode` distance controls. Avoid
  building core tuning UX around them and re-check the installed declaration
  before exposing those properties.

## Verification Procedure

For every version-sensitive recipe:

1. Read the installed package version and lockfile.
2. Resolve each import against the package export map; never guess an addon
   path.
3. Check the matching API page and the installed revision's source/example when
   the API is experimental, shader-facing, XR-facing, or recently migrated.
4. Keep browser runtime URLs project-relative and prove the game runs after
   dependency installation with outbound network disabled.
5. Run the build/typecheck and open the real local page.
6. Capture the first console warning, shader error, failed asset request, and
   WebGPU validation error rather than hiding it.
7. Exercise resize, pause/resume, context/session loss where applicable, and
   teardown/re-entry.
8. Record renderer/backend, package version, browser/device, and checks not run.

Use official examples to learn API shape, not as finished game architecture.
Add ownership, loading/error UI, deterministic simulation, accessibility,
performance budgets, local assets, resize, and disposal around the copied core.

# Official Three.js Baseline

## Contents

- Version and source policy
- Local-first installation and imports
- Official source map
- Renderer compatibility boundary
- r185.1 stale-API denylist
- Stable-versus-next-release watchlist
- Documentation and example verification procedure

Use this reference before writing version-sensitive Three.js code. Treat the
live documentation as the discovery surface and the installed package plus the
matching release tag as the implementation contract.

## Version And Source Policy

Target **`three@0.185.1` (r185)** for this reference set. Pin that exact package
version in greenfield work. Preserve an existing project's locked version
unless an upgrade is part of the request; read every intervening section of the
[official migration guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide)
before changing it.

Use this authority order when sources disagree:

1. Inspect the project's installed `three/package.json`, lockfile, exported
   runtime source, and TypeScript declarations. When they conflict, installed
   runtime exports/source win for existence and behavior; declarations remain
   compile-contract evidence and the mismatch must be documented.
2. Inspect the matching [r185 source tag](https://github.com/mrdoob/three.js/tree/r185)
   and its examples for implementation-sensitive behavior.
3. Use the [live API docs](https://threejs.org/docs/) and
   [manual](https://threejs.org/manual/) for current intent and concepts.
4. Use official examples as executable patterns, then adapt them to local
   modules, ownership, resize, failure, and teardown.
5. Use the migration guide to identify removals, renames, and semantic changes.

The live site can move ahead of a pinned release. Never copy a live example
blindly into an older project. Confirm every addon path, constructor, property,
and return value against the installed version.

At discovery, compare `npm view three version` with `0.185.1`. If stable has
advanced, do not silently treat these recipes as newly verified. A reproducible
tutorial may stay on the exact tested baseline and disclose that choice. A
request for the newest stable must pin the newer version, read the intervening
migration entries, re-check source/types and every imported addon, then rerun
build, renderer-backend, asset, browser, and teardown verification. Record both
the installed target and this reference set's baseline in the report.

## Local-First Installation And Imports

Install dependencies at build time and serve all game code and assets locally:

```bash
npm install three@0.185.1
npm install --save-dev @types/three@0.185.1 vite typescript
```

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
- [RenderPipeline](https://threejs.org/docs/pages/RenderPipeline.html)
- [RenderOutputNode](https://threejs.org/docs/pages/RenderOutputNode.html)

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

r185 also exposes a deliberately limited migration bridge on the separate
`WebGLRenderer` path: install `WebGLNodesHandler` with `setNodesHandler()` for
supported node materials, and use `setEffects()` for supported effects. This
does not add `RenderPipeline` support to `WebGLRenderer`, does not relax the
WebGPURenderer restrictions, and must be checked feature-by-feature. See the
current [WebGLRenderer API](https://threejs.org/docs/pages/WebGLRenderer.html)
and `rendering.md` for the exact setup.

Default to `WebGLRenderer` for compatibility with existing GLSL, addons, broad
production history, and uncomplicated beginner work. For a graphics-heavy or
compute-heavy 3D experience, explicitly offer `WebGPURenderer` and lean toward
it when TSL, GPU compute, node post-processing, many-light rendering, or another
measured WebGPU benefit matches the target browsers. Do not promise it will be
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

## r185.1 Stale-API Denylist

Reject or rewrite these patterns during planning, implementation, and review.
Confirm the changes against the [migration guide](https://github.com/mrdoob/three.js/wiki/Migration-Guide).

| Reject | Use in r185.1 |
| --- | --- |
| Global `THREE` scripts, `examples/js/*`, `build/three.js`, `three.min.js` | ES modules from `three`, `three/webgpu`, `three/tsl`, and `three/addons/*` |
| WebGL 1 compatibility code | WebGL 2 through `WebGLRenderer` |
| `THREE.Clock` | `THREE.Timer`; call `update(timestamp)` once per frame |
| `requestAnimationFrame()` as the renderer owner | `renderer.setAnimationLoop()`; required for XR and safe WebGPU initialization |
| `renderer.outputEncoding` | `renderer.outputColorSpace` |
| `texture.encoding` | `texture.colorSpace` |
| `sRGBEncoding`, `LinearEncoding`, gamma flags | `SRGBColorSpace`, `LinearSRGBColorSpace`, or `NoColorSpace` |
| `physicallyCorrectLights` or `useLegacyLights` | Remove; use current light behavior and retune intensities |
| Deprecated `RGBELoader` alias | `HDRLoader` |
| `PCFSoftShadowMap` on `WebGLRenderer` (deprecated and substituted in r185) | `PCFShadowMap`; also prefer it on WebGPU for forward compatibility |
| `mergeBufferGeometries()` | `mergeGeometries()` |
| `PointerLockControls.getObject()` | `controls.object` |
| WebGPU `ShaderMaterial`, `RawShaderMaterial`, or `onBeforeCompile()` | Node materials and TSL |
| WebGPU `EffectComposer` | `RenderPipeline` |
| WebGPU `PostProcessing` wrapper | `RenderPipeline`; the wrapper is deprecated since r183 |
| `Renderer.renderAsync()`, async clear methods, `hasFeatureAsync()`, or `initTextureAsync()` | Initialize once, then use `render()`, `clear()`, `hasFeature()`, or `initTexture()` |
| Treating every async Renderer method as deprecated | `computeAsync()`, `compileAsync()`, readback methods, and `resolveTimestampsAsync()` remain current in r185.1; verify each method individually |
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
| `Matrix3.scale()` / `rotate()` / `translate()` | `makeScale()` / `makeRotation()` / `makeTranslation()` or explicit matrix composition |
| `WebGLCubeRenderTarget` with `WebGPURenderer` | `CubeRenderTarget` |
| `SkyMesh.isSky` | `SkyMesh.isSkyMesh`; the separate legacy `Sky` addon still has a current `isSky` flag in r185 |
| Assuming `FileLoader.load()` or `ImageBitmapLoader.load()` returns a request | Use callbacks or supported `loadAsync()` flows |
| Manual +Z-up correction for every FBX | Inspect first; current `FBXLoader` converts +Z-up files to +Y-up |
| `Raycaster.firstHitOnly` presented as core | Mark it as third-party acceleration behavior |
| `SceneOptimizer` presented as stable or complete | Mark it experimental; measure explicit instancing/batching first |

## Stable Versus Next-Release Watchlist

The migration guide can contain a not-yet-released 185→186 section while npm
stable remains r185. Do not silently use a future removal as proof that an
r185.1 symbol is already absent. Keep these entries as upgrade warnings and
prefer a cross-version replacement only when it is valid in the installed
release:

- `PCFSoftShadowMap` is already deprecated on the WebGL path and should not be
  used; the next migration entry removes it from the WebGPU path too. Use
  `PCFShadowMap` in r185.1.
- `TiledLighting` is replaced by `ClusteredLighting`; new heavy many-light
  scenes should start with the current clustered addon and measure it.
- The next migration entry renames `LightProbeGrid` and
  `LightProbeGridHelper` on the WebGL side. Do not teach unreleased names as
  r185.1 imports; re-check when the installed revision changes.
- The next migration entry makes `SimplifyModifier.modify()` asynchronous.
  Treat simplification tooling as version-sensitive and verify its return type
  before integrating it into an asset pipeline.
- The next migration entry deprecates two `GTAONode` distance controls. Avoid
  building core tuning UX around them and re-check the installed declaration
  before exposing those properties.

## Verification Procedure

For every version-sensitive recipe:

1. Read the installed package version and lockfile.
2. Resolve each import against the package export map; never guess an addon
   path.
3. Check the matching API page and the r185 source/example when the API is
   experimental, shader-facing, XR-facing, or recently migrated.
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

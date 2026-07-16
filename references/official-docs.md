# Official Three.js Baseline

## Contents

- Version and source policy
- Local-first installation and imports
- Official source map
- Renderer compatibility boundary
- r185.1 stale-API denylist
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

1. Inspect the project's installed `three/package.json`, lockfile, TypeScript
   declarations, and exported source.
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

Default to `WebGLRenderer` for compatibility with existing GLSL, addons, and
known production behavior. Choose `WebGPURenderer` only for a concrete TSL,
compute, WebGPU, or node-post benefit and test its WebGL fallback. The official
[WebGPURenderer guide](https://threejs.org/manual/en/webgpurenderer) explicitly
marks it experimental and documents the material and post-processing boundary.

Do not combine imports or recipes from both columns in one renderer path.

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
| `RGBELoader` | `HDRLoader` |
| `PCFSoftShadowMap` | `PCFShadowMap` |
| `mergeBufferGeometries()` | `mergeGeometries()` |
| `PointerLockControls.getObject()` | `controls.object` |
| WebGPU `ShaderMaterial`, `RawShaderMaterial`, or `onBeforeCompile()` | Node materials and TSL |
| WebGPU `EffectComposer` | `RenderPipeline` |
| WebGPU `PostProcessing` wrapper | `RenderPipeline`; the wrapper is deprecated since r183 |
| `WebGPURenderer.renderAsync()`, `computeAsync()`, `clearAsync()` after initialization | Current synchronous methods after `setAnimationLoop()` initialization or `await renderer.init()` |
| `WebGPURenderer.waitForGPU()` | Remove; profile with browser GPU tools and current renderer APIs |
| `KTX2Loader.detectSupportAsync()` | Initialize the renderer, then call `detectSupport(renderer)` |
| `DRACOLoader.setDecoderConfig()` | Remove; deprecated in r185 |
| `AnamorphicNode` | Use the current bloom node path where the visual requirement fits |
| `TiledLighting` | `ClusteredLighting` |
| `directionToColor()` / `colorToDirection()` | `packNormalToRGB()` / `unpackRGBToNormal()` |
| `WebGLCubeRenderTarget` with `WebGPURenderer` | `CubeRenderTarget` |
| Assuming `FileLoader.load()` or `ImageBitmapLoader.load()` returns a request | Use callbacks or supported `loadAsync()` flows |
| Manual +Z-up correction for every FBX | Inspect first; current `FBXLoader` converts +Z-up files to +Y-up |
| `Raycaster.firstHitOnly` presented as core | Mark it as third-party acceleration behavior |
| `SceneOptimizer` presented as stable or complete | Mark it experimental; measure explicit instancing/batching first |

The migration guide can contain a not-yet-released 185→186 section. Do not
silently use a future removal as proof that an r185.1 symbol is already absent;
prefer the current replacement when it works across both versions.

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

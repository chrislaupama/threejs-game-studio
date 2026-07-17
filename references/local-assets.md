# Local Asset Pipeline

## Contents

- Allowed sources, stable layout, catalog, and provenance
- Compression-aware local loader boundary, GLB/FBX intake, and ownership
- Local 2D, texture/material, font/UI, and audio handling
- Static and live local-only verification

Use this reference whenever models, textures, fonts, sprites, maps, or audio are
added or replaced. The project must remain independent of remote services and
runtime network access.

This file owns the project-local URL, provenance, and intake boundary. Read
`loaders-animation.md` for the normative loader, retry, animation, cloning, and
GPU-resource disposal recipes instead of duplicating those implementations
here.

Primary Three.js references: [GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html),
[LoadingManager](https://threejs.org/docs/pages/LoadingManager.html),
[DRACOLoader](https://threejs.org/docs/pages/DRACOLoader.html),
[KTX2Loader](https://threejs.org/docs/pages/KTX2Loader.html), and the
[disposal guide](https://threejs.org/manual/en/how-to-dispose-of-objects.html).

## Allowed Sources

- Procedural Three.js geometry and materials.
- Canvas, SVG, CSS, `CanvasTexture`, and `DataTexture` content authored in the
  repository.
- Web Audio synthesis and generated `AudioBuffer` content.
- Files already owned by the project.
- Files the user supplies directly, with their stated license/provenance.
- Files authored locally in a DCC or editor and placed in the project by the
  user. Do not invoke or automate a hosted service to create them.

Do not search for, download, hotlink, or generate assets through MCP, provider
SDKs, remote APIs, CDNs, hosted viewers, temporary URLs, or cloud runtimes. Do
not use remote fonts, icons, skyboxes, audio streams, or model URLs.

## Project Layout

Respect an existing asset layer. For a greenfield Vite project, use a small
stable layout such as:

```text
public/assets/models/
public/assets/textures/
public/assets/audio/
public/assets/fonts/
public/assets/decoders/draco/gltf/   # only when a manifest uses DRACO
public/assets/decoders/basis/        # only when a manifest uses KTX2/Basis
src/assets/AssetCatalog.ts
src/assets/ModelLoader.ts
src/assets/MaterialLibrary.ts
src/assets/ProceduralTextures.ts
src/assets/dispose.ts
```

Use semantic keys (`hero`, `hazardSweeper`, `pickupEnergy`) instead of prompt,
job, or transient filenames. Keep browser URLs separate from filesystem paths.

For broad work, copy `assets/content-provenance.template.md` from this skill
into the project at discovery time. The static audit cannot prove how a local
file arrived; review that inventory before accepting the local-only claim.

## Asset Catalog

Vite root-absolute strings such as `/assets/hero.glb` bypass the configured
deployment base. For files intentionally stored under `public/`, resolve a
project-relative path through `import.meta.env.BASE_URL`:

```ts
export function publicAssetUrl(relativePath: string): string {
  const localPath = relativePath.replace(/^\/+/, '');
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(localPath);
  } catch {
    throw new Error(`Invalid encoded asset path: ${relativePath}`);
  }
  const segments = decodedPath.split('/');
  if (
    !localPath ||
    /^[a-z][a-z\d+.-]*:/i.test(decodedPath) ||
    /[\\?#%\0]/.test(decodedPath) ||
    segments.some((segment) => segment === '.' || segment === '..')
  ) {
    throw new Error(`Expected a project-local public asset path: ${relativePath}`);
  }
  return `${import.meta.env.BASE_URL}${localPath}`;
}
```

For assets kept inside `src/`, prefer a static import such as
`import heroUrl from './hero.glb?url'`; Vite fingerprints and rewrites it. Keep
decoder/WASM directories together and resolve their public base with the same
helper. Test the production preview under the real `base`, not only `/`.

For imported local files, keep a typed project-owned catalog:

```ts
export const assets = {
  hero: {
    modelUrl: publicAssetUrl('assets/models/hero.glb'),
    scale: 1,
    forward: '+z',
    up: '+y',
    // Copied from the inspected glTF extensionsUsed array during asset intake.
    gltfExtensions: [
      'KHR_draco_mesh_compression',
      'KHR_texture_basisu',
    ],
  },
  crate: {
    modelUrl: publicAssetUrl('assets/models/crate.glb'),
    scale: 1,
    forward: '+z',
    up: '+y',
    gltfExtensions: [], // ordinary GLB: GLTFLoader needs no decoder stack
  },
  pickup: {
    textureUrl: publicAssetUrl('assets/textures/pickup.png'),
  },
} as const;
```

The catalog contains only project paths and integration metadata. Record
`extensionsUsed` from an intake/build-time inspection; do not guess compression
from the filename or instantiate every decoder pre-emptively. It must not
contain provider IDs, API keys, expiring URLs, or remote fallbacks.

## Imported Model Contract

Prefer GLB with PBR materials for browser runtime. Use FBX only when an existing
local animation workflow requires it, then normalize it through the same asset
boundary. Do not add CDN import maps, remote decoder paths, or conversion
services.

Load local GLB files with `GLTFLoader` from `three/addons`. Normalize each model
once in an asset wrapper:

- Confirm units, scale, model-local forward/up axes, handedness, pivot, bounds,
  and active-play silhouette.
- For animated `SkinnedMesh` content, validate a conservative bound across every
  required clip or deliberately recompute its box/sphere after pose changes.
  Bind-pose bounds are not evidence that animated culling is safe.
- Keep canonical asset transforms separate from gameplay/presentation offsets.
- Record mesh, material, texture, triangle, file-size, and animation-clip counts
  when meaningful.
- Map gameplay states to clips through semantic names. Decide root motion
  explicitly; arcade games usually move entities in code.
- Create simple collision proxies independent of detailed render meshes.
- Provide visible loading, failure, and retry state when asynchronous loading
  affects play.
- Dispose replaced scenes, mixers, geometries, materials, and textures.

Do not silently replace a failed local file with a remote URL.

## Compression-Aware Local GLTF Boundary

The inspected asset manifest decides which optional support an asset receives.
A plain glTF/GLB needs `GLTFLoader` alone:

| Inspected `extensionsUsed` entry | Add only this support |
| --- | --- |
| none of the entries below | `GLTFLoader` only |
| `KHR_draco_mesh_compression` | `DRACOLoader` |
| `EXT_meshopt_compression` | `MeshoptDecoder` |
| `KHR_texture_basisu` | `KTX2Loader` after renderer support detection |

An asset can require more than one row. Capture these strings during intake from
the glTF JSON or GLB JSON chunk and commit them to the asset catalog. Do not
guess from a filename, configure every decoder for every model, or parse a GLB a
second time in the browser merely to decide its loader stack.

The ordinary path stays deliberately small:

```ts
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const manager = new THREE.LoadingManager();
const loader = new GLTFLoader(manager); // no DRACO, Meshopt, or KTX2 for plain GLB
const crate = await loader.loadAsync(assets.crate.modelUrl);
```

When the manifest declares compression, configure only the declared features.
The following boundary dynamically imports optional decoder code and uses
explicit project-owned fallback directories. Copy those directories from the
matching installed Three.js revision during project setup; never mix decoder
files from another revision or replace a missing local file with a CDN URL.

```ts
import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

type CompressionRenderer = THREE.WebGLRenderer | WebGPURenderer;
type ModelRecord = {
  modelUrl: string;
  gltfExtensions: readonly string[];
};

export async function createLocalLoaderFor(
  asset: ModelRecord,
  manager: THREE.LoadingManager,
  renderer?: CompressionRenderer,
) {
  const extensions = new Set(asset.gltfExtensions);
  const loader = new GLTFLoader(manager);
  const releaseDecoderPools: Array<() => void> = [];

  if (extensions.has('KHR_draco_mesh_compression')) {
    const { DRACOLoader } = await import(
      'three/addons/loaders/DRACOLoader.js'
    );
    const draco = new DRACOLoader(manager)
      .setDecoderPath(publicAssetUrl('assets/decoders/draco/gltf/'))
      .setWorkerLimit(2);
    loader.setDRACOLoader(draco);
    releaseDecoderPools.push(() => draco.dispose());
  }

  if (extensions.has('EXT_meshopt_compression')) {
    const { MeshoptDecoder } = await import(
      'three/addons/libs/meshopt_decoder.module.js'
    );
    loader.setMeshoptDecoder(MeshoptDecoder);
  }

  if (extensions.has('KHR_texture_basisu')) {
    if (!renderer) {
      throw new Error('KTX2 asset requires an initialized renderer');
    }
    // For WebGPU, the caller must await renderer.init() before this factory.
    const { KTX2Loader } = await import(
      'three/addons/loaders/KTX2Loader.js'
    );
    const ktx2 = new KTX2Loader(manager)
      .setTranscoderPath(publicAssetUrl('assets/decoders/basis/'))
      .setWorkerLimit(2)
      .detectSupport(renderer);
    loader.setKTX2Loader(ktx2);
    releaseDecoderPools.push(() => ktx2.dispose());
  }

  return {
    loader,
    abortPending: () => manager.abort(),
    disposeLoaderDomain() {
      manager.abort();
      for (const release of releaseDecoderPools) release();
    },
  };
}
```

The two-worker limits are starting budgets, not promises. Coordinate them with
other worker pools and measure constrained devices. Reuse this returned loader
within its coherent asset domain; do not create decoder workers per actor. A
fresh retry phase needs a fresh manager because its item counters are
cumulative. `LoadingManager.onProgress` reports completed items, not bytes, and
`abort()` is best effort, so preserve attempt tokens and dispose late results.

In r185 the addon loaders also provide version-matched module-relative support
files. Use those defaults when the production bundler emits them correctly; use
the explicit local directories above when the deployment/CSP requires stable
public URLs. Test the production build under its real base path either way.

Prefer GLB. If a local `.gltf` is required, every external buffer and image URI
resolves relative to the model URL. Verify that each dependency exists, remains
inside the project boundary after symlink resolution, and has no remote or
filesystem scheme.

## Asset And Animation Ownership Hand-Off

The loader domain and loaded asset are different owners:

- The loader domain owns its manager and DRACO/KTX2 worker pools. Dispose it
  only after no later load in that domain can need those decoders.
- The asset cache retains the complete `gltf.scenes` collection, clips,
  geometries, materials, textures, and source skeletons. An instance borrows
  those resources through a lease.
- A game instance owns its wrapper, mixer, listeners, actions, and any
  instance-specific material/skeleton clones. On removal it stops actions,
  uncaches its root, detaches the wrapper, disposes only its exclusive clones,
  and releases the cache lease.
- The final source owner deduplicates and disposes GPU resources across every
  retained glTF scene. It closes an `ImageBitmap` only after proving nothing
  else shares it; custom shader/node textures and non-scene resources need
  explicit registration.

Do not let an actor instance directly dispose cache-shared geometry, materials,
or textures. Keep canonical scale/axis/pivot correction on the loaded model
under a gameplay wrapper, map exporter clip names to semantic states, decide
root motion explicitly, and use the `clone()` export from
`three/addons/utils/SkeletonUtils.js` for independently animated rigged
instances.

Use the complete implementations and edge cases in
`loaders-animation.md#production-gltf-loader-stack`,
`loaders-animation.md#clone-animated-assets-safely`, and
`loaders-animation.md#disposal-and-ownership`. That reference is the
normative owner for loading UI, retries, animation state, cloning, and teardown;
this file remains the normative owner for local paths, provenance, and the
asset-intake boundary.

## Local 2D Authoring Workflow

Before adding a file texture, decide whether the surface is better expressed as
local SVG/CSS/Canvas, `CanvasTexture`, `DataTexture`, vertex color, or shared
procedural material logic. For file-backed local art:

1. Name its gameplay/UI purpose and intended display size.
2. Record project/user source and license in the provenance inventory.
3. Crop and size it locally; choose PNG for alpha/UI and a compact opaque format
   already supported by the project for large color images.
4. Set color space, UV orientation, filtering, wrap, repeat, mipmaps, and
   anisotropy explicitly.
5. Inspect it in the active camera and mobile tier, then atlas/share/reduce it
   if the runtime cost exceeds its visible contribution.

Do not preserve prompt text, provider job IDs, remote source handles, or
temporary download paths in the runtime catalog.

## Texture And Material Contract

- `GLTFLoader` already sets `flipY = false` and assigns sRGB color space to
  color-bearing glTF slots such as base color and emissive. Do not overwrite
  that metadata blindly.
- When replacing a glTF map with `TextureLoader`, set the replacement's
  metadata deliberately: use `THREE.SRGBColorSpace` for base-color/emissive,
  keep normal/roughness/metalness/occlusion maps in `THREE.NoColorSpace`, and
  normally set `flipY = false` to match glTF UV orientation. Preserve or
  deliberately replace the original `channel`, UV transform, and sampler
  settings; glTF can use a non-default UV set or `KHR_texture_transform`.
- Set wrapping, repeat, mipmaps, filtering, and anisotropy deliberately. After
  changing wrap/filter modes, set `texture.needsUpdate = true`. Clamp
  anisotropy to the renderer's reported maximum.
- After first use, do not mutate a texture's dimensions, format, or type in
  place. Create the replacement, swap it at a safe boundary, and dispose the
  old texture when its final owner releases it.
- Load runtime KTX2 through `KTX2Loader`. Treat a raw `.basis` file as an
  authoring/intermediate artifact to package as KTX2, not as a directly
  supported Three.js runtime texture.
- Prefer small shared procedural patterns, trim sheets, decals, and atlases over
  unique large textures for repeated props.
- Preserve dimensions and aspect ratios; do not infer missing maps.
- Avoid data URIs for meaningful assets when a stable project file is clearer.

Use the complete, compile-checked `copyTextureSamplingState()` replacement
recipe in `materials-textures.md`. Do not keep a shorter local copy: partial
recipes commonly lose wrapping, filtering, anisotropy, mapping,
compare/channel, or UV-matrix state. Set the new source's color-space and
orientation metadata first, apply that helper only when the semantic role and
UV contract are unchanged, swap at a safe boundary, then release the previous
texture through the resource owner.

## Fonts And UI Art

Prefer system fonts or project-local WOFF2 files. Use inline/local SVG, CSS
shapes, Canvas, or an icon sheet stored in the project. Do not add remote font
or icon packages at runtime.

## Audio Files

Keep local audio under a stable project path. Decode after a user gesture or
during an explicit loading state. Route through project-owned buses, enforce
voice limits, and stop loops on pause/restart/teardown. Use procedural Web Audio
when local source files are absent.

## Local-Only Verification

Run:

```bash
npm run audit:local
```

For imported models and textures, also run this package's asset checklist:

```bash
npm --prefix <this-skill-dir> run audit:assets -- <project>
```

Paste warning lines into `docs/content-provenance.md` and resolve colorSpace,
scale/axes, and compression before release.

Also verify:

- Every runtime URL is relative/project-local.
- Production preview loads with network disabled after dependencies are built.
- No browser request targets a non-local origin. The bundled canvas inspector
  blocks and reports outbound requests; preserve an equivalent route guard in
  project browser tests.
- Assets work under the intended Vite `base` path.
- User-supplied asset licenses/source notes are preserved.
- Bundle and large-file costs are reviewed.
- Imported actor evidence names semantic clips, root-motion policy, wrapper
  normalization, collision proxy, mixer lifecycle, and teardown result.

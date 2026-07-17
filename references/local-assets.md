# Local Asset Pipeline

## Contents

- Allowed sources, stable layout, catalog, and provenance
- Local GLB/FBX intake, animation lifecycle, and disposal
- Local 2D, texture/material, font/UI, and audio handling
- Static and live local-only verification

Use this reference whenever models, textures, fonts, sprites, maps, or audio are
added or replaced. The project must remain independent of remote services and
runtime network access.

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
  if (!localPath || /^[a-z][a-z\d+.-]*:/i.test(localPath)) {
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
  },
  pickup: {
    textureUrl: publicAssetUrl('assets/textures/pickup.png'),
  },
} as const;
```

The catalog contains only project paths and integration metadata. It must not
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

## GLB And Animation Lifecycle

Keep loading, wrapper normalization, semantic clips, mixer updates, and teardown
under one asset owner. Adapt this shape to the project's error/loading state:

```ts
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const loader = new GLTFLoader();

function disposeOwnedActorResources(root: THREE.Object3D) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const skeletons = new Set<THREE.Skeleton>();
  const imageBitmaps = new Set<ImageBitmap>();

  root.traverse((object) => {
    const renderable = object as THREE.Object3D & {
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
      skeleton?: THREE.Skeleton;
    };
    if (renderable.geometry?.isBufferGeometry) {
      geometries.add(renderable.geometry);
    }
    if (renderable.skeleton instanceof THREE.Skeleton) {
      skeletons.add(renderable.skeleton);
    }
    const ownedMaterials = Array.isArray(renderable.material)
      ? renderable.material
      : renderable.material
        ? [renderable.material]
        : [];
    for (const material of ownedMaterials) materials.add(material);
  });

  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value && (value as THREE.Texture).isTexture) {
        textures.add(value as THREE.Texture);
      }
    }
  }
  for (const texture of textures) {
    texture.dispose();
    const sourceData: unknown = texture.source.data;
    if (
      typeof ImageBitmap !== 'undefined' &&
      sourceData instanceof ImageBitmap
    ) {
      imageBitmaps.add(sourceData);
    }
  }
  for (const imageBitmap of imageBitmaps) imageBitmap.close();
  for (const skeleton of skeletons) skeleton.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
  root.removeFromParent();
}

export async function loadLocalActor(url: string) {
  const gltf = await loader.loadAsync(url);
  const wrapper = new THREE.Group();
  wrapper.name = 'actor-wrapper';
  wrapper.add(gltf.scene);

  // Apply canonical scale/forward/up/pivot corrections to gltf.scene once.
  // Keep wrapper.position/rotation for gameplay presentation.
  const mixer = gltf.animations.length
    ? new THREE.AnimationMixer(gltf.scene)
    : undefined;
  const clips = new Map(gltf.animations.map((clip) => [clip.name, clip]));
  let currentAction: THREE.AnimationAction | undefined;

  return {
    root: wrapper,
    clips,
    update(deltaSeconds: number) {
      mixer?.update(deltaSeconds);
    },
    play(name: string, fadeSeconds = 0.12) {
      const clip = clips.get(name);
      if (!clip || !mixer) return false;
      const nextAction = mixer.clipAction(clip);
      if (nextAction === currentAction) return true;
      nextAction.reset().setEffectiveTimeScale(1).setEffectiveWeight(1).play();
      if (currentAction) currentAction.crossFadeTo(nextAction, fadeSeconds, false);
      else nextAction.fadeIn(fadeSeconds);
      currentAction = nextAction;
      return true;
    },
    dispose() {
      mixer?.stopAllAction();
      mixer?.uncacheRoot(gltf.scene);
      currentAction = undefined;
      disposeOwnedActorResources(wrapper);
    },
  };
}
```

This implementation assumes one actor owner owns the loaded GPU resources. If
instances borrow geometry/materials/textures from a cache, replace direct
disposal with a reference-counted cache release; never let one borrower free
resources still used by another. Register textures hidden in shader uniforms
or node graphs explicitly because shallow material inspection cannot find them.

- Map source clip names to gameplay semantics (`idle`, `move`, `attack`,
  `hurt`, `defeat`) in the asset catalog. Do not make game rules depend on
  exporter-specific names or array order.
- Decide root motion per clip. For arcade movement, keep simulation transforms
  authoritative and remove or ignore horizontal clip displacement during a
  deliberate local preprocessing/intake step; preserve useful vertical motion.
- Stop/fade the previous action rather than starting unlimited actions. Update
  each mixer exactly once with simulation or animation delta chosen by design.
- Use `SkeletonUtils.clone` from `three/addons/utils/SkeletonUtils.js` for
  independent rigged copies. Ordinary `Object3D.clone()` is not a safe default
  for separately animated skinned instances.
- Record missing clips, binding warnings, durations, track counts, and visible
  loading failure. A model that loads but cannot enter required gameplay states
  has failed intake.

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

- Set base-color/emissive textures to `THREE.SRGBColorSpace`; keep data maps in
  the appropriate linear/non-color space.
- Set wrapping, repeat, mipmaps, filtering, anisotropy, and `flipY` deliberately.
- Prefer small shared procedural patterns, trim sheets, decals, and atlases over
  unique large textures for repeated props.
- Preserve dimensions and aspect ratios; do not infer missing maps.
- Avoid data URIs for meaningful assets when a stable project file is clearer.

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

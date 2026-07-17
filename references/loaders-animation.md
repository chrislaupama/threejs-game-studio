# Local Asset Loading And Animation

## Contents

- Choose this reference when
- Novice mental model
- Smallest correct glTF load
- LoadingManager and failure UI
- Production glTF loader stack
- DRACO, KTX2, and Meshopt
- Normalize and inspect loaded content
- Clone animated assets safely
- Animation mixer basics
- Production animation state machine
- One-shots, additive layers, morphs, and root motion
- Crowd animation scaling and representation budgets
- Common failures
- Performance
- Disposal and ownership
- Verification
- Official documentation

## Choose This Reference When

Read this file when loading project-local models, textures, HDR files, or
animations; showing loading progress; handling missing/corrupt assets;
configuring glTF compression; creating multiple animated characters; or wiring
idle/walk/run/action clips into game state.

Loader examples use the project-owned `publicAssetUrl()` helper from
`local-assets.md`; import it from the local asset boundary in real code.

Use glTF 2.0, normally binary `.glb`, as the default runtime model format.
Choose compression from measured asset needs:

| Asset feature | Loader configuration |
| --- | --- |
| Ordinary glTF/GLB | `GLTFLoader` only |
| `KHR_draco_mesh_compression` | `DRACOLoader` |
| `EXT_meshopt_compression` | `MeshoptDecoder` |
| KTX2/Basis textures | `KTX2Loader` after renderer support detection |
| RGBE `.hdr` environment | `HDRLoader` |

Do not configure a remote decoder or runtime CDN. Ship decoder/transcoder files
from the same installed Three.js package inside the project.

## Novice Mental Model

Loading has three layers:

1. Transport and decode: read a local runtime URL and decode bytes.
2. Asset source: the loaded glTF scene, clips, geometries, materials, textures,
   skeletons, and metadata retained by an asset owner.
3. Game instance: a scene object and animation state used by one player,
   enemy, pickup, or prop.

`loadAsync()` resolves when that asset is ready or rejects on failure. A
`LoadingManager` observes loader items and reports item counts, not reliable
byte progress. An `AnimationMixer` advances clips for one root object; it must be
updated with seconds every frame.

Loaded resources are often shared. Cloning an object does not automatically
clone geometry, material, or texture ownership. Animated skinned scenes need
`SkeletonUtils.clone()` so each instance has correctly rebound bones.

## Smallest Correct glTF Load

Use a project-local URL, catch failure, inspect the result, and hand it to an
explicit asset owner:

```ts
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

export async function loadProp(scene: THREE.Scene) {
  const loader = new GLTFLoader();

  try {
    const gltf = await loader.loadAsync(
      publicAssetUrl('assets/models/crate.glb'),
    );
    const root = gltf.scene;
    root.name = 'crate-instance';
    scene.add(root);

    return { root, clips: gltf.animations };
  } catch (error) {
    console.error('Could not load local crate.glb', error);
    throw error;
  }
}
```

This smallest example demonstrates loading, not final GPU-resource ownership;
its returned `root` and clips must be adopted by the asset cache described in
"Disposal And Ownership" below. Do not present `{ root, clips }` as a complete
disposer: geometry, materials, textures, skeletons, image sources, instances,
and mixers have different lifetimes.

Do not make a failed required asset silently disappear. Keep loading/error UI
visible and offer a retry, back action, or explicit local fallback. A procedural
placeholder is appropriate only when the game can still meet its promise.

## LoadingManager And Failure UI

Create one manager for a loading phase. `onLoad` still runs after all item
requests end even if some invoked `onError`, so track failures separately:

```ts
const failedUrls = new Set<string>();
const manager = new THREE.LoadingManager();

manager.onStart = (_url, loaded, total) => {
  loadingUi.show();
  loadingUi.setProgress(total === 0 ? 0 : loaded / total);
};
manager.onProgress = (_url, loaded, total) => {
  loadingUi.setProgress(total === 0 ? 0 : loaded / total);
};
manager.onError = (url) => {
  failedUrls.add(url);
  loadingUi.reportAssetFailure(url);
};
manager.onLoad = () => {
  const failures = [...failedUrls];
  if (failures.length === 0) loadingUi.showReady();
  else loadingUi.showBlocked(failures);
  failedUrls.clear(); // a completed attempt cannot poison the next attempt
};

const textureLoader = new THREE.TextureLoader(manager);
const gltfLoader = new GLTFLoader(manager);
```

Manager progress is `(items completed / items discovered)`. The denominator can
grow as a model discovers dependent resources. Do not label it downloaded
bytes. `TextureLoader` does not support a useful per-file progress callback.

Create a fresh manager, failure set, and loader set for an explicit retry. A
`LoadingManager` keeps cumulative private item counters, so clearing only the
failure set is insufficient for a new progress bar. Detach or ignore callbacks
from an abandoned attempt, and never let an older attempt switch the new UI to
ready.

Use `manager.setURLModifier()` only for a controlled mapping such as local
drag-and-drop blob URLs. Preserve data/blob URLs and revoke every created blob
URL after the loader no longer needs it.

## Production glTF Loader Stack

Keep decoder support files in project-owned public paths. A Vite layout can be:

```text
public/
  decoders/
    draco/gltf/
      draco_decoder.js
      draco_wasm_wrapper.js
      draco_decoder.wasm
    basis/
      basis_transcoder.js
      basis_transcoder.wasm
```

Copy these files from the matching installed
`node_modules/three/examples/jsm/libs/` directories as a build/setup step. Do
not mix decoder files from another Three.js release.

Configure one reusable loader set:

```ts
import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from
  'three/addons/libs/meshopt_decoder.module.js';

type CompressionAwareRenderer = THREE.WebGLRenderer | WebGPURenderer;

export function createModelLoaders(
  renderer: CompressionAwareRenderer,
  manager: THREE.LoadingManager,
) {
  const draco = new DRACOLoader(manager)
    .setDecoderPath(publicAssetUrl('decoders/draco/gltf/'));

  const ktx2 = new KTX2Loader(manager)
    .setTranscoderPath(publicAssetUrl('decoders/basis/'))
    .detectSupport(renderer);

  const gltf = new GLTFLoader(manager)
    .setDRACOLoader(draco)
    .setKTX2Loader(ktx2)
    .setMeshoptDecoder(MeshoptDecoder);

  return {
    gltf,
    dispose() {
      draco.dispose();
      ktx2.dispose();
    },
  };
}
```

Initialize a `WebGPURenderer` through `setAnimationLoop()` or `await
renderer.init()` before KTX2 support detection. Type the loader factory for the
chosen renderer path; the union above is the current r185.1 `KTX2Loader`
contract and does not imply that WebGL GLSL materials or composer passes work
with WebGPU.

## DRACO, KTX2, And Meshopt

### DRACO

DRACO compresses geometry. It can make files smaller but adds decoder startup
and CPU decode cost. Use it when measured delivery savings justify that cost.
Call `DRACOLoader.dispose()` only at final teardown; its decoder module cannot
be reloaded on that loader afterward.

### Meshopt

Meshopt compression and optimization are well suited to glTF geometry and
animation data. `GLTFLoader.setMeshoptDecoder(MeshoptDecoder)` must happen
before loading an asset using `EXT_meshopt_compression`. Keep the decoder module
bundled from the same Three package.

### KTX2/Basis

KTX2 allows GPU-supported compressed texture formats. Run
`detectSupport(renderer)` after renderer initialization. Test normal maps,
alpha edges, color maps, and mip behavior on representative desktop and mobile
GPUs. Compression is not automatically higher quality; choose encoders and
settings per texture role.

Use compression in the asset build pipeline, never by attempting to transcode
large source images on the main thread during gameplay.

## Normalize And Inspect Loaded Content

Do not blindly scale every asset by the same folklore constant. Inspect its
bounds, axes, authored units, pivot, node names, materials, animations, and
metadata at one import boundary:

```ts
function inspectModel(root: THREE.Object3D, clips: THREE.AnimationClip[]) {
  root.updateWorldMatrix(true, true);
  const bounds = new THREE.Box3().setFromObject(root);
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());

  console.table({
    width: size.x,
    height: size.y,
    depth: size.z,
    centerX: center.x,
    centerY: center.y,
    centerZ: center.z,
  });
  console.table(clips.map((clip) => ({
    name: clip.name,
    duration: clip.duration,
    tracks: clip.tracks.length,
  })));
}
```

Normalize by placing the imported root inside an application-owned container.
This preserves authored animation transforms:

```ts
const container = new THREE.Group();
container.name = 'enemy';
container.add(gltf.scene);
container.scale.setScalar(importScale);
container.rotation.y = headingCorrection;
scene.add(container);
```

Do not center or rotate skinned nodes independently after binding unless the
rig is known to tolerate it. Keep game position on the container and authored
animation under it.

Set shadow flags intentionally. A traversal that enables shadows on every mesh
can create an expensive caster set:

```ts
gltf.scene.traverse((object) => {
  if (!(object instanceof THREE.Mesh)) return;
  object.castShadow = object.userData.castShadow === true;
  object.receiveShadow = object.userData.receiveShadow !== false;
});
```

Treat node names as an asset contract. Validate required sockets/colliders at
load time and fail with the missing name, not a later `undefined` error.

## Clone Animated Assets Safely

Use `SkeletonUtils.clone()` for a skinned hierarchy:

```ts
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

const source = await gltfLoader.loadAsync(
  publicAssetUrl('assets/models/robot.glb'),
);

function createRobotInstance() {
  const root = SkeletonUtils.clone(source.scene);
  const mixer = new THREE.AnimationMixer(root);
  return { root, mixer, clips: source.animations };
}
```

The cloned bones/skeleton are instance-specific. Geometries, materials, and
textures remain shared, which is usually desirable. The asset source must stay
alive until the final instance is released. Clone a material only for a
per-instance mutation, and remember that its textures remain shared.

Ordinary `Object3D.clone()` is sufficient for a static hierarchy that does not
need independent skinned bindings. For hundreds of identical static objects,
prefer instancing/batching instead of cloned scene graphs.

## Animation Mixer Basics

Advance a `Timer` once, use its stable delta, and update each active mixer:

```ts
const timer = new THREE.Timer();
timer.connect(document);

const mixer = new THREE.AnimationMixer(gltf.scene);
const idle = THREE.AnimationClip.findByName(gltf.animations, 'Idle');
if (!idle) throw new Error('Required clip "Idle" is missing');
mixer.clipAction(idle).play();

renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  mixer.update(Math.min(timer.getDelta(), 0.1));
  renderer.render(scene, camera);
});
```

Keep gameplay simulation on its fixed-step clock. Visual animation can use the
render delta unless animation events are authoritative game rules. Never call
deprecated `Clock`, and do not query a timing source twice to derive unrelated
deltas.

## Production Animation State Machine

Map semantic game states to clip names once. Start the next action before the
crossfade so it can receive weight:

```ts
type AnimationState = 'idle' | 'walk' | 'run' | 'hit' | 'death';

class CharacterAnimator {
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<AnimationState, THREE.AnimationAction>();
  private current?: THREE.AnimationAction;

  constructor(root: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.mixer = new THREE.AnimationMixer(root);
    const clipNames: Record<AnimationState, string> = {
      idle: 'Idle',
      walk: 'Walk',
      run: 'Run',
      hit: 'Hit',
      death: 'Death',
    };

    for (const [state, clipName] of Object.entries(clipNames)) {
      const clip = THREE.AnimationClip.findByName(clips, clipName);
      if (!clip) throw new Error(`Missing animation clip: ${clipName}`);
      this.actions.set(
        state as AnimationState,
        this.mixer.clipAction(clip),
      );
    }
  }

  play(state: AnimationState, fadeSeconds = 0.2, once = false) {
    const next = this.actions.get(state);
    if (!next) throw new Error(`Unmapped animation state: ${state}`);
    const previous = this.current;
    if (next === previous && next.isRunning()) return;

    next.reset();
    next.enabled = true;
    next.setEffectiveTimeScale(1);
    next.setEffectiveWeight(1);
    next.clampWhenFinished = once;
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.play();

    if (previous && previous !== next) {
      previous.crossFadeTo(next, fadeSeconds, true);
    }
    else next.fadeIn(fadeSeconds);
    this.current = next;
  }

  update(deltaSeconds: number) {
    this.mixer.update(deltaSeconds);
  }

  dispose(root: THREE.Object3D) {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(root);
    this.actions.clear();
  }
}
```

Drive this class from canonical movement/combat state, not directly from key
events. Add hysteresis to walk/run thresholds so speed noise does not restart
crossfades. Do not restart a looping action every update.

For a one-shot such as `hit`, listen for the mixer's `finished` event using a
stored callback, verify `event.action`, then return to the locomotion state.
Remove the listener at teardown.

## One-Shots, Additive Layers, Morphs, And Root Motion

### Additive layers

Use an additive clip for breathing, recoil, or aim offsets over a base pose:

```ts
const additiveClip = THREE.AnimationUtils.makeClipAdditive(sourceClip.clone());
const additiveAction = mixer.clipAction(additiveClip);
additiveAction.blendMode = THREE.AdditiveAnimationBlendMode;
additiveAction.setEffectiveWeight(0.35).play();
```

Create additive clips once, not during the frame loop. Confirm the reference
pose and affected bones match the rig.

### Morph targets

Morph weights are numeric. Animate them with `NumberKeyframeTrack`, not a
string track:

```ts
const blinkTrack = new THREE.NumberKeyframeTrack(
  '.morphTargetInfluences[Blink]',
  [0, 0.08, 0.16],
  [0, 1, 0],
);
const blink = new THREE.AnimationClip('Blink', 0.16, [blinkTrack]);
```

Validate that the target name exists in `morphTargetDictionary` on the bound
mesh.

### Procedural bone adjustments

`mixer.update()` writes animated properties. Apply a procedural look-at or aim
offset after the mixer update, or author it as an additive layer. Writing a bone
first and then updating the mixer normally overwrites the write.

### Root motion

Choose one owner for world movement. For most games, strip/ignore horizontal
root translation and move the application container through collision-aware
gameplay. If authored root motion is required, extract the root delta each
fixed step, validate it through collision, apply accepted movement to the game
container, and compensate the animated root. Never let visual root motion and
the physics body drift as independent authorities.

## Crowd Animation Scaling

Keep every enemy as lightweight canonical gameplay data, but do not assume
every visible record deserves an independent skinned hierarchy and mixer.
Choose a measured representation budget:

| Tier | Suitable presentation | Important limit |
| --- | --- | --- |
| Near/hero | `SkeletonUtils.clone()`, independent skeleton/mixer/actions | Cap from measured CPU, skinning, draw, and memory cost |
| Mid | Authored simpler rig/mesh, fewer clips, staggered mixer updates | This requires a real simplified asset; lowering update rate alone can stutter |
| Far | Impostor, baked vertex animation, sprite/flipbook, or rigid `InstancedMesh` | Core `InstancedMesh` does not provide independent skeletal poses |
| Hidden | No render object; canonical rules may continue at reduced declared cadence | Never remove a gameplay threat merely because it is off-camera |

Use hysteresis so an enemy does not thrash between representations:

```ts
type CrowdTier = 'full-rig' | 'simple-rig' | 'impostor' | 'hidden';

const rangeSq = {
  fullEnter: 18 ** 2,
  fullExit: 22 ** 2,
  simpleEnter: 42 ** 2,
  simpleExit: 50 ** 2,
  visibleEnter: 78 ** 2,
  visibleExit: 90 ** 2,
};

function chooseCrowdTier(current: CrowdTier, distanceSq: number): CrowdTier {
  if (current === 'full-rig' && distanceSq <= rangeSq.fullExit) return current;
  if (current !== 'full-rig' && distanceSq < rangeSq.fullEnter) return 'full-rig';

  if (current === 'simple-rig' && distanceSq <= rangeSq.simpleExit) return current;
  if (distanceSq < rangeSq.simpleEnter) return 'simple-rig';

  if (current === 'impostor' && distanceSq <= rangeSq.visibleExit) return current;
  if (distanceSq < rangeSq.visibleEnter) return 'impostor';
  return 'hidden';
}
```

Distance is only the first filter. Sort candidates by stable ID and gameplay
importance, then enforce explicit full-rig and simplified-rig caps. A boss,
attacker in a telegraph window, or selected unit may outrank a closer idle
extra. Move representation changes through pools at a controlled point in the
frame; carry semantic animation state and normalized clip time across the
handoff.

`AnimationObjectGroup` can reduce binding work for compatible objects animated
by the same tracks, but it does not turn arbitrary skinned crowds into one draw
call. Hundreds of independently posed characters usually require authored
animation LOD, impostors, or a renderer-specific baked animation/vertex-texture
pipeline. Implement that as a deliberate WebGL GLSL and/or WebGPU TSL feature,
not as an assumed property of `InstancedMesh`.

For a large-crowd acceptance test, report total canonical agents, visible
agents, full/simple/impostor counts, active mixers/skeletons, animation update
cadence, draws, triangles, CPU/GPU frame time, and representation switches.
Test fast camera motion and combat telegraphs so LOD never hides important
state.

## Common Failures

- **Decoder 404 or MIME error:** decoder/transcoder files were not copied to the
  local public path, or their version does not match the loader.
- **KTX2 throws before loading:** renderer support detection happened before
  renderer initialization or was skipped.
- **Model loads but is invisible:** scale, bounds, camera, material lighting,
  layers, or local URL is wrong; inspect rather than applying folklore scale.
- **Textures are flipped or colors wrong:** code overwrote glTF loader-managed
  texture orientation/color space.
- **Loading reaches 100% despite a failure:** manager completion counts ended
  items; inspect the tracked failure set.
- **Two characters share bones incorrectly:** ordinary `.clone()` was used for
  a skinned hierarchy.
- **One instance's material change affects all:** cloned hierarchies still share
  materials by design.
- **Animation is frozen:** mixer is not updated, delta is near zero, action was
  stopped, or its effective weight/time scale is zero.
- **Crossfade snaps:** next action was not reset/weighted/played before fade, or
  state code restarts it every frame.
- **Procedural head aim disappears:** mixer update runs after the bone write.
- **Character slides away from collider:** visual root motion and gameplay
  movement both own translation.
- **Finished event fires for the wrong one-shot:** callback did not compare
  `event.action` and was never removed.
- **Unload breaks other instances:** shared glTF geometry/material/texture was
  disposed while borrowers remained.

## Performance

- Load required first-play assets as a bounded phase; lazy-load later local
  content at safe transitions, not during reaction-critical play.
- Memoize in-flight promises so two callers do not decode the same file twice.
- Prefer GLB and optimized glTF transforms. Remove unused nodes, skins, clips,
  materials, UV sets, and oversized textures in the asset pipeline.
- Choose DRACO or Meshopt from measured size/decode tradeoffs. Avoid double
  compression assumptions.
- Use KTX2 for large/repeated texture sets after target-GPU validation.
- Share source clips. Create one mixer per independently animated root.
- Pause or reduce distant animation only through an explicit visibility/LOD
  scheduler; render callbacks cannot reliably detect already-culled objects.
- Avoid per-frame clip lookup, action creation, bone-name search, and temporary
  vectors.
- Limit active skeletons and morph targets in the worst crowd state; use
  impostors, animation LOD, or baked motion where appropriate.
- Record loading, decode, upload, first-render, mixer-update, draw-call, and GPU
  costs separately.

## Disposal And Ownership

Use this ownership split:

- Loader stack owns decoder workers/modules and disposes them at application
  teardown.
- Asset cache owns source glTF geometry, materials, textures, clips, and the
  source scene.
- Game instance owns its container, mixer, listeners, and instance-specific
  material clones.
- A borrower never disposes shared source resources directly.

On final source release, traverse once and deduplicate resources:

```ts
function disposeModelSource(root: THREE.Object3D) {
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
    if (renderable.skeleton instanceof THREE.Skeleton) {
      skeletons.add(renderable.skeleton);
    }
    if (renderable.geometry?.isBufferGeometry) {
      geometries.add(renderable.geometry);
    }
    const list = Array.isArray(renderable.material)
      ? renderable.material
      : renderable.material
        ? [renderable.material]
        : [];
    for (const material of list) materials.add(material);
  });

  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (!(value instanceof THREE.Texture)) continue;
      textures.add(value);
      const sourceData: unknown = value.source.data;
      if (
        typeof ImageBitmap !== 'undefined' &&
        sourceData instanceof ImageBitmap
      ) {
        imageBitmaps.add(sourceData);
      }
    }
    material.dispose();
  }
  for (const skeleton of skeletons) skeleton.dispose();
  for (const geometry of geometries) geometry.dispose();
  for (const texture of textures) texture.dispose();
  for (const bitmap of imageBitmaps) bitmap.close();
}
```

Before that final release: remove instances from the scene, stop actions,
remove mixer listeners, call `stopAllAction()` and `uncacheRoot()`, release
instance-specific material clones, dispose the deduplicated skeletons created
for each `SkeletonUtils.clone()` instance, and clear references. Dispose
DRACO/KTX2 only when no later load will use them.

The disposer above is valid only for the final owner of that source graph. It
closes `ImageBitmap` objects because the same owner has proven no other texture
or asset uses them. If bitmap sources are shared outside the model cache, move
them to a separately reference-counted image owner instead. Extend texture
discovery for custom shader/node uniforms; scanning direct material properties
covers built-in material map slots, not arbitrary nested uniform structures.

## Verification

1. Run the production build with runtime outbound network disabled and confirm
   every model, decoder, transcoder, texture, and HDR request is local.
2. Test an ordinary GLB, DRACO GLB, Meshopt GLB, and KTX2 asset actually used by
   the project; configuration alone is not evidence.
3. Simulate a missing required model, corrupt file, missing decoder, and decode
   failure. Verify loading UI does not enter a false-ready state.
4. Log bounds, scale, pivot, node/socket contract, materials, skins, morphs,
   clips, durations, and track counts during asset intake.
5. Instantiate at least two animated skinned copies and confirm independent
   poses with deliberately different actions/times.
6. Exercise every locomotion transition repeatedly around threshold speeds and
   every one-shot through finish, interruption, death, pause, and retry.
7. Compare gameplay collision position with the visual root through root-motion
   clips.
8. Profile load/decode/upload/first-render and mixer update in the worst content
   state.
9. Unload and reload; verify workers, listeners, mixers, geometries, materials,
   and textures return to the same steady state.

## Official Documentation

- [Loading 3D models](https://threejs.org/manual/en/loading-3d-models.html)
- [LoadingManager](https://threejs.org/docs/pages/LoadingManager.html)
- [Loader.loadAsync](https://threejs.org/docs/pages/Loader.html)
- [GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html)
- [DRACOLoader](https://threejs.org/docs/pages/DRACOLoader.html)
- [KTX2Loader](https://threejs.org/docs/pages/KTX2Loader.html)
- [HDRLoader](https://threejs.org/docs/pages/HDRLoader.html)
- [Meshopt decoder bundled source](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/libs/meshopt_decoder.module.js)
- [SkeletonUtils](https://threejs.org/docs/pages/module-SkeletonUtils.html)
- [Animation system manual](https://threejs.org/manual/en/animation-system.html)
- [AnimationMixer](https://threejs.org/docs/pages/AnimationMixer.html)
- [AnimationAction](https://threejs.org/docs/pages/AnimationAction.html)
- [AnimationClip](https://threejs.org/docs/pages/AnimationClip.html)
- [AnimationUtils](https://threejs.org/docs/pages/AnimationUtils.html)
- [AnimationObjectGroup](https://threejs.org/docs/pages/AnimationObjectGroup.html)
- [NumberKeyframeTrack](https://threejs.org/docs/pages/NumberKeyframeTrack.html)
- [Timer](https://threejs.org/docs/pages/Timer.html)

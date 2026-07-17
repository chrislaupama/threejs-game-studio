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
| `KHR_meshopt_compression` or `EXT_meshopt_compression` | `MeshoptDecoder` |
| KTX2/Basis textures | `KTX2Loader` after renderer support detection |
| RGBE `.hdr` environment | `HDRLoader` |

Do not configure a remote decoder or runtime CDN. In r185, `DRACOLoader` and
`KTX2Loader` resolve version-matched decoder/transcoder files relative to their
installed addon modules by default. That is local when the bundler copies those
package assets correctly. Keep an explicit project-owned public-path fallback
for bundlers, content-security policies, or deployment layouts that cannot use
the module-relative defaults.

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

    return { gltf, root }; // the owner retains all scenes, clips, and metadata
  } catch (error) {
    console.error('Could not load local crate.glb', error);
    throw error;
  }
}
```

This smallest example demonstrates loading, not final GPU-resource ownership;
its returned `gltf` must be adopted by the asset cache described in "Disposal
And Ownership" below. Retaining only `gltf.scene` can orphan resources unique
to another entry in `gltf.scenes`. Do not present `{ root, clips }` as a
complete disposer: geometry, materials, textures, skeletons, image sources,
instances, and mixers have different lifetimes.

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
failure set is insufficient for a new progress bar. Call `manager.abort()` on
an abandoned attempt as a best effort, while retaining an attempt guard and
late-result disposal because cancellation depends on loader and browser
support. Never let an older attempt switch the new UI to ready.

Use `manager.setURLModifier()` only for a controlled mapping such as local
drag-and-drop blob URLs. Preserve data/blob URLs and revoke every created blob
URL after the loader no longer needs it.

### End-to-end progress UI and failed-asset recovery

```ts
type LoadPhase = 'idle' | 'loading' | 'ready' | 'blocked';

type CriticalAsset =
  | { id: string; kind: 'gltf'; url: string }
  | { id: string; kind: 'texture'; url: string };

type GltfAsset = Awaited<ReturnType<GLTFLoader['loadAsync']>>;
type LoadedCriticalAsset =
  | { id: string; kind: 'gltf'; url: string; value: GltfAsset }
  | { id: string; kind: 'texture'; url: string; value: THREE.Texture };

interface CriticalAssetOwner {
  // This callback atomically adopts every resource after the whole phase passes.
  adoptCritical(assets: readonly LoadedCriticalAsset[]): void;
}

function releaseUnadopted(assets: readonly LoadedCriticalAsset[]) {
  for (const asset of assets) {
    if (asset.kind === 'texture') asset.value.dispose();
    else disposeModelSource(asset.value.scenes);
  }
}

class BootLoader {
  private phase: LoadPhase = 'idle';
  private attempt = 0;
  private activeManager?: THREE.LoadingManager;

  constructor(private readonly owner: CriticalAssetOwner) {}

  async loadCritical(assets: readonly CriticalAsset[]): Promise<void> {
    const attemptId = ++this.attempt;
    // The increment makes old callbacks fail their attempt guard before abort.
    this.activeManager?.abort();
    const failed = new Set<string>();
    const manager = new THREE.LoadingManager();
    const gltf = new GLTFLoader(manager);
    const textures = new THREE.TextureLoader(manager);
    this.activeManager = manager;

    this.phase = 'loading';
    ui.setProgress(0);
    ui.setMessage('Loading local assets…');

    manager.onProgress = (_url, loaded, total) => {
      if (attemptId !== this.attempt) return; // ignore abandoned retries
      ui.setProgress(total === 0 ? 0 : loaded / total);
    };
    manager.onError = (url) => {
      if (attemptId !== this.attempt) return;
      failed.add(url);
      ui.reportAssetFailure(url);
    };

    const settled = await Promise.allSettled(
      assets.map(async (asset): Promise<LoadedCriticalAsset> => {
        switch (asset.kind) {
          case 'gltf':
            return { ...asset, value: await gltf.loadAsync(asset.url) };
          case 'texture':
            return { ...asset, value: await textures.loadAsync(asset.url) };
        }
      }),
    );
    const loaded = settled.flatMap((result) =>
      result.status === 'fulfilled' ? [result.value] : [],
    );

    if (attemptId !== this.attempt) {
      releaseUnadopted(loaded); // abort is not guaranteed to stop every result
      return;
    }
    this.activeManager = undefined;

    for (let index = 0; index < settled.length; index += 1) {
      const result = settled[index];
      if (result.status === 'fulfilled') continue;
      failed.add(assets[index].url);
      console.error(`Failed critical asset: ${assets[index].id}`, result.reason);
    }

    if (failed.size > 0) {
      releaseUnadopted(loaded);
      this.phase = 'blocked';
      ui.showBlocked([...failed], () => {
        void this.loadCritical(assets); // fresh manager + counters on retry
      });
      return;
    }

    try {
      this.owner.adoptCritical(loaded); // ownership transfers after full success
    } catch (error) {
      releaseUnadopted(loaded); // adoptCritical() is required to be atomic
      throw error;
    }
    this.phase = 'ready';
    ui.showReady();
  }

  cancel() {
    this.attempt += 1;
    this.activeManager?.abort();
    this.activeManager = undefined;
    this.phase = 'idle';
  }
}
```

The manifest is intentionally typed instead of guessing from a suffix, which
breaks for query strings, uppercase extensions, HDR, and KTX2. Add an explicit
manifest kind and configured loader for every additional format; never route an
unknown kind through `TextureLoader`. The asset owner must adopt the successful
batch atomically. Never let an abandoned attempt mark the new UI ready, and
dispose every fulfilled result that loses a retry race or belongs to a failed
batch.

## Production glTF Loader Stack

The r185 addon loaders use package-relative bundled support files by default.
When a deployment requires explicit project-owned paths, a Vite layout can be:

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

Copy explicit fallback files from the matching installed
`node_modules/three/examples/jsm/libs/` directories as a build/setup step. Do
not mix files from another Three.js release. Test the production output because
development-server success does not prove those worker/WASM URLs were emitted.

Configure one reusable loader set:

```ts
import * as THREE from 'three';
import type { WebGPURenderer } from 'three/webgpu';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import {
  DRACOLoader,
  DRACO_GLTF_CONFIG,
} from 'three/addons/loaders/DRACOLoader.js';
import { KTX2Loader } from 'three/addons/loaders/KTX2Loader.js';
import { MeshoptDecoder } from
  'three/addons/libs/meshopt_decoder.module.js';

type CompressionAwareRenderer = THREE.WebGLRenderer | WebGPURenderer;
type ExplicitDecoderPaths = { draco?: string; basis?: string };

export async function createModelLoaders(
  renderer: CompressionAwareRenderer,
  manager: THREE.LoadingManager,
  paths: ExplicitDecoderPaths = {},
) {
  if ((renderer as WebGPURenderer).isWebGPURenderer === true) {
    await (renderer as WebGPURenderer).init();
  }

  const draco = new DRACOLoader(manager).setWorkerLimit(2);
  if (paths.draco) draco.setDecoderPath(paths.draco);
  else draco.setDecoderPath(DRACO_GLTF_CONFIG); // bundled, glTF-only WASM files

  const ktx2 = new KTX2Loader(manager).setWorkerLimit(2);
  if (paths.basis) ktx2.setTranscoderPath(paths.basis);
  ktx2.detectSupport(renderer);

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

Call and await this async factory. For WebGPU, `await renderer.init()` must
finish before `detectSupport()`; an unawaited `renderer.setAnimationLoop()` is
not an initialization barrier because the common renderer method is async in
r185. If animation-loop setup is the chosen barrier, await it explicitly.
The union above is the current r185 `KTX2Loader` contract and does not imply
that WebGL GLSL materials or composer passes work with WebGPU.

The shown two-plus-two workers are a starting budget, not a universal optimum.
Coordinate decoder workers with game, physics, audio, and asset-pipeline work;
lower the limits on constrained devices or when several worker pools coexist.
For explicit paths, call the factory with local URLs such as
`publicAssetUrl('decoders/draco/gltf/')` and
`publicAssetUrl('decoders/basis/')`.

## DRACO, KTX2, And Meshopt

### DRACO

DRACO compresses geometry. It can make files smaller but adds decoder startup
and CPU decode cost. Use it when measured delivery savings justify that cost.
The factory uses r185's exported `DRACO_GLTF_CONFIG` for the smaller bundled
WebAssembly-only glTF decoder. Omit that override to retain the general bundled
`.drc` decoder and JavaScript fallback, or provide a verified local path when
module-relative assets do not fit the deployment. Do not use deprecated
`setDecoderConfig()`.
Call `DRACOLoader.dispose()` only at final teardown; its decoder module cannot
be reloaded on that loader afterward.

### Meshopt

Meshopt compression and optimization are well suited to glTF geometry and
animation data. `GLTFLoader.setMeshoptDecoder(MeshoptDecoder)` must happen
before loading an asset using `KHR_meshopt_compression` or
`EXT_meshopt_compression`. Keep the decoder module bundled from the same Three
package.

### KTX2/Basis

KTX2 allows GPU-supported compressed texture formats. Run
`detectSupport(renderer)` after renderer initialization. Test normal maps,
alpha edges, color maps, and mip behavior on representative desktop and mobile
GPUs. Compression is not automatically higher quality; choose encoders and
settings per texture role. Reuse one configured loader; creating several
transcoder worker pools wastes memory and startup time. Like DRACO disposal,
`KTX2Loader.dispose()` belongs to final loader-stack teardown.

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

  for (const clip of clips) {
    if (!clip.validate()) throw new Error(`Invalid animation clip: ${clip.name}`);
  }

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

Every bone used by a skinned mesh must be a descendant of the object passed to
`SkeletonUtils.clone()`. Clone the common authored ancestor (normally the glTF
scene), not an isolated mesh whose bones live elsewhere. Use
`SkeletonUtils.retarget()` or `retargetClip()` only after validating both rigs'
rest poses, bone mapping, scale, and root-motion policy.

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

await renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  mixer.update(Math.min(timer.getDelta(), 0.1));
  renderer.render(scene, camera);
});

async function disposeAnimationLoop() {
  await renderer.setAnimationLoop(null);
  mixer.stopAllAction();
  mixer.uncacheRoot(gltf.scene);
  timer.dispose();
}
```

Keep gameplay simulation on its fixed-step clock. Visual animation can use the
render delta unless animation events are authoritative game rules. Never call
deprecated `Clock`, and do not query a timing source twice to derive unrelated
deltas. A connected `Timer` owns page-visibility listeners, so always call
`timer.dispose()` during teardown.

## Production Animation State Machine

Map semantic game states to clip names once. Start the next action before the
crossfade so it can receive weight:

```ts
type AnimationState = 'idle' | 'walk' | 'run' | 'hit' | 'death';
type TransitionOptions = {
  fadeSeconds?: number;
  once?: boolean;
  warp?: boolean;
};

class CharacterAnimator {
  private readonly root: THREE.Object3D;
  private readonly mixer: THREE.AnimationMixer;
  private readonly actions = new Map<AnimationState, THREE.AnimationAction>();
  private current?: THREE.AnimationAction;

  constructor(root: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.root = root;
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
      if (!clip.validate()) {
        throw new Error(`Invalid animation clip: ${clipName}`);
      }
      this.actions.set(
        state as AnimationState,
        this.mixer.clipAction(clip), // cached for this clip/root pair
      );
    }
  }

  play(state: AnimationState, options: TransitionOptions = {}) {
    const {
      fadeSeconds = 0.2,
      once = false,
      warp = false,
    } = options;
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
      previous.crossFadeTo(next, fadeSeconds, warp);
    }
    else next.fadeIn(fadeSeconds);
    this.current = next;
  }

  update(deltaSeconds: number) {
    this.mixer.update(deltaSeconds);
  }

  dispose() {
    this.mixer.stopAllAction();
    this.mixer.uncacheRoot(this.root);
    this.actions.clear();
    this.current = undefined;
  }
}
```

Drive this class from canonical movement/combat state, not directly from key
events. Add hysteresis to walk/run thresholds so speed noise does not restart
crossfades. Do not restart a looping action every update. Set `warp: true` only
for a transition that intentionally reconciles different clip durations by
changing effective time scales; it is not a universal crossfade-quality flag.

For a one-shot such as `hit`, listen for the mixer's `finished` event using a
stored callback, verify `event.action`, then return to the locomotion state.
Remove the listener at teardown. Start it with an explicit policy such as
`animator.play('hit', { once: true, warp: false })`; do not rely on the default
infinite loop.

`clipAction()` returns the cached action for the same clip/root pair. Cache the
action as above instead of looking it up in the frame loop. Before selective
eviction, stop the action and call `uncacheAction(clip, root)`. Use
`uncacheClip(clip)` only when that mixer no longer needs any action for the
clip. Final teardown must stop actions before `uncacheRoot(root)` and must not
reuse stale action references afterward. If using `AnimationObjectGroup`, also
call `group.uncache(object)` for objects permanently removed from the group.

## One-Shots, Additive Layers, Morphs, And Root Motion

### Additive layers

Use an additive clip for breathing, recoil, or aim offsets over a base pose:

```ts
const additiveClip = THREE.AnimationUtils.makeClipAdditive(
  sourceClip.clone(),
  0,             // reference frame
  referenceClip, // optional separate reference-pose clip
  30,            // authored frames per second
);
const additiveAction = mixer.clipAction(additiveClip);
additiveAction.setEffectiveWeight(0.35).play();
```

Create additive clips once, not during the frame loop. Confirm the reference
pose, authored frame rate, and affected bones match the rig.

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

- **Decoder 404 or MIME error:** the bundler did not emit an r185
  module-relative support file, or an explicit local fallback path/version/MIME
  type is wrong.
- **KTX2 throws before loading:** renderer support detection happened before
  awaited renderer initialization, or was skipped.
- **Model loads but is invisible:** scale, bounds, camera, material lighting,
  layers, or local URL is wrong; inspect rather than applying folklore scale.
- **Textures are flipped or colors wrong:** code overwrote glTF loader-managed
  texture orientation/color space.
- **Loading reaches 100% despite a failure:** manager completion counts ended
  items; inspect the tracked failure set.
- **Retry marks ready while old work continues:** the batch used fail-fast
  `Promise.all`, relied on abort alone, or did not guard and dispose late
  fulfilled results.
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

Use an application asset cache for parsed glTF sources, with reference counts
for borrowers and one final disposer. `THREE.Cache` is disabled by default. In
r185 it is the shared URL-keyed response/image cache consulted directly by
`FileLoader`, `ImageLoader`, and `ImageBitmapLoader` (and therefore indirectly
by loaders that delegate to them). It does not cache parsed glTF scenes,
mixers, decoder workers, materials, textures as GPU resources, or other
application ownership objects. `THREE.Cache.clear()` only drops cache entries;
it does not dispose GPU resources or call lifecycle methods such as
`ImageBitmap.close()`.

Warm only measured, first-visible critical resources while loading UI is still
present. Initialize WebGPU first, finish the scene's production lights,
environment, and material feature set, then compile:

```ts
async function warmCriticalGpuResources(
  renderer: CompressionAwareRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
  criticalTextures: readonly THREE.Texture[],
) {
  for (const texture of criticalTextures) renderer.initTexture(texture);
  await renderer.compileAsync(scene, camera);
}
```

`initTexture()` and `compileAsync()` reduce predictable upload/shader hitches;
they do not prove a hitch-free first frame. Measure the production path and do
not warm every optional asset indiscriminately.

## Disposal And Ownership

Use this ownership split:

- Loader stack owns decoder workers/modules and disposes them at application
  teardown.
- Asset cache owns source glTF geometry, materials, textures, clips, and the
  complete `gltf.scenes` collection.
- Game instance owns its container, mixer, listeners, and instance-specific
  material clones.
- A borrower never disposes shared source resources directly.

On final source release, traverse every glTF scene and deduplicate resources.
This also handles GPU allocations owned directly by instanced/batched objects
and lights, rather than assuming geometry/material traversal is complete:

```ts
function disposeModelSource(roots: Iterable<THREE.Object3D>) {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const textures = new Set<THREE.Texture>();
  const skeletons = new Set<THREE.Skeleton>();
  const instancedMeshes = new Set<THREE.InstancedMesh>();
  const batchedMeshes = new Set<THREE.BatchedMesh>();
  const lights = new Set<THREE.Light>();
  const imageBitmaps = new Set<ImageBitmap>();

  for (const root of roots) {
    root.traverse((object) => {
      const renderable = object as THREE.Object3D & {
        geometry?: THREE.BufferGeometry;
        material?: THREE.Material | THREE.Material[];
        skeleton?: THREE.Skeleton;
      };
      if (object instanceof THREE.InstancedMesh) instancedMeshes.add(object);
      if (object instanceof THREE.BatchedMesh) batchedMeshes.add(object);
      if (object instanceof THREE.Light) lights.add(object);
      if (renderable.skeleton instanceof THREE.Skeleton) {
        skeletons.add(renderable.skeleton);
      }
      // BatchedMesh.dispose() owns its internal aggregate geometry.
      if (
        !(object instanceof THREE.BatchedMesh) &&
        renderable.geometry?.isBufferGeometry
      ) {
        geometries.add(renderable.geometry);
      }
      const list = Array.isArray(renderable.material)
        ? renderable.material
        : renderable.material
          ? [renderable.material]
          : [];
      for (const material of list) materials.add(material);
    });
  }

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
  for (const object of instancedMeshes) object.dispose();
  for (const object of batchedMeshes) object.dispose();
  for (const light of lights) light.dispose();
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
discovery for custom shader/node uniforms and extension/plugin resources;
scanning direct material properties covers built-in material map slots, not
arbitrary nested uniform structures. Environment/PMREM render targets, scene
backgrounds, post passes, controls, and loader stacks require their own
explicit owners because they are not discovered by model traversal.

## Verification

1. Run the production build with runtime outbound network disabled and confirm
   every model, decoder, transcoder, texture, and HDR request is local.
2. Test an ordinary GLB, DRACO GLB, every KHR/EXT Meshopt variant used by the
   project, and KTX2 textures; configuration alone is not evidence.
3. Simulate a missing required model, corrupt file, missing decoder, and decode
   failure. Start a retry before the first attempt settles; verify best-effort
   abort, attempt isolation, late-result disposal, and no false-ready state.
4. Log bounds, scale, pivot, node/socket contract, materials, skins, morphs,
   clips, durations, and track counts during asset intake.
5. Instantiate at least two animated skinned copies and confirm independent
   poses with deliberately different actions/times.
6. Exercise every locomotion transition repeatedly around threshold speeds,
   compare warped and unwarped transitions deliberately, and run every one-shot
   through finish, interruption, replay, death, pause, and retry.
7. Compare gameplay collision position with the visual root through root-motion
   clips.
8. On WebGPU, verify `init()` or `setAnimationLoop()` was awaited before KTX2
   detection. Profile load/decode/upload/compile/first-render and mixer update
   in the worst content state.
9. Replace and dispose an HDR environment/PMREM owner, then unload every
   `gltf.scenes` root. Verify workers, listeners, timers, mixers, specialized
   objects, geometries, materials, and textures return to the same warmed
   steady state after repeated reloads.

## Official Documentation

- [Loading 3D models](https://threejs.org/manual/en/loading-3d-models.html)
- [LoadingManager](https://threejs.org/docs/pages/LoadingManager.html)
- [Cache](https://threejs.org/docs/pages/Cache.html)
- [Loader.loadAsync](https://threejs.org/docs/pages/Loader.html)
- [GLTFLoader](https://threejs.org/docs/pages/GLTFLoader.html)
- [DRACOLoader](https://threejs.org/docs/pages/DRACOLoader.html)
- [r185 DRACOLoader bundled configuration](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/loaders/DRACOLoader.js)
- [KTX2Loader](https://threejs.org/docs/pages/KTX2Loader.html)
- [r185 KTX2Loader bundled transcoder](https://github.com/mrdoob/three.js/blob/r185/examples/jsm/loaders/KTX2Loader.js)
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
- [Renderer](https://threejs.org/docs/pages/Renderer.html)
- [InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html)
- [BatchedMesh](https://threejs.org/docs/pages/BatchedMesh.html)
- [Light](https://threejs.org/docs/pages/Light.html)
- [How to dispose of objects](https://threejs.org/manual/en/how-to-dispose-of-objects.html)

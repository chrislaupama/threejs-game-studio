# Three.js Game Fundamentals

## Contents

- Local project baseline
- Scene graph and transform ownership
- Perspective and orthographic cameras
- Minimal render loop with `Timer`
- Fixed-step game simulation
- Responsive canvas and pixel budget
- Loading and failure boundaries
- Pause, restart, and lifecycle ownership
- Disposal and verification

Build one understandable scene, one camera, one renderer, and one loop before
adding systems. Keep browser runtime code and assets local; documentation links
are citations, never runtime imports.

Asset-loading examples use the project-owned `publicAssetUrl()` helper from
`local-assets.md`; import it from the local asset boundary in real code.

## Local Project Baseline

Install and pin the local package:

```bash
npm install three@0.185.1
npm install --save-dev @types/three@0.185.1 vite typescript
```

Use one canvas owned by the renderer:

```html
<canvas id="game" aria-label="Game view"></canvas>
```

```css
html,
body {
  width: 100%;
  height: 100%;
  margin: 0;
  overflow: hidden;
}

#game {
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
}
```

Import package modules rather than globals or CDN URLs:

```ts
import * as THREE from 'three';
```

Follow the official [installation](https://threejs.org/manual/en/installation.html)
and [creating a scene](https://threejs.org/manual/en/creating-a-scene.html)
guides, while preserving the local-only runtime boundary.

## Scene Graph Mental Model

Three.js scenes are trees of [Object3D](https://threejs.org/docs/pages/Object3D.html)
nodes. A child's transform is relative to its parent. Group parts that move as
one semantic object, and keep authoritative gameplay state outside the visual
tree.

```ts
const scene = new THREE.Scene();
scene.background = new THREE.Color(0x10131a);

const actor = new THREE.Group();
actor.name = 'player';
scene.add(actor);

const hull = new THREE.Mesh(
  new THREE.BoxGeometry(1.2, 0.35, 2.2),
  new THREE.MeshStandardMaterial({
    color: 0x2d7ff9,
    metalness: 0.15,
    roughness: 0.48,
  }),
);
hull.position.y = 0.45;
actor.add(hull);

const noseMarker = new THREE.Mesh(
  new THREE.ConeGeometry(0.18, 0.55, 12),
  new THREE.MeshBasicMaterial({ color: 0xffcc33 }),
);
noseMarker.rotation.x = -Math.PI / 2;
noseMarker.position.set(0, 0.45, -1.3);
actor.add(noseMarker);

// Move the semantic root. Do not independently move every visual child.
actor.position.set(0, 0, 4);
actor.rotation.y = Math.PI * 0.25;
```

Use these ownership rules:

- Keep one root per actor, pickup, projectile, or world chunk.
- Put model-axis, scale, and pivot correction under an asset wrapper. Move the
  wrapper's parent for gameplay.
- Keep collision shapes and gameplay coordinates authoritative; copy or
  interpolate them into the visual root.
- Avoid mutating a child's world transform as though it were local.
- Use `Object3D.attach(child)` when reparenting must preserve world transform.
- Call `updateMatrixWorld(true)` before querying world transforms outside the
  normal render update.
- Reuse target vectors in hot paths to avoid allocation.

```ts
const worldPosition = new THREE.Vector3();
actor.updateMatrixWorld(true);
actor.getWorldPosition(worldPosition);
```

Read the official [scene-graph guide](https://threejs.org/manual/en/scenegraph.html)
before building nested vehicles, weapons, camera rigs, skeletal attachments, or
world chunks.

## Coordinate And Scale Contract

Three.js uses a right-handed coordinate system. A default camera looks along
its local negative Z axis and has positive Y as up. Choose and document the
game's forward convention; do not infer it separately in movement, art, camera,
and collision code.

Use a deliberate world scale. For ordinary non-XR games, choose units that keep
camera clips, movement speeds, and model sizes understandable. For WebXR, use
**one Three.js unit as one meter** as required by the official
[WebXR basics guide](https://threejs.org/manual/en/webxr-basics.html).

Avoid enormous coordinate magnitudes. Partition or recenter large worlds, keep
the camera near the active simulation region, and keep the near/far range as
tight as the design permits.

## Camera Fundamentals

Use [PerspectiveCamera](https://threejs.org/docs/pages/PerspectiveCamera.html)
for most 3D games:

```ts
const camera = new THREE.PerspectiveCamera(
  55,   // vertical field of view in degrees
  1,    // corrected by resize
  0.1,  // near; must be positive
  500,  // far
);
camera.position.set(0, 4.5, 8);
camera.lookAt(0, 0.8, 0);
```

Set `near` high enough and `far` low enough to preserve depth precision. Do not
use `near = 0`. Keep important gameplay geometry away from both clip planes.
After changing `fov`, `aspect`, `near`, `far`, `zoom`, or orthographic bounds,
call `camera.updateProjectionMatrix()`.

Use [OrthographicCamera](https://threejs.org/docs/pages/OrthographicCamera.html)
for fixed-scale strategy, board, isometric, or world-overlay views:

```ts
const viewHeight = 20;
const aspect = 16 / 9;
const camera = new THREE.OrthographicCamera(
  -(viewHeight * aspect) / 2,
  (viewHeight * aspect) / 2,
  viewHeight / 2,
  -viewHeight / 2,
  0.1,
  200,
);
camera.position.set(12, 16, 12);
camera.lookAt(0, 0, 0);
```

Recompute left/right bounds on resize while preserving the intended vertical
world span. Do not change orthographic world scale accidentally when the canvas
aspect changes.

## Minimal Current Render Loop

Use [Timer](https://threejs.org/docs/pages/Timer.html), not deprecated `Clock`.
Connect it to the document so visibility changes are handled, call
`update(timestamp)` exactly once per rendered frame, and let the renderer own
the frame callback with `setAnimationLoop()`.

```ts
import * as THREE from 'three';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) throw new Error('Missing #game canvas');

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.1, 500);
const timer = new THREE.Timer();
timer.connect(document);

let paused = false;

renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const deltaSeconds = Math.min(timer.getDelta(), 0.1);

  if (!paused) {
    updateGame(deltaSeconds);
  }

  resizeRendererToDisplaySize(renderer, camera);
  renderer.render(scene, camera);
});

function updateGame(deltaSeconds: number) {
  // Consume input intents, update gameplay, animation, camera, UI/audio bridge.
}
```

`WebGLRenderer` requires WebGL 2. Catch construction failure at the app shell
and replace the canvas with an accessible, project-local error/retry surface. A
blank canvas is not an acceptable unsupported-device state. In a strict
local-only build, do not copy `WebGL.getWebGL2ErrorMessage()` unchanged: r185's
default message contains an external help link; write local text instead.

Use `setAnimationLoop()` even when XR is not yet required. It is the official
renderer loop, supports WebXR, and lets `WebGPURenderer` complete asynchronous
initialization before its first frame. See
[WebGLRenderer.setAnimationLoop](https://threejs.org/docs/pages/WebGLRenderer.html)
and the [WebGPURenderer guide](https://threejs.org/manual/en/webgpurenderer).

## Fixed-Step Simulation

Run timing-sensitive gameplay and collision at a fixed step. Render at the
browser cadence and interpolate visual state where useful:

```ts
const FIXED_STEP = 1 / 60;
const MAX_FRAME_DELTA = 0.1;
const MAX_STEPS_PER_FRAME = 5;

let accumulator = 0;
let paused = false;

renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const frameDelta = Math.min(timer.getDelta(), MAX_FRAME_DELTA);

  if (!paused) {
    accumulator += frameDelta;

    let steps = 0;
    while (!paused && accumulator >= FIXED_STEP && steps < MAX_STEPS_PER_FRAME) {
      sampleInputIntoIntents();
      previousState.copy(currentState);
      simulate(currentState, FIXED_STEP);
      accumulator -= FIXED_STEP;
      steps += 1;
    }

    if (
      steps === MAX_STEPS_PER_FRAME &&
      accumulator >= FIXED_STEP
    ) {
      // Drop excess backlog instead of freezing in a catch-up spiral.
      accumulator = 0;
    }
  }

  const alpha = paused ? 1 : accumulator / FIXED_STEP;
  presentInterpolated(previousState, currentState, alpha);
  resizeRendererToDisplaySize(renderer, camera);
  renderer.render(scene, camera);
});
```

Keep this order stable:

```text
device events -> input intents -> fixed simulation -> rules/state transitions
-> animation/VFX -> camera -> UI/audio bridge -> render
```

Do not multiply already frame-independent values by delta again. Do not feed a
single large inactive-tab delta into movement, particles, or `AnimationMixer`.
This interactive policy clears excess backlog after five catch-up steps. Use
the same policy in the starter, physics, and implementation recipes. A
deterministic offline replay is different: it must process every recorded step
without a real-time render deadline instead of dropping time.

## Responsive Canvas And Pixel Budget

CSS display size and drawing-buffer size are different. Resize only when the
display size or capped device-pixel ratio changes, and pass `false` so Three.js
does not overwrite the canvas CSS size. Follow the official
[responsive-rendering guide](https://threejs.org/manual/en/responsive.html).

```ts
let activePixelRatio = 0;
let activeDisplayWidth = 0;
let activeDisplayHeight = 0;
const MAX_DRAWING_BUFFER_PIXELS = 1920 * 1080;

function resizeRendererToDisplaySize(
  renderer: THREE.WebGLRenderer,
  camera: THREE.PerspectiveCamera,
) {
  const canvas = renderer.domElement;
  const displayWidth = Math.max(1, canvas.clientWidth);
  const displayHeight = Math.max(1, canvas.clientHeight);
  const requestedPixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
  const budgetPixelRatio = Math.sqrt(
    MAX_DRAWING_BUFFER_PIXELS / (displayWidth * displayHeight),
  );
  const pixelRatio = Math.min(requestedPixelRatio, budgetPixelRatio);
  if (
    activePixelRatio === pixelRatio &&
    activeDisplayWidth === displayWidth &&
    activeDisplayHeight === displayHeight
  ) {
    return false;
  }

  activePixelRatio = pixelRatio;
  activeDisplayWidth = displayWidth;
  activeDisplayHeight = displayHeight;
  renderer.setPixelRatio(pixelRatio);
  renderer.setSize(displayWidth, displayHeight, false);
  camera.aspect = displayWidth / displayHeight;
  camera.updateProjectionMatrix();
  return true;
}
```

Cap both DPR and total drawing-buffer pixels against a measured device budget;
a DPR cap alone can still allocate a huge 4K buffer. The `1920 * 1080` value is
a conservative starting point, not a universal target. If a composer or render
target exists, resize it through the same owner in the same transaction.

For an orthographic camera, preserve vertical world height:

```ts
function resizeOrtho(camera: THREE.OrthographicCamera, aspect: number) {
  const height = 20;
  camera.left = -(height * aspect) / 2;
  camera.right = (height * aspect) / 2;
  camera.top = height / 2;
  camera.bottom = -height / 2;
  camera.updateProjectionMatrix();
}
```

## Loading And Failure Boundaries

Load only project-local URLs. Prefer `loadAsync()` where the loader supports it
and present loading, failure, retry, and cancellation states. Use
[LoadingManager](https://threejs.org/docs/pages/LoadingManager.html) when
multiple assets form one transition.

```ts
const manager = new THREE.LoadingManager();
manager.onStart = () => setLoadingVisible(true);
manager.onProgress = (_url, loaded, total) => setProgress(loaded / total);
manager.onLoad = () => setLoadingVisible(false);
manager.onError = (url) => showAssetError(url);

const textureLoader = new THREE.TextureLoader(manager);

async function loadLocalColorTexture() {
  const texture = await textureLoader.loadAsync(
    publicAssetUrl('assets/textures/ground.webp'),
  );
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
```

Annotate base-color and emissive textures with `SRGBColorSpace`. Keep normal,
roughness, metalness, AO, displacement, and other data textures at
`NoColorSpace`. See the official
[color-management guide](https://threejs.org/manual/en/color-management.html).

Do not assume `FileLoader.load()` or `ImageBitmapLoader.load()` returns a
request in r185.1. Keep abort/cancellation ownership explicit and inspect the
specific loader's current API.

## Pause, Restart, And Ownership

Separate game pause from renderer lifetime:

- Continue updating the `Timer` while paused so resume cannot produce a large
  delta.
- Stop simulation, spawning, AI, mixer progress, and positional audio according
  to the game's pause contract.
- Render a stable paused frame when UI or camera feedback still changes.
- Clear the fixed-step accumulator on restart and after discontinuous state
  loads.
- Reset input edge state so a held key or controller button cannot trigger a
  duplicate action after resume.
- Make one owner responsible for `setAnimationLoop`, resize, and teardown.

Use an explicit lifecycle:

```ts
type GamePhase = 'loading' | 'playing' | 'paused' | 'won' | 'failed' | 'disposed';

let phase: GamePhase = 'loading';

function pause() {
  if (phase === 'playing') phase = 'paused';
}

function resume() {
  if (phase === 'paused') {
    accumulator = 0;
    phase = 'playing';
  }
}

function restart() {
  clearTransientEntities();
  resetDeterministicState();
  resetInputEdges();
  accumulator = 0;
  phase = 'playing';
}
```

## Disposal

Removing an object from a scene does not release its GPU allocations. Dispose
owned geometries, materials, textures, render targets, skeletons, controls,
post-processing passes, loaders/workers, and renderer resources. Follow the
[disposal guide](https://threejs.org/manual/en/how-to-dispose-of-objects.html)
and [resource-tracker pattern](https://threejs.org/manual/en/cleanup.html).

```ts
function disposeObjectTree(root: THREE.Object3D) {
  const textures = new Set<THREE.Texture>();
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  const skeletons = new Set<THREE.Skeleton>();

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
    const list = Array.isArray(renderable.material)
      ? renderable.material
      : renderable.material
        ? [renderable.material]
        : [];

    for (const material of list) {
      if (!material) continue;
      materials.add(material);

      for (const value of Object.values(material)) {
        if (value && (value as THREE.Texture).isTexture) {
          textures.add(value as THREE.Texture);
        }
      }
    }
  });

  for (const texture of textures) {
    texture.dispose();
    const source = texture.source.data as { close?: () => void } | undefined;
    source?.close?.(); // only because this function owns the texture source
  }
  for (const skeleton of skeletons) skeleton.dispose();
  for (const material of materials) material.dispose();
  for (const geometry of geometries) geometry.dispose();
  root.removeFromParent();
}
```

Dispose only resources the owner owns. Shared materials, textures, geometries,
skeletons, and environment maps require reference or catalog ownership rather
than blind traversal. `ImageBitmap` sources can also require `close()` after
their textures are no longer used. Register textures hidden in shader uniforms,
node graphs, arrays, caches, or render pipelines explicitly; a shallow material
property scan cannot discover every custom resource.

Application teardown order:

```ts
async function disposeGame() {
  phase = 'disposed';
  await renderer.setAnimationLoop(null);

  controls?.dispose();
  mixer?.stopAllAction();
  if (animatedRoot) mixer?.uncacheRoot(animatedRoot);

  // Scene traversal does not discover environment/background ownership.
  if (scene.environment === ownedEnvironment) scene.environment = null;
  if (scene.background === ownedBackground) scene.background = null;
  ownedEnvironment?.dispose();
  if (ownedBackground !== ownedEnvironment) ownedBackground?.dispose();

  for (const light of ownedShadowLights) light.dispose();
  disposeObjectTree(scene);
  standaloneRenderTarget?.dispose();
  for (const pass of [...ownedPasses].reverse()) pass.dispose();
  composer?.dispose();
  timer.dispose();
  renderer.dispose();

  canvas.remove();
}
```

Adapt optional names to the actual project. Do not separately dispose a render
target already owned by the composer. Remove DOM, pointer, keyboard, gamepad,
visibility, and audio listeners through the same lifecycle owner.

## Fundamentals Verification

Before adding deep gameplay or rendering polish, prove:

- The installed package and lockfile agree on `0.185.1` or the preserved
  project version.
- Imports resolve locally and the production preview performs no outbound
  runtime requests.
- The canvas is nonblank, camera framing is intentional, and no object is
  hidden by clip planes.
- Movement speed remains stable at 30, 60, 90, and 120 Hz render cadence.
- A simulated one-second frame stall does not launch objects or spiral the
  fixed-step loop.
- Resize and orientation changes preserve composition and update projection.
- Pause/resume does not jump simulation time.
- Restart does not duplicate loops, listeners, actors, mixers, or audio.
- Repeated enter/exit returns `renderer.info.memory` near its steady baseline.
- Console, shader, page, and local-asset errors are captured and fixed.

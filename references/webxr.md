# WebXR Games With Three.js

## Contents

- Scope, units, and secure-context requirements
- WebGL and WebGPU renderer setup
- Session and reference-space configuration
- Controller, grip, hand, and gamepad input
- Ray interaction and teleport structure
- AR setup and hit-test lifecycle
- Comfort, accessibility, and spatial UI
- XR rendering and performance budgets
- Session cleanup and device QA

Treat WebXR as a distinct input, camera, scale, performance, and lifecycle mode.
Keep runtime code and assets local. Test on the actual target headset or mobile
AR device; desktop emulation is useful but cannot prove tracking, comfort,
controller mapping, floor scale, or sustained performance.

## Platform Contract

Use **one Three.js unit as one meter**. WebXR supplies headset pose, per-eye
projection, and field of view; do not animate or overwrite the active XR camera
as if it were a desktop camera. Move a player rig or reference-space origin for
locomotion while the headset remains user-controlled.

WebXR requires a secure context. `localhost` is suitable for same-machine
development, but a physical headset connecting over the network generally
needs a trusted HTTPS origin. Keep the device and development host on an
authorized local network and do not add a hosted runtime merely to obtain
HTTPS. See the official [WebXR basics guide](https://threejs.org/manual/en/webxr-basics.html).

Before implementation, record:

- Immersive VR, immersive AR, or both.
- Standing, seated, room-scale, bounded, or unbounded intent.
- Controller, hand, gaze, screen-touch, and accessibility input requirements.
- Dominant-hand switching and one-handed play requirements.
- Target devices, browsers, refresh rates, and minimum session frame budget.
- Locomotion, turning, teleport, vignette, height, and reduced-motion settings.
- Local controller/hand visual assets and offline behavior.

Keep the renderer-specific manager boundary explicit. `WebGLRenderer.xr` is a
[WebXRManager](https://threejs.org/docs/pages/WebXRManager.html);
`WebGPURenderer.xr` is the common
[XRManager](https://threejs.org/docs/pages/XRManager.html). Their session,
controller, hand, reference-space, framebuffer-scale, and foveation methods
overlap, but native WebGPU binding and common-renderer layer APIs belong to
`XRManager`. Verify manager-specific features against the installed revision.

Choose reference space from the product contract: `local-floor` for ordinary
standing VR, `bounded-floor` when the game consumes `boundsGeometry`, `local`
for seated VR/handheld AR, and feature-gated `unbounded` only after device
testing. Preserve a fallback. Use either player-rig transforms or an offset
reference space as locomotion owner; combining both causes double motion and
recenter bugs.

## Owned Session Entry

The stock `VRButton` and `ARButton` are convenient for page-lifetime examples,
but they do not expose the pending `requestSession()` promise. Removing their
DOM element cannot cancel or await a session that resolves after a route has
unmounted. They also install the session directly; in tagged r185,
`WebXRManager.setSession()` and `XRManager.setSession()` can retain the session
and listeners before a later reference-space or backend step rejects.
Specifically, r185 `VRButton` adds `local-floor` only as an optional feature
while `WebXRManager` defaults to that space. When the feature is not granted,
the manager's later `requestReferenceSpace('local-floor')` can reject and the
stock helper does not catch that setup failure or end the returned session.
Do not copy that flow into production lifecycle code.

Route-owned games need to own the complete asynchronous boundary. The helper
below:

- requests exactly the features declared by the product route;
- selects and probes a reference space granted to that session before calling
  the renderer manager;
- ends and awaits every session that fails setup or resolves after teardown;
- invalidates late work with a generation guard; and
- makes `dispose()` await pending entry before it ends any installed session.

```ts
type XrEntryRenderer = {
  xr: {
    getSession(): XRSession | null;
    setReferenceSpaceType(type: XRReferenceSpaceType): void;
    setSession(session: XRSession): Promise<void>;
  };
};

type OwnedXrEntry = {
  readonly element: HTMLButtonElement;
  dispose(): Promise<void>;
};

type OwnedXrEntryOptions = {
  mode: 'immersive-vr' | 'immersive-ar';
  sessionInit: XRSessionInit;
  // Ordered by product preference. Include `local` only when the game has a
  // deliberate seated/no-floor fallback and adapts its rules accordingly.
  referenceSpaceCandidates: readonly XRReferenceSpaceType[];
  idleLabel: string;
  activeLabel: string;
  onReferenceSpaceSelected(
    type: XRReferenceSpaceType,
    session: XRSession,
  ): void;
  onError(error: unknown): void;
};

const featureBackedReferenceSpaces = new Set<XRReferenceSpaceType>([
  'local-floor',
  'bounded-floor',
  'unbounded',
]);

async function selectGrantedReferenceSpace(
  session: XRSession,
  candidates: readonly XRReferenceSpaceType[],
): Promise<XRReferenceSpaceType> {
  const enabledFeatures = session.enabledFeatures
    ? new Set(session.enabledFeatures)
    : null;
  let lastError: unknown;

  for (const type of candidates) {
    // `enabledFeatures` is optional in current WebXR typings. When it exists,
    // avoid requesting a feature-backed space the session was not granted.
    if (
      enabledFeatures &&
      featureBackedReferenceSpaces.has(type) &&
      !enabledFeatures.has(type)
    ) {
      continue;
    }

    try {
      // The renderer manager will request its own instance during setSession().
      // This probe proves that its configured type is available first.
      await session.requestReferenceSpace(type);
      return type;
    } catch (error) {
      lastError = error;
    }
  }

  if (lastError) throw lastError;
  throw new Error('The XR session granted no supported reference space');
}

function createOwnedXrEntry(
  renderer: XrEntryRenderer,
  options: OwnedXrEntryOptions,
): OwnedXrEntry {
  if (options.referenceSpaceCandidates.length === 0) {
    throw new Error('At least one XR reference-space candidate is required');
  }

  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = options.idleLabel;
  element.setAttribute('aria-pressed', 'false');

  let disposed = false;
  let generation = 0;
  let entryPromise: Promise<void> | null = null;
  let disposePromise: Promise<void> | null = null;
  let installedSession: XRSession | null = null;
  let installedEndListener: (() => void) | null = null;

  function report(error: unknown): void {
    options.onError(error); // The reporter must not throw.
  }

  async function endSession(session: XRSession): Promise<void> {
    try {
      await session.end();
    } catch (error) {
      report(error);
    }
  }

  function unbindInstalledSession(): void {
    if (installedSession && installedEndListener) {
      installedSession.removeEventListener('end', installedEndListener);
    }
    installedSession = null;
    installedEndListener = null;
  }

  function bindInstalledSession(session: XRSession): void {
    unbindInstalledSession();
    installedSession = session;
    installedEndListener = () => {
      if (installedSession !== session) return;
      unbindInstalledSession();
      if (!disposed) {
        element.textContent = options.idleLabel;
        element.setAttribute('aria-pressed', 'false');
      }
    };
    session.addEventListener('end', installedEndListener);
  }

  async function enter(entryGeneration: number): Promise<void> {
    let session: XRSession | null = null;
    let sessionNeedsEnd = false;
    let didFail = false;
    let failure: unknown;

    try {
      const xr = navigator.xr;
      if (!xr) throw new Error('WebXR is unavailable');

      session = await xr.requestSession(options.mode, options.sessionInit);
      sessionNeedsEnd = true;

      if (disposed || entryGeneration !== generation) return;

      const referenceSpaceType = await selectGrantedReferenceSpace(
        session,
        options.referenceSpaceCandidates,
      );

      if (disposed || entryGeneration !== generation) return;

      renderer.xr.setReferenceSpaceType(referenceSpaceType);
      await renderer.xr.setSession(session);

      if (disposed || entryGeneration !== generation) return;
      if (renderer.xr.getSession() !== session) {
        throw new Error('The XR session ended while renderer setup was pending');
      }

      options.onReferenceSpaceSelected(referenceSpaceType, session);
      bindInstalledSession(session);
      sessionNeedsEnd = false;
      element.textContent = options.activeLabel;
      element.setAttribute('aria-pressed', 'true');
    } catch (error) {
      didFail = true;
      failure = error;
    } finally {
      // This covers a failed probe/setSession(), callback failure, and every
      // stale generation. Await end so renderer-manager cleanup can run before
      // the route destroys renderer-owned state.
      if (session && sessionNeedsEnd) await endSession(session);
    }

    // Surface entry failure only after the failed session has ended. Teardown
    // invalidates the generation and intentionally suppresses stale UI errors.
    if (didFail && !disposed && entryGeneration === generation) report(failure);
  }

  function handleClick(): void {
    if (disposed || entryPromise) return;

    const session = installedSession ?? renderer.xr.getSession();
    element.disabled = true;

    if (session) {
      entryPromise = endSession(session).finally(() => {
        entryPromise = null;
        if (!disposed) element.disabled = false;
      });
      return;
    }

    const entryGeneration = ++generation;
    entryPromise = enter(entryGeneration).finally(() => {
      entryPromise = null;
      if (!disposed && entryGeneration === generation) {
        element.disabled = false;
      }
    });
  }

  async function disposeOwnedEntry(): Promise<void> {
    disposed = true;
    generation += 1;
    element.disabled = true;
    element.removeEventListener('click', handleClick);
    element.remove();

    // `enter()` observes the stale generation and ends any session that
    // resolves late. Await it before looking for an already-installed session.
    const pendingEntry = entryPromise;
    if (pendingEntry) await pendingEntry;

    const session = installedSession ?? renderer.xr.getSession();
    unbindInstalledSession();
    if (session) await endSession(session);
  }

  element.addEventListener('click', handleClick);

  return {
    element,
    dispose() {
      disposePromise ??= disposeOwnedEntry();
      return disposePromise;
    },
  };
}
```

Keep `referenceSpaceCandidates` consistent with `sessionInit`. For a standing
experience that cannot work without floor-relative tracking, require
`local-floor` and provide only `['local-floor']`; an unsupported request then
rejects before returning a session. For a game with a real seated fallback,
request `local-floor` as optional, try `['local-floor', 'local']`, and change
height, locomotion, reach, and UI behavior in `onReferenceSpaceSelected`.

## Minimal WebGL VR Setup

Enable the renderer XR manager, enter through the owned boundary above, and use
`setAnimationLoop()`:

```ts
import * as THREE from 'three';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) throw new Error('Missing #game canvas');

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});

renderer.xr.enabled = true;

const sessionInit: XRSessionInit = {
  // This route supports a deliberate seated fallback. A standing-only game
  // should move `local-floor` to requiredFeatures instead.
  optionalFeatures: ['local-floor', 'hand-tracking'],
};

const ownedVrEntry = createOwnedXrEntry(renderer, {
  mode: 'immersive-vr',
  sessionInit,
  referenceSpaceCandidates: ['local-floor', 'local'],
  idleLabel: 'ENTER VR',
  activeLabel: 'EXIT VR',
  onReferenceSpaceSelected: (type) => {
    setXrFloorMode(type === 'local-floor' ? 'standing' : 'seated');
  },
  onError: (error) => showXrEntryError(error),
});
document.body.appendChild(ownedVrEntry.element);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(55, 1, 0.05, 200);
const timer = new THREE.Timer();
timer.connect(document);

renderer.setAnimationLoop((timestamp, xrFrame) => {
  timer.update(timestamp);
  const deltaSeconds = Math.min(timer.getDelta(), 0.1);
  updateGame(deltaSeconds, xrFrame);
  renderer.render(scene, camera);
});
```

Do not offer the `local` fallback merely to make entry succeed. The callback
must switch to a product-tested seated/no-floor mode; otherwise require
`local-floor` and fail clearly. Store `ownedVrEntry` in the same route owner as
the renderer and await its disposal during teardown.

The non-XR camera describes the base camera/player rig. While presenting, the
XR system supplies view cameras. Do not depend on the base camera's `fov` or
aspect to describe the headset view. The current
[WebXRManager](https://threejs.org/docs/pages/WebXRManager.html) notes that the
XR camera's exposed `fov` does not represent the per-view projection.

Do not use `window.requestAnimationFrame()` as a parallel game loop. One
`renderer.setAnimationLoop()` callback must own both desktop and XR rendering.

For `WebGLRenderer`, direct `renderer.render(scene, camera)` is the safe XR
baseline. Do not assume a desktop `EffectComposer` chain is stereo-correct or
XR-safe. Keep it disabled in-headset unless on-device tests prove both eyes,
render-target sizing, color conversion, teardown, and frame budget for the
installed revision.

## WebGPU XR Setup

Three.js r185 can install immersive sessions on `WebGPURenderer`, but native
WebGPU XR requires the session's `webgpu` feature. Route-owned games still use
the owned entry boundary above. This section is
**revision-pinned to tagged r185**: native WebGPU XR is experimental and is not
a forward-compatibility promise. Before every Three.js upgrade, verify the
installed `XRManager` source/types and the official
[WebGPU XR example](https://threejs.org/examples/webgpu_xr_cubes.html); fall
back to the construction-time WebGL route when that native path is absent.

```ts
import * as THREE from 'three/webgpu';

const renderer = new THREE.WebGPURenderer({
  // Desktop and WebGL fallback can retain these quality options. Tagged r185
  // temporarily disables MSAA and multiview only for native WebGPU XR.
  antialias: true,
  multiview: true,
  alpha: false,
});

// r185 chooses adapter XR compatibility during initialization.
renderer.xr.enabled = true;
await renderer.init();

const ownedNativeVrEntry = createOwnedXrEntry(renderer, {
  mode: 'immersive-vr',
  sessionInit: {
    requiredFeatures: ['webgpu'],
    optionalFeatures: ['local-floor'],
  },
  referenceSpaceCandidates: ['local-floor', 'local'],
  idleLabel: 'ENTER VR',
  activeLabel: 'EXIT VR',
  onReferenceSpaceSelected: (type) => {
    setXrFloorMode(type === 'local-floor' ? 'standing' : 'seated');
  },
  onError: (error) => showXrEntryError(error),
});
document.body.appendChild(ownedNativeVrEntry.element);

await renderer.setAnimationLoop(() => {
  renderer.render(scene, camera);
});
```

Keep that direct render call while an XR session is presenting. In r185,
`RenderPipeline.render()` temporarily disables XR, so a desktop TSL/node post
chain must be bypassed with an `renderer.xr.isPresenting` branch. Resume the
pipeline after the session ends. Do not promise WebGPU XR post-processing
unless an alternate path has been verified against the exact installed
revision and tested on the target headset.

Without the `webgpu` session feature, r185's native WebGPU XR manager rejects
session setup. If the experience must enter XR on devices whose XR runtime does
not expose that feature, choose a construction-time WebGL backend before
requesting the session. Do not forward the same session after a native
`setSession()` failure in r185: the native manager stores the session and
listeners before later reference-space/backend setup can reject. End that
session, wait for its manager cleanup, destroy the failed renderer, and make a
fresh session request against a new `WebGPURenderer({ forceWebGL: true })`.

```ts
import * as THREE from 'three/webgpu';

type XrBackendChoice = 'native-webgpu' | 'webgl-fallback';

function createRenderer(choice: XrBackendChoice) {
  const next = new THREE.WebGPURenderer({
    // Native r185 XR overrides samples/multiview while presenting; the WebGL
    // fallback can retain them when the device supports them.
    antialias: true,
    multiview: true,
    forceWebGL: choice === 'webgl-fallback',
    alpha: false,
    outputBufferType: THREE.UnsignedByteType,
  });
  next.xr.enabled = true;
  next.setSize(window.innerWidth, window.innerHeight);
  return next;
}

// Decide this before session entry from the supported product route. If a
// native attempt fails, rebuild with 'webgl-fallback' and require a new click
// and a new XRSession; never transfer the partially installed session.
const xrBackend: XrBackendChoice = chooseXrBackendBeforeEntry();
const renderer = createRenderer(xrBackend);
await renderer.init();
document.body.append(renderer.domElement);
await renderer.setAnimationLoop(() => renderer.render(scene, camera));

const ownedBackendVrEntry = createOwnedXrEntry(renderer, {
  mode: 'immersive-vr',
  sessionInit: {
    requiredFeatures: xrBackend === 'native-webgpu' ? ['webgpu'] : [],
    optionalFeatures: ['local-floor'],
  },
  referenceSpaceCandidates: ['local-floor', 'local'],
  idleLabel: 'ENTER VR',
  activeLabel: 'EXIT VR',
  onReferenceSpaceSelected: (type) => {
    setXrFloorMode(type === 'local-floor' ? 'standing' : 'seated');
  },
  onError: (error) => showXrEntryError(error),
});
document.body.append(ownedBackendVrEntry.element);
```

The fresh-retry owner must rebuild renderer-owned controllers, grips,
listeners, render targets, diagnostics, canvas attachment, and animation loop.
Validate both construction-time choices on-device; a desktop fallback test is
insufficient. The route-owned entry helper above provides the
generation guard and failed-session rollback that the stock buttons do not.

`setAnimationLoop()` ensures initialization before the first frame. Call
`await renderer.init()` first only when setup requires renderer methods before
that loop. Use node materials and TSL; do not use WebGL `ShaderMaterial`,
`onBeforeCompile`, or `EffectComposer`. See the official
[WebGPURenderer guide](https://threejs.org/manual/en/webgpurenderer).

Verify the WebGPU backend and `forceWebGL: true` fallback separately when both
are claimed. Record the XR session's enabled features. A desktop WebGPU success
does not prove headset-browser support. In r185, native WebGPU XR forces zero
MSAA samples and disables multiview; do not advertise those options as active
without a newer installed revision and on-device evidence.

## Player Rig And World Origin

Parent the base camera and locomotion-relative content under a semantic rig:

```ts
const playerRig = new THREE.Group();
playerRig.name = 'xr-player-rig';
scene.add(playerRig);
playerRig.add(camera);

// Keep camera local transform available to the XR system.
camera.position.set(0, 0, 0);
```

Apply artificial translation or snap rotation to `playerRig`, not to the
headset pose. Keep floor at world Y = 0 for `local-floor` unless the entire
experience deliberately uses another spatial contract.

Do not silently scale the rig or world after session entry. World scaling can
break reach, velocity, gravity, interaction distances, and comfort even when it
looks visually plausible.

## Session Lifecycle

Configure framebuffer scale before entering a session; it cannot be changed
while presenting. The owned entry helper selects and configures the proven
reference-space type immediately before `setSession()`, so lifecycle code must
not overwrite it:

```ts
renderer.xr.setFramebufferScaleFactor(0.85);

let activeSession: XRSession | null = null;

function unbindActiveSession() {
  activeSession?.removeEventListener(
    'visibilitychange',
    onSessionVisibilityChange,
  );
  activeSession = null;
}

function handleManagerSessionStart() {
  const session = renderer.xr.getSession();
  if (!session) return;

  unbindActiveSession();
  activeSession = session;
  session.addEventListener('visibilitychange', onSessionVisibilityChange);
}

function handleManagerSessionEnd() {
  unbindActiveSession();
  resetXrSessionInput();
  resetSimulationDelta();
}

renderer.xr.addEventListener('sessionstart', handleManagerSessionStart);
renderer.xr.addEventListener('sessionend', handleManagerSessionEnd);
handleManagerSessionStart(); // Also handles hot reload during an active session.
```

Both [WebXRManager](https://threejs.org/docs/pages/WebXRManager.html) and
[XRManager](https://threejs.org/docs/pages/XRManager.html) expose
`setFoveation()`. Use it only when supported and measured; do not assume a
setting has an effect on every device/backend.

Handle:

- Permission denial or unsupported session mode.
- Session start and end.
- Visibility blur/hidden states.
- Controller and hand connect/disconnect.
- Reference-space reset/recenter.
- Tracking loss and recovery.
- Page pause, route change, restart, and teardown.

Do not retain stale controller input or simulation delta across a hidden or
ended session. Resume through the same explicit game-state transition used by
desktop pause.

## Controller Target-Ray Input

`renderer.xr.getController(index)` returns target-ray space for pointing. Use
it for rays, cursors, selection, and teleport aim. Add a small project-authored
local line rather than depending on a remote controller model:

```ts
const rayGeometry = new THREE.BufferGeometry().setFromPoints([
  new THREE.Vector3(0, 0, 0),
  new THREE.Vector3(0, 0, -1),
]);
const rayMaterial = new THREE.LineBasicMaterial({ color: 0x7ce8ff });
const controllerRays: THREE.Line[] = [];

function createController(index: number) {
  const controller = renderer.xr.getController(index);
  controller.name = `xr-controller-${index}`;

  const ray = new THREE.Line(rayGeometry, rayMaterial);
  ray.name = 'target-ray';
  ray.scale.z = 4;
  controller.add(ray);
  controllerRays.push(ray);

  controller.addEventListener('selectstart', onSelectStart);
  controller.addEventListener('selectend', onSelectEnd);
  controller.addEventListener('squeezestart', onSqueezeStart);
  controller.addEventListener('squeezeend', onSqueezeEnd);
  controller.addEventListener('connected', onControllerConnected);
  controller.addEventListener('disconnected', onControllerDisconnected);

  playerRig.add(controller);
  return controller;
}

const controllers = [createController(0), createController(1)];
```

Convert select/squeeze events into semantic intents such as `primaryAction`,
`grab`, `teleportCommit`, or `menuConfirm`. Do not put game rules directly in
DOM/XR event callbacks.

Both renderer managers distinguish target-ray from grip space; see
[WebXRManager](https://threejs.org/docs/pages/WebXRManager.html) and
[XRManager](https://threejs.org/docs/pages/XRManager.html). Keep that
distinction explicit.

## Grip And Local Controller Visuals

`renderer.xr.getControllerGrip(index)` represents the held device pose. Attach
held objects or a project-local controller proxy there:

```ts
const gripGeometry = new THREE.BoxGeometry(0.04, 0.1, 0.16);
const gripMaterial = new THREE.MeshStandardMaterial({
  color: 0x303845,
  metalness: 0.1,
  roughness: 0.65,
});
const gripProxies: THREE.Mesh[] = [];

function createGrip(index: number) {
  const grip = renderer.xr.getControllerGrip(index);
  grip.name = `xr-grip-${index}`;

  const proxy = new THREE.Mesh(gripGeometry, gripMaterial);
  proxy.position.z = 0.02;
  grip.add(proxy);
  gripProxies.push(proxy);
  playerRig.add(grip);
  return grip;
}

const grips = [createGrip(0), createGrip(1)];
```

The official `XRControllerModelFactory` can fetch device profile/model data.
Do not use its default remote-fetching behavior in an offline game. Use a local
generic proxy or a fully vendored, verified local profile/model pipeline; prove
that session entry makes no outbound request.

Attach a pointing ray to `getController()` and held visuals to
`getControllerGrip()`. Do not parent one space under the other.

## Continuous Axes And Buttons

Store each connected `XRInputSource` from the controller's `connected` event,
then poll its `gamepad` once per frame. Map profile-specific axes/buttons into
semantic intents through a tested binding layer:

```ts
const inputSources: Array<XRInputSource | undefined> = [];

type XrMoveBinding = Readonly<{ xAxis: number; yAxis: number }>;

// Project-owned data from locally vendored, device-tested profiles.
const profileBindings: Readonly<Record<string, XrMoveBinding>> =
  loadLocalXrMoveBindings();

function resolveMoveBinding(source: XRInputSource): XrMoveBinding | null {
  for (const profile of source.profiles) {
    const binding = profileBindings[profile];
    if (binding) return binding;
  }
  return null;
}

const filteredAxis = { x: 0, y: 0 };

const inputBindings = controllers.map((controller, index) => {
  const connected = (event: { data: XRInputSource }) => {
    inputSources[index] = event.data;
  };
  const disconnected = () => {
    inputSources[index] = undefined;
    clearControllerIntents(index);
  };

  controller.addEventListener('connected', connected);
  controller.addEventListener('disconnected', disconnected);
  return { controller, connected, disconnected };
});

function sampleXrGamepads() {
  for (let index = 0; index < inputSources.length; index += 1) {
    const source = inputSources[index];
    const gamepad = source?.gamepad;
    const binding = source ? resolveMoveBinding(source) : null;
    if (!gamepad || !binding) {
      clearControllerIntents(index);
      continue;
    }

    applyRadialDeadZone(
      gamepad.axes[binding.xAxis] ?? 0,
      gamepad.axes[binding.yAxis] ?? 0,
      0.18,
      filteredAxis,
    );
    setMoveIntent(index, filteredAxis.x, filteredAxis.y);
  }
}
```

Axis and button layouts vary. Inspect `XRInputSource.profiles`, handedness, and
actual device behavior. Never assume a single Oculus-style index mapping is
universal, and do not silently guess when no local mapping matches. Derive
button pressed/released edges from previous sampled state rather than relying on
one controller's fixed indices. Clear held/edge state on disconnect, visibility
loss, pause, and session end.

## Hand Tracking

Request hand tracking as optional unless the experience requires it and has a
controller/gaze fallback:

```ts
const hand0 = renderer.xr.getHand(0);
const hand1 = renderer.xr.getHand(1);
playerRig.add(hand0, hand1);

function resetXrSessionInput() {
  inputSources.fill(undefined);
  clearAllControllerIntents();

  // The r185 managers cache these roots by index. Hide and reset cached poses
  // between sessions so re-entry cannot display a stale last-frame transform.
  for (const root of [...controllers, ...grips, hand0, hand1]) {
    root.visible = false;
    root.position.set(0, 0, 0);
    root.quaternion.identity();
    root.scale.set(1, 1, 1);
    root.updateMatrix();
  }
}
```

Use hand joints for measured pinch/grab/pose recognition. Add hysteresis so a
noisy threshold cannot flicker each frame. Preserve accessibility with larger
targets, dwell or controller alternatives, configurable handedness, and no
requirement for extreme reach.

Keep hand visuals local. If using a hand-model addon, inspect all model and
profile requests and vendor the required data; do not introduce hidden runtime
network dependencies.

## XR Raycasting

Use the current [Raycaster.setFromXRController](https://threejs.org/docs/pages/Raycaster.html)
method and a curated interactable list:

```ts
const raycaster = new THREE.Raycaster();
raycaster.far = 8;
raycaster.layers.set(2);

const hits: THREE.Intersection[] = [];

function findXrHit(controller: THREE.XRTargetRaySpace) {
  hits.length = 0;
  raycaster.setFromXRController(controller);
  raycaster.intersectObjects(interactables, true, hits);
  return hits[0];
}
```

Results are nearest-first. Use layers and explicit candidate arrays. Update
visual hover state separately from commit. Make targets large enough at the
intended distance, provide cursor/depth feedback, and preserve a stable
selection during small tracking jitter.

`firstHitOnly` is not a core `Raycaster` property. If a project adds a spatial
acceleration package, isolate and document that extension rather than treating
it as Three.js behavior.

## Teleport Structure

Build teleport as a validated state machine:

```text
idle -> aiming -> valid-target | invalid-target -> commit -> comfort-fade
-> move player rig -> fade-in -> idle
```

- Raycast only approved walkable surfaces.
- Validate capsule/feet clearance, slope, nav region, boundary, and destination
  visibility before showing valid state.
- Use distinct valid/invalid reticles by shape and color.
- Move the player rig, not the tracked headset camera.
- Preserve head-height semantics under `local-floor`.
- Cancel cleanly on controller disconnect, pause, tracking loss, or session end.
- Offer snap turn and teleport as comfort defaults; make continuous locomotion
  opt-in where appropriate.

Do not use a visual ray hit as proof that a gameplay-safe destination exists.

## Minimal AR Setup

Use the same owned entry boundary and request only features the game
implements:

```ts
import * as THREE from 'three';

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
});
renderer.xr.enabled = true;
renderer.setClearAlpha(0);

const overlay = document.querySelector<HTMLElement>('#ar-overlay');
if (!overlay) throw new Error('Missing #ar-overlay');

const arSessionInit: XRSessionInit = {
  requiredFeatures: ['hit-test'],
  optionalFeatures: ['dom-overlay'],
  domOverlay: { root: overlay },
};

const ownedArEntry = createOwnedXrEntry(renderer, {
  mode: 'immersive-ar',
  sessionInit: arSessionInit,
  referenceSpaceCandidates: ['local'],
  idleLabel: 'START AR',
  activeLabel: 'STOP AR',
  onReferenceSpaceSelected: () => {},
  onError: (error) => showXrEntryError(error),
});
document.body.appendChild(ownedArEntry.element);

renderer.setAnimationLoop((timestamp, xrFrame) => {
  if (xrFrame) updateHitTest(xrFrame);
  renderer.render(scene, camera);
});
```

Treat the XR manager's `sessionstart` event—not the click or DOM append—as the
readiness boundary for session-owned work such as hit-test source creation.
Await `ownedArEntry.dispose()` before destroying the route renderer, canvas,
overlay root, or hit-test owner.

For immersive AR, `alpha: true` and a zero clear alpha preserve an alpha-blend
passthrough view. The ordinary opaque-canvas game default does not apply to this
path. Check `renderer.xr.getEnvironmentBlendMode()` on target devices instead
of assuming every AR compositor blends identically. Handheld AR uses a `local`
reference-space contract; do not silently apply a VR `local-floor` assumption.
The owned route therefore selects only `local` after first proving that the
granted session can provide it.

Hit testing uses two distinct spaces. Request the source from a dedicated
`viewer` space, then resolve poses in the renderer's current world reference
space:

```ts
let hitTestSource: XRHitTestSource | null = null;
let hitTestRequestGeneration = 0;

async function createHitTestSource(session: XRSession) {
  const requestGeneration = ++hitTestRequestGeneration;
  hitTestSource?.cancel();
  hitTestSource = null;
  const viewerSpace = await session.requestReferenceSpace('viewer');
  const nextSource = await session.requestHitTestSource?.({ space: viewerSpace });

  if (!nextSource) {
    throw new Error('This XR runtime does not expose hit-test sources');
  }

  if (
    renderer.xr.getSession() !== session ||
    requestGeneration !== hitTestRequestGeneration
  ) {
    nextSource.cancel();
    return;
  }

  hitTestSource = nextSource;
}

function updateHitTest(frame: XRFrame) {
  const worldSpace = renderer.xr.getReferenceSpace();
  const pose = hitTestSource && worldSpace
    ? frame.getHitTestResults(hitTestSource)[0]?.getPose(worldSpace)
    : null;
  reticle.visible = Boolean(pose);
  if (pose) reticle.matrix.fromArray(pose.transform.matrix);
}

function cancelHitTest() {
  hitTestRequestGeneration += 1;
  hitTestSource?.cancel();
  hitTestSource = null;
  reticle.visible = false;
}

function handleArSessionStart() {
  const session = renderer.xr.getSession();
  if (!session) return;
  // The entry request required hit-test. `enabledFeatures` is optional and is
  // not a portable gate; the guarded request above is the capability check.
  void createHitTestSource(session).catch(onHitTestSourceError);
}

renderer.xr.addEventListener('sessionstart', handleArSessionStart);
renderer.xr.addEventListener('sessionend', cancelHitTest);
handleArSessionStart();
```

The lifecycle handler above creates and cancels this source. Set
`reticle.matrixAutoUpdate = false`; place only on user confirmation of a valid
pose, and handle no surface, permission denial, relocalization, and reset.

Do not darken the real camera feed to hide weak contrast. Use readable local
shadows/contact cues, outlines, scale references, and UI guidance.

## Comfort And Accessibility

Use comfort constraints as game requirements:

- Keep horizon and head tracking stable. Never add camera shake directly to
  the XR view.
- Prefer teleport and snap turn by default. Offer configurable snap angle,
  vignette, speed, handedness, height, seated mode, and reduced motion.
- Avoid forced roll, acceleration spikes, uncommanded lateral motion, and
  camera-attached full-screen flashes.
- Keep world-locked UI at comfortable distance and angular size; avoid tiny
  text or UI fixed too close to the face.
- Use diegetic or hand-mounted UI where it improves context, but provide a
  reachable alternative for limited mobility.
- Pair color with shape, icon, sound, and haptic cues.
- Gate haptics by feature detection and treat promise rejection as unsupported
  capability, not a gameplay failure.
- Provide pause/recenter/exit access from either hand and keyboard during
  development.

Test comfort over a sustained session, not only a short interaction demo.

## XR Performance

XR renders multiple views at a high, device-controlled cadence. Start below the
desktop scene budget:

- Cap draw calls, transparent overdraw, skinned meshes, shadow casters, dynamic
  lights, particles, and full-screen passes.
- Use instancing, batching, LOD, culling, shared materials, and local compressed
  assets where measured.
- Prefer one shadowed directional light and cheap contact cues.
- Set framebuffer scale before session entry and verify text/reticle clarity.
- Use foveation only after testing quality and device support.
- Avoid per-eye JavaScript work; update simulation once per XR frame.
- Keep allocations out of controller, raycast, hand-joint, and render loops.
- Measure CPU and GPU frame time on device at the target refresh rate.
- Test the densest combat/VFX/UI state and session thermal behavior.

Do not claim multiview, WebGPU, foveation, or a fallback improves performance
without same-device measurements.

## Cleanup

Remove session listeners, controller listeners, local visuals, buttons, hit-test
sources, and shared geometries/materials through one owner. Reuse the
`OwnedXrEntry` created by the setup section; do not create a second entry
boundary during cleanup:

```ts
function createXrDisposer(entry: OwnedXrEntry) {
  // Keep this promise inside one route/game owner. A remount creates a new
  // owner and therefore a new disposer instead of inheriting stale state.
  let disposePromise: Promise<void> | null = null;

  return function disposeXr() {
    disposePromise ??= disposeXrOwnedResources(entry);
    return disposePromise;
  };
}

async function disposeXrOwnedResources(entry: OwnedXrEntry) {
  // Invalidate and await any pending request, then end and await the entry's
  // installed session. Removing a stock DOM button alone cannot do this.
  await entry.dispose();
  // This is normally null. Keep a defensive manager snapshot for a renderer
  // whose setup partially installed state before rejecting.
  const session = renderer.xr.getSession();

  try {
    // Session end restores the pre-session loop in the common r185 XRManager.
    // End first, then clear the restored loop in finally.
    if (session) await session.end();
  } finally {
    await renderer.setAnimationLoop(null);

    renderer.xr.removeEventListener('sessionstart', handleManagerSessionStart);
    renderer.xr.removeEventListener('sessionend', handleManagerSessionEnd);
    unbindActiveSession();

    // Include these three lines when the AR hit-test block is installed.
    renderer.xr.removeEventListener('sessionstart', handleArSessionStart);
    renderer.xr.removeEventListener('sessionend', cancelHitTest);
    cancelHitTest();

    for (const controller of controllers) {
      controller.removeEventListener('selectstart', onSelectStart);
      controller.removeEventListener('selectend', onSelectEnd);
      controller.removeEventListener('squeezestart', onSqueezeStart);
      controller.removeEventListener('squeezeend', onSqueezeEnd);
      controller.removeEventListener('connected', onControllerConnected);
      controller.removeEventListener('disconnected', onControllerDisconnected);
      controller.removeFromParent();
    }

    for (const binding of inputBindings) {
      binding.controller.removeEventListener('connected', binding.connected);
      binding.controller.removeEventListener(
        'disconnected',
        binding.disconnected,
      );
    }

    resetXrSessionInput();

    // XR managers cache controller/grip roots by index. Remove every visual
    // this owner attached before disposing its shared GPU resources; otherwise
    // a remount receives roots containing stale children.
    for (const ray of controllerRays) ray.removeFromParent();
    for (const proxy of gripProxies) proxy.removeFromParent();
    for (const grip of grips) grip.removeFromParent();
    hand0.removeFromParent();
    hand1.removeFromParent();

    rayGeometry.dispose();
    rayMaterial.dispose();
    gripGeometry.dispose();
    gripMaterial.dispose();
    timer.dispose();
  }
}
```

If a route change should leave an active session gracefully, end it and wait
for the `end` event before destroying dependent state. Build the disposer once
per route owner, for example `const disposeXr = createXrDisposer(ownedVrEntry)`,
and call `disposeXr()` from that owner's teardown. For AR, configure the same
owner with `mode: 'immersive-ar'`, reference space `local`, and the AR session
init. Keep the controller/grip roots, owned child arrays, listener bindings,
timer, entry owner, and disposer inside that same route. A remount must
construct fresh owned visuals/resources and a fresh disposer even though the
renderer manager may return the same cached pose roots. If
controller/hand factories added meshes, textures, animation
mixers, or fetch-backed profile data, dispose those owned resources before
dropping their roots. Prevent duplicate buttons, controllers, listeners, and
animation loops on re-entry.

## WebXR QA Matrix

Run and record all applicable checks:

### Session

- Unsupported browser/device displays a clear fallback.
- A missing optional `local-floor` grant either enters the tested `local`
  product mode or fails before manager installation; it never leaves a live,
  unowned session.
- Permission deny, enter, visibility loss, resume, and exit preserve game state.
- Route teardown during a pending permission/session request awaits the owned
  entry promise; a late session is ended without calling `setSession()`.
- Rejected reference-space probes and rejected manager `setSession()` calls end
  and await the new session before a retry or renderer teardown.
- A device- or user-ended session during asynchronous manager setup never
  flips the entry UI to active or remains cached as the installed session.
- Re-entering does not duplicate loops, controllers, UI, audio, or resources.
- Reference-space reset/recenter does not offset gameplay unexpectedly.

### Scale And Comfort

- Floor height, reach distance, object size, gravity, speed, and audio distance
  feel correct at one unit per meter.
- Standing and seated modes work where promised.
- Teleport, snap turn, continuous motion, vignette, dominant hand, and reduced
  motion behave as configured.
- No forced roll, view shake, or uncommanded camera motion occurs.

### Input

- Both hands connect/disconnect and swap dominance cleanly.
- Select, squeeze, axes, buttons, ray hover/commit, grab, and menu cancel work on
  every promised controller profile.
- Hand tracking degrades to the promised alternative.
- Lost tracking or disconnect clears held objects and intents safely.

### Visual And Performance

- Each eye renders correctly with no one-eye-only post, clipping, or stale
  target.
- UI is legible, reachable, depth-stable, and not clipped by near plane.
- Dense gameplay holds the target refresh rate on device.
- Draw calls, triangles, shadows, post passes, framebuffer scale, and backend
  are recorded.
- Thermal behavior is checked over a sustained representative session.

### AR

- Camera permission, no-surface state, hit-test acquisition, placement confirm,
  tracking loss, relocalization, reset, and session end work.
- DOM overlay remains usable and respects safe areas.
- Virtual content maintains scale, contact, contrast, and stable anchoring.

### Local-First Runtime

- Production XR entry and controller/hand connection make no outbound request.
- Controller, hand, environment, audio, shader, and model assets resolve from
  project-local URLs.
- Build/typecheck, secure local serving, console/page errors, and checks not run
  are reported explicitly.

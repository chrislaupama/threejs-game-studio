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

## Minimal WebGL VR Setup

Use [VRButton](https://threejs.org/docs/pages/VRButton.html), enable the
renderer XR manager, choose reference-space type before a session starts, and
use `setAnimationLoop()`:

```ts
import * as THREE from 'three';
import { VRButton } from 'three/addons/webxr/VRButton.js';

const canvas = document.querySelector<HTMLCanvasElement>('#game');
if (!canvas) throw new Error('Missing #game canvas');

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: 'high-performance',
});

renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');

const sessionInit: XRSessionInit = {
  optionalFeatures: ['bounded-floor', 'hand-tracking'],
};

const enterVrButton = VRButton.createButton(renderer, sessionInit);
document.body.appendChild(enterVrButton);

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

The non-XR camera describes the base camera/player rig. While presenting, the
XR system supplies view cameras. Do not depend on the base camera's `fov` or
aspect to describe the headset view. The current
[WebXRManager](https://threejs.org/docs/pages/WebXRManager.html) notes that the
XR camera's exposed `fov` does not represent the per-view projection.

Do not use `window.requestAnimationFrame()` as a parallel game loop. One
`renderer.setAnimationLoop()` callback must own both desktop and XR rendering.

## WebGPU XR Setup

Three.js r185 supports `VRButton`/`ARButton` with `WebGPURenderer`, but the
renderer remains experimental. Keep this as an explicit product choice and
test the exact headset/browser/backend combination.

```ts
import * as THREE from 'three/webgpu';
import { VRButton } from 'three/addons/webxr/VRButton.js';

const renderer = new THREE.WebGPURenderer({
  antialias: true,
  multiview: true,
});

renderer.xr.enabled = true;
renderer.xr.setReferenceSpaceType('local-floor');
document.body.appendChild(VRButton.createButton(renderer));

renderer.setAnimationLoop(() => {
  renderer.render(scene, camera);
});
```

`setAnimationLoop()` ensures initialization before the first frame. Call
`await renderer.init()` first only when setup requires renderer methods before
that loop. Use node materials and TSL; do not use WebGL `ShaderMaterial`,
`onBeforeCompile`, or `EffectComposer`. See the official
[WebGPURenderer guide](https://threejs.org/manual/en/webgpurenderer).

Verify the WebGPU backend and `forceWebGL: true` fallback separately when both
are claimed. A desktop WebGPU success does not prove headset-browser support.

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

Configure reference-space type and framebuffer scale before entering a
session; those settings cannot be changed freely while presenting:

```ts
renderer.xr.setReferenceSpaceType('local-floor');
renderer.xr.setFramebufferScaleFactor(0.85);

function bindSessionLifecycle() {
  const session = renderer.xr.getSession();
  if (!session) return;

  session.addEventListener('visibilitychange', onSessionVisibilityChange);
  session.addEventListener('end', onSessionEnded, { once: true });
}
```

Use [WebXRManager.setFoveation](https://threejs.org/docs/pages/WebXRManager.html)
when supported and measured. Do not assume a setting has an effect on every
device/backend.

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

function createController(index: number) {
  const controller = renderer.xr.getController(index);
  controller.name = `xr-controller-${index}`;

  const ray = new THREE.Line(rayGeometry, rayMaterial);
  ray.name = 'target-ray';
  ray.scale.z = 4;
  controller.add(ray);

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

The [WebXRManager API](https://threejs.org/docs/pages/WebXRManager.html)
distinguishes target ray from grip space. Keep that distinction explicit.

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

function createGrip(index: number) {
  const grip = renderer.xr.getControllerGrip(index);
  grip.name = `xr-grip-${index}`;

  const proxy = new THREE.Mesh(gripGeometry, gripMaterial);
  proxy.position.z = 0.02;
  grip.add(proxy);
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
    const gamepad = inputSources[index]?.gamepad;
    if (!gamepad) continue;

    // Apply dead zones and profile-aware mapping before emitting intents.
    const x = applyDeadZone(gamepad.axes[2] ?? gamepad.axes[0] ?? 0);
    const y = applyDeadZone(gamepad.axes[3] ?? gamepad.axes[1] ?? 0);
    setMoveIntent(index, x, y);
  }
}
```

Axis and button layouts vary. Inspect `XRInputSource.profiles`, handedness, and
actual device behavior. Never assume a single Oculus-style index mapping is
universal. Clear held/edge state on disconnect, visibility loss, pause, and
session end.

## Hand Tracking

Request hand tracking as optional unless the experience requires it and has a
controller/gaze fallback:

```ts
const hand0 = renderer.xr.getHand(0);
const hand1 = renderer.xr.getHand(1);
playerRig.add(hand0, hand1);
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

Use [ARButton](https://threejs.org/docs/pages/ARButton.html) and request only
features the game implements:

```ts
import * as THREE from 'three';
import { ARButton } from 'three/addons/webxr/ARButton.js';

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  alpha: true,
});
renderer.xr.enabled = true;
renderer.setClearAlpha(0);

const overlay = document.querySelector<HTMLElement>('#ar-overlay');
if (!overlay) throw new Error('Missing #ar-overlay');

const sessionInit: XRSessionInit = {
  requiredFeatures: ['hit-test'],
  optionalFeatures: ['dom-overlay'],
  domOverlay: { root: overlay },
};

document.body.appendChild(ARButton.createButton(renderer, sessionInit));

renderer.setAnimationLoop((timestamp, xrFrame) => {
  if (xrFrame) updateHitTest(xrFrame);
  renderer.render(scene, camera);
});
```

Create the hit-test source once per session from the current reference space,
update a placement reticle from frame results, and cancel the source on session
end. Keep objects unplaced until the user confirms a valid surface. Handle no
surface, permission denial, tracking interruption, relocalization, and reset.

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
sources, and shared geometries/materials through one owner:

```ts
async function disposeXr() {
  renderer.setAnimationLoop(null);

  const session = renderer.xr.getSession();
  if (session) await session.end();

  for (const controller of controllers) {
    controller.removeEventListener('selectstart', onSelectStart);
    controller.removeEventListener('selectend', onSelectEnd);
    controller.removeEventListener('squeezestart', onSqueezeStart);
    controller.removeEventListener('squeezeend', onSqueezeEnd);
    controller.removeEventListener('connected', onControllerConnected);
    controller.removeEventListener('disconnected', onControllerDisconnected);
    controller.removeFromParent();
  }

  for (const grip of grips) grip.removeFromParent();
  hand0.removeFromParent();
  hand1.removeFromParent();

  for (const binding of inputBindings) {
    binding.controller.removeEventListener('connected', binding.connected);
    binding.controller.removeEventListener('disconnected', binding.disconnected);
  }

  rayGeometry.dispose();
  rayMaterial.dispose();
  gripGeometry.dispose();
  gripMaterial.dispose();
  timer.dispose();
  enterVrButton.remove();
}
```

If a route change should leave an active session gracefully, end it and wait
for the `end` event before destroying dependent state. Prevent duplicate
buttons, controllers, listeners, and animation loops on re-entry.

## WebXR QA Matrix

Run and record all applicable checks:

### Session

- Unsupported browser/device displays a clear fallback.
- Permission deny, enter, visibility loss, resume, and exit preserve game state.
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

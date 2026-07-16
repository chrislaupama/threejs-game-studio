# Interaction, Picking, Controls, And Gamepads

## Contents

- Choose this reference when
- Novice mental model
- Smallest correct canvas-relative raycast
- Pointer lifecycle and action boundaries
- Picking sets, layers, and stable identities
- Selection and hover state
- Orbit and inspection cameras
- Pointer lock and first-person look
- TransformControls
- Gamepad polling
- Touch and mobile input
- Camera ownership and handoffs
- Common failures
- Performance
- Disposal
- Verification
- Official documentation

## Choose This Reference When

Read this file when implementing mouse/touch picking, hover, selection,
first-person look, orbit inspection, editor manipulation, controller input,
camera mode changes, or input cleanup. Use it to diagnose picks that are offset,
nested glTF objects that cannot be selected, controls that fight each other,
stuck keys, pointer-lock failures, or gamepad input that changes with frame rate.

Choose the interaction surface intentionally:

| Need | Pattern |
| --- | --- |
| Click or tap an object | Canvas-relative `Raycaster` |
| Fast repeated picking | Intentional pick list/layer; accelerate only after profiling |
| Product/model inspection | `OrbitControls` |
| Mouse-look first person | `PointerLockControls` plus a collision-aware movement owner |
| In-game/editor translate, rotate, scale | `TransformControls.getHelper()` |
| Controller play | Poll `navigator.getGamepads()` into semantic actions |
| Mobile play | Pointer Events, pointer capture, touch-action CSS, and explicit zones |
| XR pointing | `Raycaster.setFromXRController()` with XR controller state |

Controls are not a game architecture. Convert device input into semantic
actions, then let gameplay decide what movement or state transition is legal.

## Novice Mental Model

Browser pointer coordinates are CSS pixels from the viewport. Three.js
raycasting expects normalized device coordinates (NDC): `(-1, -1)` is the
canvas bottom-left and `(1, 1)` is its top-right. Convert using the canvas's
actual `getBoundingClientRect()`, not the window.

The interaction path is:

```text
device event -> canvas coordinates -> NDC -> ray -> intersection
             -> stable game identity -> semantic action -> game state
```

A raycast reports render objects and intersection details. It does not know
which parent is the enemy, whether clicking is currently allowed, or what the
click means. Resolve the hit into a stable application ID and keep hover,
selection, focus, and action state outside materials and scene traversal.

Camera controls mutate a camera transform. Only one owner may write the camera
pose in a given mode. Disable or disconnect competing controls during drags,
cinematics, pause, menus, and camera handoffs.

## Smallest Correct Canvas-Relative Raycast

Use Pointer Events, canvas bounds, a named listener, and an intentional target
list:

```ts
import * as THREE from 'three';

const raycaster = new THREE.Raycaster();
const pointerNdc = new THREE.Vector2();
const pickables: THREE.Object3D[] = [];

function setPointerNdc(event: PointerEvent, canvas: HTMLCanvasElement) {
  const rect = canvas.getBoundingClientRect();
  pointerNdc.set(
    ((event.clientX - rect.left) / rect.width) * 2 - 1,
    -((event.clientY - rect.top) / rect.height) * 2 + 1,
  );
}

function onPointerDown(event: PointerEvent) {
  if (event.button !== 0) return;
  const canvas = renderer.domElement;
  setPointerNdc(event, canvas);
  raycaster.setFromCamera(pointerNdc, camera);

  const [hit] = raycaster.intersectObjects(pickables, true);
  if (!hit) return;

  const entityId = resolveEntityId(hit.object);
  if (entityId) commands.select(entityId);
}

renderer.domElement.addEventListener('pointerdown', onPointerDown);

function disposePicking() {
  renderer.domElement.removeEventListener('pointerdown', onPointerDown);
}
```

`resolveEntityId()` should walk parents only until a documented application
boundary:

```ts
function resolveEntityId(object: THREE.Object3D): string | undefined {
  let current: THREE.Object3D | null = object;
  while (current) {
    if (typeof current.userData.entityId === 'string') {
      return current.userData.entityId;
    }
    current = current.parent;
  }
  return undefined;
}
```

Do not expose raw asset node names as game identity. Assign stable IDs when the
entity is created.

## Pointer Lifecycle And Action Boundaries

Use one Pointer Event path for mouse, pen, and touch. Capture a pointer during a
drag so release/cancel is received even outside the canvas:

```ts
let dragPointer: number | null = null;

function onPointerDown(event: PointerEvent) {
  if (dragPointer !== null) return;
  dragPointer = event.pointerId;
  canvas.setPointerCapture(event.pointerId);
  input.setAimPointer(event.clientX, event.clientY);
}

function onPointerMove(event: PointerEvent) {
  if (event.pointerId !== dragPointer) return;
  input.setAimPointer(event.clientX, event.clientY);
}

function endPointer(event: PointerEvent) {
  if (event.pointerId !== dragPointer) return;
  if (canvas.hasPointerCapture(event.pointerId)) {
    canvas.releasePointerCapture(event.pointerId);
  }
  dragPointer = null;
  input.releaseAimPointer();
}

canvas.addEventListener('pointerdown', onPointerDown);
canvas.addEventListener('pointermove', onPointerMove);
canvas.addEventListener('pointerup', endPointer);
canvas.addEventListener('pointercancel', endPointer);
```

Clear held keyboard/pointer actions on `window.blur`, page visibility loss,
pointer cancel, pointer-lock exit, pause, and controller disconnect. Otherwise
movement can remain stuck after focus changes.

Keep DOM handlers small. They update raw device state or enqueue an intent;
fixed simulation consumes action state. Never move a player by a fixed amount
inside `keydown` or `pointermove`.

## Picking Sets, Layers, And Stable Identities

### Limit the target set

Raycast against registered gameplay targets, not the entire scene. Remove an
object from the registry before disposing or pooling it.

For complex render art, use a simpler proxy on a pick-only layer:

```ts
const PICK_LAYER = 2;
const proxy = new THREE.Mesh(
  new THREE.CapsuleGeometry(0.5, 1.2, 4, 8),
  new THREE.MeshBasicMaterial({ colorWrite: false, depthWrite: false }),
);
proxy.userData.entityId = enemy.id;
proxy.layers.set(PICK_LAYER);
enemy.root.add(proxy);

camera.layers.disable(PICK_LAYER); // proxy is not rendered
raycaster.layers.set(PICK_LAYER);  // proxy is pickable
pickables.push(proxy);
```

Layers filter both rendering and raycasting according to the camera/raycaster
mask. Document layer numbers centrally. A child does not automatically inherit
its parent's layer assignment.

### Understand intersection data

An intersection can contain world `point`, interpolated `normal`, `uv`, `uv1`,
`face`, `faceIndex`, and `instanceId`. `face` is an object, not the removed
`Face3` class. For `InstancedMesh`, combine the stable mesh identity with the
validated `instanceId`.

Line and point thresholds are world-space distances:

```ts
raycaster.params.Line.threshold = 0.05;
raycaster.params.Points.threshold = 0.08;
```

Tune them for world scale and camera distance. `Raycaster.firstHitOnly` is not
a core Three.js property; it belongs to third-party acceleration integrations.

### World-space target queries

`object.position` is local to its parent. Use a reused target for world space:

```ts
const worldPosition = new THREE.Vector3();
object.getWorldPosition(worldPosition);
```

Call `scene.updateMatrixWorld()` before an out-of-band raycast if transforms
changed and no render/update has refreshed matrices yet.

## Selection And Hover State

Store identity in application state and project that state visually. Do not
overwrite a shared material's color/emissive and hope to restore it later.

```ts
type SelectionState = {
  hovered?: string;
  selected?: string;
};

const selection: SelectionState = {};

function applySelectionVisual(entity: SelectableEntity) {
  entity.selectionRing.visible = selection.selected === entity.id;
  entity.hoverRing.visible = selection.hovered === entity.id;
}
```

Use an outline, ring, icon, scale pulse, or instance color owned by the visual
system. If a material must change, clone it once at the entity boundary and
dispose that clone later. Handle arrays and unlit materials explicitly.

For hover, mark the pointer and camera as dirty and raycast at most once during
the next frame. Do not raycast repeatedly if neither pointer nor pickable world
matrices changed.

Clear stale hover/selection when an entity despawns, changes layer, becomes
non-interactive, or the state leaves gameplay.

## Orbit And Inspection Cameras

`OrbitControls` is ideal for viewers, build screens, map inspection, and debug
tools. It is usually not a character controller.

```ts
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const orbit = new OrbitControls(camera, renderer.domElement);
orbit.enableDamping = true;
orbit.dampingFactor = 0.08;
orbit.minDistance = 2;
orbit.maxDistance = 18;
orbit.minPolarAngle = 0.15;
orbit.maxPolarAngle = Math.PI * 0.48;
orbit.target.set(0, 1, 0);
orbit.update();

function updateInspection(deltaSeconds: number) {
  orbit.update(deltaSeconds);
}
```

Pass delta when using time-dependent auto-rotation. Call `update()` after
programmatically changing camera/target. Use `saveState()` and `reset()` for a
viewer reset. Fit min/max distance and target from subject bounds instead of
unexplained constants.

Disable orbit while a transform or UI drag owns the pointer. Dispose controls
when leaving the mode.

## Pointer Lock And First-Person Look

Pointer lock requires a user gesture and exits with Escape. Use current
`controls.object`; do not call removed `getObject()`.

```ts
import { PointerLockControls } from
  'three/addons/controls/PointerLockControls.js';

const look = new PointerLockControls(camera, renderer.domElement);

function requestLookLock() {
  look.lock();
}

function onLock() {
  input.setLookCaptured(true);
}

function onUnlock() {
  input.setLookCaptured(false);
  input.clearHeldActions();
  game.requestPauseFromPointerUnlock();
}

look.addEventListener('lock', onLock);
look.addEventListener('unlock', onUnlock);
startButton.addEventListener('click', requestLookLock);
```

For a collision-free debug walk, `moveForward(distance)` and
`moveRight(distance)` move `controls.object` by a distance, so multiply speed by
simulation delta:

```ts
look.moveForward(actions.moveY * speed * fixedDelta);
look.moveRight(actions.moveX * speed * fixedDelta);
```

For a real game, use pointer-lock controls only for view orientation. Derive a
horizontal movement basis from the camera, pass the desired displacement to a
character/collision controller, then place the camera at the accepted player
pose. Direct camera movement bypasses collisions, slopes, triggers, moving
platforms, and authoritative game state.

Do not call `lock()` automatically on page load. Browsers require a gesture and
may reject unadjusted/raw mouse movement.

## TransformControls

In current Three.js, add the helper returned by `getHelper()` to the scene; the
controls object itself is not the visual scene node:

```ts
import { TransformControls } from
  'three/addons/controls/TransformControls.js';

const transform = new TransformControls(camera, renderer.domElement);
const transformHelper = transform.getHelper();
scene.add(transformHelper);
transform.attach(selectedObject);
transform.setMode('translate');
transform.setSpace('world');
transform.setTranslationSnap(0.25);

function onDraggingChanged(event: unknown) {
  const dragging =
    typeof event === 'object' &&
    event !== null &&
    'value' in event &&
    (event as { value: unknown }).value === true;
  orbit.enabled = !dragging;
}

transform.addEventListener('dragging-changed', onDraggingChanged);
```

Attach only an object already in the scene graph. Decide local/world axes,
snapping, min/max constraints, commit/cancel, and undo/redo before presenting
the gizmo as an editor. Manipulate an application-owned container when imported
asset internals should remain untouched.

Teardown:

```ts
transform.detach();
transform.removeEventListener('dragging-changed', onDraggingChanged);
scene.remove(transformHelper);
transform.dispose();
```

## Gamepad Polling

Gamepad state is sampled, not pushed reliably as gameplay events. Poll inside
the input sampling phase and map the standard layout to the same actions used
by keyboard/touch.

```ts
function deadZone(value: number, threshold = 0.18) {
  const magnitude = Math.abs(value);
  if (magnitude <= threshold) return 0;
  return Math.sign(value) * (magnitude - threshold) / (1 - threshold);
}

let previousFire = false;

function sampleGamepad(index = 0) {
  const pad = navigator.getGamepads()[index];
  if (!pad || !pad.connected || pad.mapping !== 'standard') {
    previousFire = false;
    return {
      moveX: 0,
      moveY: 0,
      lookX: 0,
      lookY: 0,
      fireDown: false,
      firePressed: false,
    };
  }

  const fireDown = pad.buttons[0]?.pressed ?? false;
  const sample = {
    moveX: deadZone(pad.axes[0] ?? 0),
    moveY: -deadZone(pad.axes[1] ?? 0),
    lookX: deadZone(pad.axes[2] ?? 0),
    lookY: -deadZone(pad.axes[3] ?? 0),
    fireDown,
    firePressed: fireDown && !previousFire,
  };
  previousFire = fireDown;
  return sample;
}
```

Poll a fresh array from `navigator.getGamepads()` each sample. Do not retain a
`Gamepad` object and assume it updates identically in every browser. Support
controller selection, disconnect, remapping, trigger normalization, dead-zone
calibration, focus loss, and button edges. Apply look sensitivity with delta
time and an accessibility setting.

Unknown/non-standard mappings need an explicit configuration UI or a supported
fallback; do not guess indices invisibly.

## Touch And Mobile Input

Set touch behavior deliberately on the gameplay canvas:

```css
canvas[data-game-canvas] {
  touch-action: none;
  user-select: none;
}
```

Do this only when the canvas owns the gesture; keep menus and surrounding pages
scrollable. Build touch controls as semantic zones:

- Left zone or stick: movement vector.
- Right drag: look/aim delta.
- Buttons: jump, fire, interact, pause.
- Pointer capture: stable drags outside a button's visual bounds.
- Safe-area-aware DOM layout: controls remain reachable around notches.

Track each `pointerId` independently. Do not assume `event.touches[0]` remains
the same finger. Handle `pointercancel`, orientation change, visibility loss,
and accidental multi-touch. Keep touch targets large and expose sensitivity,
left-handed layout, hold/toggle, and reduced-motion options when relevant.

Raycasting a tap still uses the canvas-relative NDC conversion. Separate a tap
from a drag with distance/time thresholds expressed in CSS pixels.

## Camera Ownership And Handoffs

Keep one active camera and one pose owner per mode:

```text
menu orbit -> transition owner -> gameplay rig -> cinematic -> gameplay rig
```

At each transition:

1. Disable the outgoing controls.
2. Snapshot or compute the incoming camera pose and semantic target.
3. Give interpolation to one transition owner.
4. Enable incoming controls only after the handoff completes.
5. Update projection and control limits on resize/mode changes.

Avoid stacked smoothing where player, camera target, boom, and final camera each
lag independently. Keep collision-aware camera placement in the camera rig, not
inside input handlers.

## Common Failures

- **Pick is offset:** coordinates use `window.innerWidth` rather than canvas
  bounds, or CSS scaling/scroll offset was ignored.
- **Nested glTF child is selected instead of entity:** hit was not resolved to
  the application boundary.
- **Pick misses after programmatic movement:** world matrices were stale.
- **Proxy cannot be picked:** it was omitted from the raycast target set,
  recursive traversal was disabled for a nested proxy, or raycaster and proxy
  layers do not intersect. Camera visibility is a separate concern; keep the
  proxy on a camera-excluded pick layer when it must not render.
- **Every shared object highlights:** selection mutated a shared material.
- **Black was not restored after hover:** falsy color value `0` was used as a
  missing-state sentinel.
- **Raycaster is slow:** it traverses the entire scene or complex render meshes
  on every pointer event.
- **First-person speed changes with FPS:** movement distance lacks fixed/render
  delta.
- **Player passes through walls:** PointerLockControls moved the camera directly
  rather than a collision-aware controller.
- **Pointer lock does nothing:** request was not made from a user gesture, canvas
  lacks focus, or browser permission failed.
- **Transform gizmo is missing:** controls rather than `getHelper()` were added
  to the scene.
- **Orbit and transform both move:** orbit was not disabled during gizmo drag.
- **Gamepad button repeats every frame:** held state was used instead of a
  pressed edge.
- **Key remains stuck:** blur, visibility, cancel, unlock, or disconnect did not
  clear raw state.
- **World label uses wrong position:** local `object.position` was projected
  instead of `getWorldPosition()`.

## Performance

- Keep a registered pick set or dedicated pick layer.
- Raycast pointer hover once per dirty frame, not for every high-rate DOM event.
- Use simple proxies for complex art and broad interaction targets.
- Reuse `Vector2`, `Vector3`, rays, planes, and result arrays in hot paths.
  `intersectObjects()` accepts an optional result target; clear it before reuse.
- Use instance IDs for large repeated sets instead of thousands of event
  closures.
- Poll gamepads once per input/simulation sample, not separately in every
  entity.
- Keep UI pointer handlers passive only when they never call `preventDefault`;
  use CSS `touch-action` as the main gesture policy.
- Profile BVH/third-party acceleration only after a core pick set and simple
  proxies are insufficient, and label its APIs as third-party.
- Suspend hover picking in pointer lock, pause menus, hidden tabs, or modes where
  selection is unavailable.

## Disposal

Every input/control owner must remove exactly the same stored callback and
target used during setup:

- Remove pointer, keyboard, blur, visibility, orientation, gamepad, and
  pointer-lock listeners.
- Release captured pointers and clear held raw/action state.
- Detach and dispose `OrbitControls`, `PointerLockControls`,
  `TransformControls`, `DragControls`, or other active controls.
- Remove and dispose control helpers.
- Remove proxies from pick arrays/layers before disposing geometry/material.
- Clear hover and selection IDs when their entity is released.
- Cancel camera transitions and input timers.
- Restore cursor, focus, and canvas CSS altered by the interaction mode.

Anonymous inline listeners cannot be removed later. Store callbacks or use an
`AbortController` owned by the interaction lifetime and abort it at teardown.

## Verification

1. Test a canvas that is offset, scrolled, CSS-scaled, resized, and high-DPR;
   verify picks remain under the pointer.
2. Pick nested glTF children, an instance, a proxy layer, a transparent object,
   and empty space; confirm stable identity and deselection.
3. Exercise pointer down/move/up/cancel, drag leaving the canvas, window blur,
   hidden tab, and pointer-lock exit.
4. Test keyboard-only, mouse, touch, pen when supported, and a standard-mapped
   gamepad. Verify action meaning stays consistent.
5. Compare movement and look distance at low/high frame rates.
6. Disconnect/reconnect a controller while buttons are held.
7. Enter and exit orbit, gameplay, transform drag, pause, cinematic, and retry;
   confirm only one camera owner writes each frame.
8. Spawn/despawn selectable entities repeatedly; ensure no stale selection,
   pick target, listener, helper, or disposed object remains.
9. Profile hover raycasts in the worst visible scene and record target count and
   CPU time.
10. Verify essential actions remain available without relying on color, hover,
    or a precision pointer.

## Official Documentation

- [Raycaster](https://threejs.org/docs/pages/Raycaster.html)
- [Picking manual](https://threejs.org/manual/en/picking.html)
- [Layers](https://threejs.org/docs/pages/Layers.html)
- [OrbitControls](https://threejs.org/docs/pages/OrbitControls.html)
- [PointerLockControls](https://threejs.org/docs/pages/PointerLockControls.html)
- [TransformControls](https://threejs.org/docs/pages/TransformControls.html)
- [DragControls](https://threejs.org/docs/pages/DragControls.html)
- [Object3D world transforms](https://threejs.org/docs/pages/Object3D.html)
- [Ray](https://threejs.org/docs/pages/Ray.html)
- [Plane](https://threejs.org/docs/pages/Plane.html)
- [WebXR controller raycasting](https://threejs.org/docs/pages/Raycaster.html)

# Overlays And Annotation Layers

## Contents

- When to use HTML vs 3D overlays
- CSS2D / CSS3D renderers
- Visibility, occlusion, and pointer policy
- Fat lines (`Line2` / `LineSegments2`)
- Billboards
- TransformControls handoff
- Disposal and verification
- Official documentation

Use overlays when world-anchored labels, editor gizmo, or crisp HTML UI must
track 3D positions without baking text into textures.

## Choose The Layer

| Need | Prefer |
| --- | --- |
| Score, menus, accessibility text | DOM HUD (`ui.md`) |
| World-anchored nameplates / markers | `CSS2DRenderer` |
| Transformed HTML panels in 3D | `CSS3DRenderer` (heavier) |
| Thick debug/selection lines | `Line2` / `LineSegments2` |
| Always-face-camera sprites/icons | Billboard / `Sprite` |
| Move/rotate/scale editing | `TransformControls` |

Keep one owner for pointer routing so DOM overlays do not steal gameplay input
unintentionally.

## CSS2D Labels

```ts
import { CSS2DRenderer, CSS2DObject } from 'three/addons/renderers/CSS2DRenderer.js';

const labelRenderer = new CSS2DRenderer();
labelRenderer.setSize(width, height);
labelRenderer.domElement.style.position = 'absolute';
labelRenderer.domElement.style.left = '0';
labelRenderer.domElement.style.top = '0';
labelRenderer.domElement.style.pointerEvents = 'none';
host.appendChild(labelRenderer.domElement);

const el = document.createElement('div');
el.className = 'world-label';
el.textContent = 'Objective';
const label = new CSS2DObject(el);
label.center.set(0.5, 1); // bottom-center anchor
label.position.set(0, 1.2, 0);
mesh.add(label);

function render() {
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}
```

Resize both renderers with the same logical CSS-pixel size. CSS2D supports only
translation, not arbitrary CSS rotation/scale from the 3D transform, and the
official renderer supports only 100% browser and display zoom. Validate that
constraint against the product's browser support requirements.

`sortObjects` is `true` by default. It assigns z-index first from
`CSS2DObject.renderOrder`, then camera distance; it does not depth-test labels
against WebGL/WebGPU meshes. `center` controls the DOM anchor. Decide whether a
label is semantic UI or a decorative duplicate: expose it once to assistive
technology, and put `aria-hidden="true"` on duplicate visual text.

## CSS3D Panels

Use only when the panel must receive hierarchical CSS 3D transforms:

```ts
import {
  CSS3DObject,
  CSS3DRenderer,
} from 'three/addons/renderers/CSS3DRenderer.js';

const panelRenderer = new CSS3DRenderer();
panelRenderer.setSize(width, height);
panelRenderer.domElement.style.position = 'absolute';
panelRenderer.domElement.style.left = '0';
panelRenderer.domElement.style.top = '0';
panelRenderer.domElement.style.pointerEvents = 'none';
host.appendChild(panelRenderer.domElement);

const panelElement = document.createElement('section');
panelElement.className = 'world-panel';
panelElement.textContent = 'System status';
panelElement.style.pointerEvents = 'auto';
const panel = new CSS3DObject(panelElement);
panel.scale.setScalar(0.002); // authored DOM pixels -> project world scale
scene.add(panel);

function render() {
  renderer.render(scene, camera);
  panelRenderer.render(scene, camera);
}
```

CSS3DRenderer cannot use Three.js geometries or materials, is not affected by
the GPU post-processing stack, and supports only 100% browser and display zoom.
DOM panels also do not participate in the WebGL/WebGPU depth buffer. If a panel
must be reliably occluded, lit, post-processed, or XR-compatible, render it as a
GPU surface instead. Prefer CSS2D or a DOM HUD when perspective transformation
does not materially improve the experience.

## Visibility, Occlusion, And Pointer Policy

CSS renderers and the GPU renderer are separate compositing layers. Choose one
policy per overlay:

- **World-occluded:** hide behind deliberate occluders and usually keep DOM
  pointer events disabled.
- **Always legible:** show through geometry, but communicate off-screen/behind
  state rather than making the marker misleading.
- **Interactive panel:** enable pointer events only on the panel subtree and
  suspend the gameplay input owner while it has focus or pointer capture.

For a modest number of important labels, a bounded line-of-sight ray can drive
occlusion. Reuse all hot-path objects and raycast against simple blockers:

```ts
const occlusionRay = new THREE.Raycaster();
const cameraWorld = new THREE.Vector3();
const labelWorld = new THREE.Vector3();
const toLabel = new THREE.Vector3();
const occlusionHits: THREE.Intersection[] = [];
const OCCLUSION_PADDING = 0.02;

function updateLabelOcclusion(
  label: CSS2DObject,
  anchor: THREE.Object3D,
  blockers: THREE.Object3D[],
) {
  camera.getWorldPosition(cameraWorld);
  anchor.getWorldPosition(labelWorld);
  toLabel.subVectors(labelWorld, cameraWorld);

  const distance = toLabel.length();
  if (distance <= OCCLUSION_PADDING * 2) {
    label.visible = false;
    return;
  }

  occlusionRay.set(cameraWorld, toLabel.multiplyScalar(1 / distance));
  occlusionRay.near = OCCLUSION_PADDING;
  occlusionRay.far = distance - OCCLUSION_PADDING;
  occlusionHits.length = 0;
  occlusionRay.intersectObjects(blockers, true, occlusionHits);
  label.visible = occlusionHits.length === 0;
}
```

Mesh raycasts reject back faces by default. Use closed occlusion proxies or a
deliberate `DoubleSide` proxy material when blockers must work from either side.
Run the query after world matrices are current and before rendering the CSS
layer. Do not run one full-scene raycast per label: prioritize, stagger updates,
and replace distant crowds with aggregate markers. Edge-clamped navigation
markers are generally easier to own in a projected DOM HUD than as CSS2D
objects.

## Fat Lines

`Line2` and `LineSegments2` have renderer-specific implementations. Choose the
pair that matches the renderer; do not mix the WebGL class/material with
WebGPURenderer.

### WebGLRenderer

```ts
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

const geometry = new LineGeometry();
geometry.setPositions([0, 0, 0, 1, 0, 0]);
const material = new LineMaterial({
  color: 0xffcc66,
  linewidth: 3, // CSS pixels while worldUnits is false
  worldUnits: false,
  alphaToCoverage: true, // improves edges when the WebGL canvas uses MSAA
});
const line = new Line2(geometry, material);
scene.add(line);
```

For a visible line, `LineSegments2.onBeforeRender` updates
`LineMaterial.resolution` to the active viewport. Set it manually only for a
special custom/offscreen path that bypasses that callback. Call
`line.computeLineDistances()` only when `material.dashed = true`; the generated
distances are unnecessary for a solid line.

### WebGPURenderer

```ts
import { Line2NodeMaterial } from 'three/webgpu';
import { Line2 } from 'three/addons/lines/webgpu/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';

const geometry = new LineGeometry();
geometry.setPositions([0, 0, 0, 1, 0, 0]);
const material = new Line2NodeMaterial({
  color: 0xffcc66,
  linewidth: 3,
  worldUnits: false,
  dashed: false,
});
const line = new Line2(geometry, material);
scene.add(line);
```

In r185, `Line2NodeMaterial` does not support transparent blending. Use
`worldUnits: true` when thickness should attenuate with perspective and be
measured in world units. Dispose both line geometry and material when their
owner is released. Do not use thin `THREE.Line` when the design requires stable
multi-pixel screen-space thickness.

## Billboards

Prefer `Sprite` for an icon that should always face the camera:

```ts
const iconMap = await textureLoader.loadAsync(
  publicAssetUrl('ui/objective.webp'),
);
iconMap.colorSpace = THREE.SRGBColorSpace;

const iconMaterial = new THREE.SpriteMaterial({
  map: iconMap,
  color: 0xffffff,
  alphaTest: 0.35,
  depthTest: true,
  depthWrite: false,
  sizeAttenuation: true,
});
const icon = new THREE.Sprite(iconMaterial);
icon.center.set(0.5, 0); // lower edge stays anchored to the target
icon.scale.set(0.8, 0.8, 1);
target.add(icon);
```

The `map` is color data and usually uses `SRGBColorSpace`; an `alphaMap` is data
and keeps `NoColorSpace`. `sizeAttenuation` affects perspective cameras only.
Sprites never cast shadows. Turning off `depthTest` makes an icon visible
through walls, so treat that as an explicit gameplay/UI decision.

For a custom mesh billboard, copying `camera.quaternion` only works when camera
and billboard local spaces are compatible. Convert the camera's world rotation
through the billboard parent's world rotation:

```ts
const cameraWorldQuaternion = new THREE.Quaternion();
const parentWorldQuaternion = new THREE.Quaternion();

function faceCamera(object: THREE.Object3D, camera: THREE.Camera) {
  camera.getWorldQuaternion(cameraWorldQuaternion);

  if (!object.parent) {
    object.quaternion.copy(cameraWorldQuaternion);
    return;
  }

  object.parent.getWorldQuaternion(parentWorldQuaternion);
  object.quaternion
    .copy(parentWorldQuaternion)
    .invert()
    .multiply(cameraWorldQuaternion);
}
```

Keep this billboard under a rotation-only or uniformly scaled overlay root;
world rotation extraction is not a sound basis under shear or rotated,
non-uniformly scaled ancestors. Use a cylindrical billboard when it should stay
upright rather than inheriting camera roll. Pool short-lived markers and share
materials only when their mutable properties are intentionally shared.

## TransformControls Handoff

```ts
import { TransformControls } from 'three/addons/controls/TransformControls.js';

const transform = new TransformControls(camera, renderer.domElement);
const transformHelper = transform.getHelper();

function onDraggingChanged(event: unknown) {
  const dragging = (event as { value?: unknown }).value === true;
  orbit.enabled = !dragging;
}

transform.addEventListener('dragging-changed', onDraggingChanged);
scene.add(transformHelper);
transform.attach(target);
```

Keep gameplay raycasts and editor picking on explicit layers/filters. On
teardown, detach the object, remove the named event listener, remove the helper
from the scene, then call `transform.dispose()`:

```ts
function disposeTransformOverlay() {
  transform.detach();
  transform.removeEventListener('dragging-changed', onDraggingChanged);
  transformHelper.removeFromParent();
  transform.dispose();
}
```

## Disposal

- Remove every CSS2D/CSS3D object from the scene and remove its DOM element.
- Remove each CSS renderer's root DOM element; these renderers expose no
  `dispose()` method.
- Remove overlay pointer/focus listeners and release pointer capture.
- Remove and dispose wide-line geometry/material resources.
- Dispose sprite materials and only dispose textures owned by this overlay
  lifetime; shared textures need shared ownership/ref-counting.
- Detach and dispose controls and remove their helpers.

## Verification

1. Resize, change DPR, scroll the host, and test the supported browser/display
   zoom policy; labels and panels remain anchored without drift.
2. Verify label overlap order, behind-camera/off-screen behavior, and intentional
   world occlusion with blockers approached from both sides.
3. Test WebGL and WebGPU wide-line paths separately, including solid, dashed,
   screen-space, world-unit, full-canvas, and inset viewport rendering.
4. Test billboard parents with translation, rotation, and uniform scale; verify
   the chosen depth policy and color-space handling.
5. Verify pointer, keyboard, focus, and screen-reader behavior for HUD, passive
   labels, and interactive panels.
6. Repeatedly enter/exit the overlay mode; no DOM node, listener, helper,
   geometry, material, or owned texture remains after teardown.

## Official Documentation

- [CSS2DRenderer](https://threejs.org/docs/pages/CSS2DRenderer.html)
- [CSS2DObject](https://threejs.org/docs/pages/CSS2DObject.html)
- [CSS3DRenderer](https://threejs.org/docs/pages/CSS3DRenderer.html)
- [CSS3DObject](https://threejs.org/docs/pages/CSS3DObject.html)
- [Line2](https://threejs.org/docs/pages/Line2.html)
- [LineGeometry](https://threejs.org/docs/pages/LineGeometry.html)
- [LineSegments2](https://threejs.org/docs/pages/LineSegments2.html)
- [LineMaterial](https://threejs.org/docs/pages/LineMaterial.html)
- [Line2NodeMaterial](https://threejs.org/docs/pages/Line2NodeMaterial.html)
- [Sprite](https://threejs.org/docs/pages/Sprite.html)
- [SpriteMaterial](https://threejs.org/docs/pages/SpriteMaterial.html)
- [TransformControls](https://threejs.org/docs/pages/TransformControls.html)
- [Raycaster](https://threejs.org/docs/pages/Raycaster.html)
- [Object3D](https://threejs.org/docs/pages/Object3D.html)

# Overlays And Annotation Layers

## Contents

- When to use HTML vs 3D overlays
- CSS2D / CSS3D renderers
- Fat lines (`Line2` / `LineSegments2`)
- Billboards
- TransformControls handoff

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
labelRenderer.domElement.style.inset = '0';
labelRenderer.domElement.style.pointerEvents = 'none';
host.appendChild(labelRenderer.domElement);

const el = document.createElement('div');
el.className = 'world-label';
el.textContent = 'Objective';
const label = new CSS2DObject(el);
mesh.add(label);

function render() {
  renderer.render(scene, camera);
  labelRenderer.render(scene, camera);
}
```

Resize both renderers together. Dispose by removing DOM nodes and clearing
parent references on teardown.

## CSS3D Panels

Use only when the panel must perspective-transform with the scene. Prefer CSS2D
or DOM HUD for readability and a11y. Same dual-render pattern as CSS2D.

## Fat Lines

```ts
import { Line2 } from 'three/addons/lines/Line2.js';
import { LineGeometry } from 'three/addons/lines/LineGeometry.js';
import { LineMaterial } from 'three/addons/lines/LineMaterial.js';

const geometry = new LineGeometry();
geometry.setPositions([0, 0, 0, 1, 0, 0]);
const material = new LineMaterial({ color: 0xffcc66, linewidth: 3 });
material.resolution.set(width, height);
const line = new Line2(geometry, material);
line.computeLineDistances();
```

Update `material.resolution` on resize. Do not use thin `THREE.Line` when the
design needs consistent screen-space thickness.

## Billboards

```ts
sprite.quaternion.copy(camera.quaternion); // simple face-camera
// or Sprite / SpriteMaterial with depthTest tuned for readability
```

Pool short-lived billboards; share materials when tinting via color/uniforms.

## TransformControls Handoff

```ts
import { TransformControls } from 'three/addons/controls/TransformControls.js';

const transform = new TransformControls(camera, renderer.domElement);
transform.addEventListener('dragging-changed', (event) => {
  orbit.enabled = !event.value; // hand off from OrbitControls
});
scene.add(transform.getHelper());
transform.attach(target);
```

Detach and dispose helpers when leaving edit mode. Keep gameplay raycasts and
editor picking on explicit layers/filters.

## Verification

- Labels stay readable on resize and DPR changes.
- Pointer events reach the intended layer.
- Teardown removes overlay DOM and control listeners.

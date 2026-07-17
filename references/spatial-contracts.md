# Spatial Contracts

Use this reference when an app has imported models with inconsistent axes,
manipulation, actor motion, physics, terrain, navigation, or multiple moving
actors. Skip it for simple static scenes and viewers.

These contracts prevent model orientation, rendering, interaction, physics,
and world queries from developing separate ideas of the same space.

## Contents

- Declare the basis
- Separate intent from committed state
- Choose multi-actor resolution semantics
- Share world and surface queries
- Brief check
- Concrete unit and axis examples

## 1. Declare The Basis

Record the minimum spatial assumptions near scene setup or in the app brief:

- world handedness, units, and scale
- world up, right, and forward axes
- imported model-local up and forward axes
- which transform is canonical and which transforms are presentation offsets

Normalize asset orientation at one boundary, usually an asset wrapper. Do not
scatter compensating rotations through movement, cameras, animation, and UI.

## 2. Separate Intent From Committed State

For constrained motion or manipulation, use this flow:

`input -> proposed intent -> constraints/collision -> canonical state commit -> presentation`

- Intent describes the requested movement or transform.
- Resolution applies bounds, snapping, collision, physics, or permissions.
- The commit updates the one authoritative spatial state.
- Three.js objects, cameras, animation rigs, and UI project from that state.

Simple direct manipulation does not need extra abstractions, but it still needs
one authoritative transform owner.

## 3. Choose Multi-Actor Resolution Semantics

When actors can affect one another, document the update policy:

- **Frame-start:** all actors resolve against the same snapshot.
- **Sequential:** later actors observe earlier committed moves.
- **Non-blocking:** actors ignore one another for resolution purposes.

Choose deliberately based on the experience. Keep iteration order stable and
test crowded or simultaneous motion. A single-actor experience can skip this.

## 4. Share World And Surface Queries

When systems need terrain or surface knowledge, expose one query boundary that
can return only what the app needs, such as:

```ts
import type { Vector3 } from 'three'

type SurfaceSample = {
  point: Vector3
  normal: Vector3
  surface?: string
  region?: string
}

interface WorldQuery {
  sampleSurface(position: Vector3): SurfaceSample | null
}
```

Movement, placement, spawning, navigation, effects, and UI should consume the
same result instead of independently sampling render geometry. The query implementation may
use raycasting, height data, physics queries, or authored metadata; consumers
should not depend on that implementation.

## Brief Check

For spatially complex work, capture:

- basis, units, and imported model-local axes
- canonical transform owner and presentation offsets
- intent, resolution, and commit owners
- multi-actor policy when applicable
- shared world-query implementation when applicable

## Concrete Unit And Axis Examples

Record and enforce one basis near scene boot:

```ts
/** World: meters, Y-up, -Z forward (Three.js default). */
export const WORLD = {
  units: 'meters',
  up: new THREE.Vector3(0, 1, 0),
  forward: new THREE.Vector3(0, 0, -1),
} as const;
```

### glTF intake

```ts
import * as SkeletonUtils from 'three/addons/utils/SkeletonUtils.js';

async function loadActor(url: string): Promise<THREE.Object3D> {
  const gltf = await gltfLoader.loadAsync(url);
  const authoredRoot = SkeletonUtils.clone(gltf.scene); // clone skeleton graph

  // Preserve the authored root position, rotation, and scale. Put deliberate
  // unit/basis/pivot correction on an owning wrapper at the asset boundary.
  const visualRoot = new THREE.Group();
  visualRoot.name = `${authoredRoot.name || 'actor'}:visual-root`;
  visualRoot.add(authoredRoot);

  const metersPerAuthoredUnit = 1; // record from intake; do not guess from bounds
  visualRoot.scale.setScalar(metersPerAuthoredUnit);
  // If intake proved a basis correction is necessary, apply its quaternion to
  // visualRoot here. A conforming glTF is already right-handed, Y-up, meters.

  visualRoot.updateMatrixWorld(true);
  return visualRoot;
}
```

Never zero or overwrite the cloned glTF scene root to "normalize" it: that can
erase an intentionally authored placement, rotation, or scale. The outer
`visualRoot` owns verified asset-to-world correction while the cloned
`authoredRoot` remains byte-for-byte faithful in transform semantics. Put the
wrapper under a unit-scale authoritative entity root so collision, navigation,
and camera math remain in world units.

### Raycast vs collider

Keep picking meshes and collision proxies on separate layers:

```ts
const LAYER_VISUAL = 0;
const LAYER_COLLIDER = 1;

visual.layers.set(LAYER_VISUAL);
collider.layers.set(LAYER_COLLIDER);

raycaster.layers.set(LAYER_VISUAL); // UI picking
// simulation queries collider meshes / authored AABBs, not decorative LODs
```

Authoritative motion commits to the collider/proxy transform; the visual mesh
may interpolate or offset for presentation only (`spatial-contracts` §2).

# Geometry, Instancing, Batching, And LOD

## Contents

- Choose this reference when
- Novice mental model
- Smallest correct mesh
- Built-in and custom geometry
- Static merging
- `InstancedMesh`
- `BatchedMesh`
- `LOD`
- Common failures
- Performance and memory
- Disposal
- Verification
- Official documentation

## Choose This Reference When

Read this file when creating or changing visible shapes, collision proxies,
procedural meshes, vertex attributes, repeated scenery, crowds, projectiles,
world chunks, or distance-based detail. Choose the representation before
authoring lots of objects:

| Need | Preferred representation |
| --- | --- |
| One or a few distinct objects | Ordinary `Mesh` objects |
| Many copies of one geometry and material | `InstancedMesh` |
| Many objects with different compatible geometries but one material | `BatchedMesh` |
| Static meshes that never need separate transforms or identities | `mergeGeometries()` |
| Different detail at different distances | `LOD` |
| Fast gameplay collision | Simple dedicated proxy geometry, not the render mesh |

Do not optimize by object count alone. Measure draw calls, triangles, update
cost, memory, culling behavior, and the worst active gameplay state.

## Novice Mental Model

A `BufferGeometry` is GPU-ready shape data. Its named attributes are parallel
arrays: `position` holds XYZ coordinates, `normal` controls lighting, `uv`
holds texture coordinates, and `color` can hold per-vertex color. An optional
index reuses vertices between triangles. A `Mesh` adds a material and a world
transform to that shape.

Geometry coordinates are local to the object. Moving a mesh changes its
`Object3D` transform; it does not rewrite the vertices. Merging bakes transforms
into one vertex buffer. Instancing keeps one geometry but supplies many
transforms. Batching copies compatible geometries into shared GPU storage and
draws many instances of them together.

Keep three concerns separate:

1. Render geometry: what the player sees.
2. Collision geometry: the simple shape used by gameplay.
3. Spatial bounds: boxes or spheres used for culling, placement, and tests.

## Smallest Correct Mesh

Create a built-in geometry, pair it with a material, add the mesh, and retain a
clear teardown path:

```ts
import * as THREE from 'three';

export function addCrate(scene: THREE.Scene) {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({
    color: 0x4f8f62,
    roughness: 0.72,
    metalness: 0,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.y = 0.5;
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  scene.add(mesh);

  return {
    mesh,
    dispose() {
      scene.remove(mesh);
      geometry.dispose();
      material.dispose();
    },
  };
}
```

The mesh needs a light or environment because `MeshStandardMaterial` is lit.
Use `MeshBasicMaterial` only when an intentionally unlit result is wanted.

## Built-In And Custom Geometry

### Pick sane built-ins first

Use `BoxGeometry`, `SphereGeometry`, `PlaneGeometry`, `CylinderGeometry`,
`CapsuleGeometry`, `ShapeGeometry`, `ExtrudeGeometry`, or `TubeGeometry` before
writing a custom builder. Segment counts multiply vertices and triangles;
choose them from the closest expected camera distance rather than habit.

```ts
const gameplaySphere = new THREE.SphereGeometry(0.5, 16, 12);
const heroCloseupSphere = new THREE.SphereGeometry(0.5, 48, 32);
```

Planes face local +Z. Rotate a ground plane around X rather than changing the
world's up-axis contract:

```ts
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(40, 40),
  new THREE.MeshStandardMaterial({ color: 0x283229, roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.receiveShadow = true;
```

### Build an indexed custom geometry

Use typed arrays, define every attribute required by the material, then compute
bounds. Counter-clockwise triangles face outward with `FrontSide` materials.

```ts
const geometry = new THREE.BufferGeometry();

geometry.setAttribute(
  'position',
  new THREE.Float32BufferAttribute([
    -1, 0, -1,
     1, 0, -1,
     1, 0,  1,
    -1, 0,  1,
  ], 3),
);
geometry.setAttribute(
  'uv',
  new THREE.Float32BufferAttribute([
    0, 0,
    1, 0,
    1, 1,
    0, 1,
  ], 2),
);
geometry.setIndex([0, 2, 1, 0, 3, 2]);
geometry.computeVertexNormals();
geometry.computeBoundingBox();
geometry.computeBoundingSphere();
```

`setIndex(number[])` automatically selects a 16- or 32-bit index attribute from
the largest supplied index. When constructing the attribute yourself, use
`Uint32BufferAttribute` when an index is 65,535 or greater, matching Three.js's
primitive-restart-safe automatic choice. Call
`computeVertexNormals()` after changing positions only when the lighting really
needs regenerated normals. It is not a per-frame deformation strategy.

### Update dynamic attributes without allocations

Allocate once, mutate the existing attribute, then upload and recompute derived
data once per update batch. Update ranges can reduce transfer cost for a few
small edits:

```ts
const positions = geometry.getAttribute('position') as THREE.BufferAttribute;
positions.setUsage(THREE.DynamicDrawUsage); // set before first render
const normals = geometry.getAttribute('normal') as
  THREE.BufferAttribute | undefined;
normals?.setUsage(THREE.DynamicDrawUsage); // recomputed in each commit below
let verticesChanged = false;

function raiseVertex(index: number, y: number) {
  positions.setY(index, y);
  positions.addUpdateRange(index * 3 + 1, 1); // Y is one component
  verticesChanged = true;
}

function commitVertexUpdates() {
  if (!verticesChanged) return;
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  verticesChanged = false;
}
```

Call `commitVertexUpdates()` after all edits for the frame, not after every
vertex. For many scattered edits, clear the small ranges and upload one
contiguous range—or the whole attribute—rather than issuing hundreds of tiny
updates. The WebGL renderer clears processed update ranges. For frequent large
deformations, move work into a shader/TSL node or use a purpose-built dynamic
buffer. If the deformation has a known envelope, keep conservative bounds
instead of recomputing them every frame. Do not recreate geometry each frame.

## Static Merging

`mergeGeometries()` reduces draw calls only after each mesh transform is baked
into a cloned geometry. Bake `matrixWorld`, converted into the merged mesh's
declared parent space. Baking only `mesh.matrix` loses ancestor transforms.
Inputs must have compatible attribute sets and must be consistently indexed or
non-indexed.

```ts
import * as THREE from 'three';
import { mergeGeometries } from
  'three/addons/utils/BufferGeometryUtils.js';

// Contract for this example:
// - every source mesh is below commonRoot;
// - sharedMaterial is one THREE.Material used by every source;
// - every source renders its full geometry;
// - each source geometry is exclusively owned by this conversion;
// - sharedMaterial is transferred to the merged mesh.
if (staticMeshes.length === 0) {
  throw new Error('Static merge needs at least one source mesh');
}

commonRoot.updateWorldMatrix(true, true);
const rootDeterminant = commonRoot.matrixWorld.determinant();
if (!Number.isFinite(rootDeterminant) || rootDeterminant === 0) {
  throw new Error('Static merge parent has a non-invertible world transform');
}

const worldToCommonRoot = commonRoot.matrixWorld.clone().invert();
const relativeMatrix = new THREE.Matrix4();

function bakeToCommonRoot(mesh: THREE.Mesh): THREE.BufferGeometry {
  if (mesh instanceof THREE.SkinnedMesh) {
    throw new Error('Bake skinned meshes after evaluating their deformation');
  }
  const hasMorphTargets = Object.values(mesh.geometry.morphAttributes)
    .some((targets) => targets.length > 0);
  if (hasMorphTargets) {
    throw new Error('This static merge does not bake morph targets');
  }
  if (mesh.material !== sharedMaterial) {
    throw new Error('All sources must use the declared shared material');
  }

  const elementCount =
    mesh.geometry.index?.count ?? mesh.geometry.getAttribute('position').count;
  const { start, count } = mesh.geometry.drawRange;
  if (start !== 0 || (Number.isFinite(count) && count < elementCount)) {
    throw new Error('Split or copy partial draw ranges before merging');
  }

  mesh.updateWorldMatrix(true, false);
  relativeMatrix.multiplyMatrices(worldToCommonRoot, mesh.matrixWorld);
  const determinant = relativeMatrix.determinant();
  if (determinant < 0) {
    throw new Error('Reflected transforms require triangle winding reversal');
  }
  if (!Number.isFinite(determinant) || determinant === 0) {
    throw new Error('Cannot bake a non-invertible source transform');
  }
  return mesh.geometry.clone().applyMatrix4(relativeMatrix);
}

const ownedSourceGeometries = new Set(
  staticMeshes.map((mesh) => mesh.geometry),
);
const bakedParts: THREE.BufferGeometry[] = [];
try {
  for (const mesh of staticMeshes) bakedParts.push(bakeToCommonRoot(mesh));
} catch (error) {
  bakedParts.forEach((geometry) => geometry.dispose());
  throw error;
}
const mergedGeometry = mergeGeometries(bakedParts, false);

if (!mergedGeometry) {
  bakedParts.forEach((geometry) => geometry.dispose());
  throw new Error('Static geometry attributes are not merge-compatible');
}

const mergedMesh = new THREE.Mesh(mergedGeometry, sharedMaterial);
commonRoot.add(mergedMesh);

// Prevent both the originals and merged result from rendering. Because this
// example declared exclusive source-geometry ownership, release those buffers.
for (const mesh of staticMeshes) mesh.removeFromParent();
for (const geometry of ownedSourceGeometries) geometry.dispose();
bakedParts.forEach((geometry) => geometry.dispose());
```

If source geometries or materials come from an asset cache, remove the original
meshes but release their asset handles instead of disposing shared resources.
If inputs have different parents, still choose one output parent and compute
`inverse(outputParent.matrixWorld) * mesh.matrixWorld` for every source. Do not
leave originals active or the scene will render both copies.

Passing `true` as the second argument creates exactly one new group per input
geometry, with `materialIndex` equal to that input's order. It does **not**
preserve the input geometries' existing groups or `drawRange`. Supply one
material per input in the merged mesh's material array; every resulting group
still produces a draw call. If a source already uses multiple material groups
or a partial draw range, split/copy the intended ranges before merging.

`applyMatrix4()` bakes base positions, normals, and tangents, but this example
deliberately rejects morph targets and skinning. Reflections need explicit
triangle-winding reversal, so the example rejects negative-determinant
transforms. Merging is best for static scenery that is culled as one region;
avoid one giant merged world that remains visible when only a small part is on
screen.

## `InstancedMesh`

Use one `InstancedMesh` for many objects that share geometry and material but
need separate transforms, colors, identities, or raycast `instanceId` values.

```ts
const count = 500;
const geometry = new THREE.IcosahedronGeometry(0.24, 1);
const material = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.55,
});
const swarm = new THREE.InstancedMesh(geometry, material, count);
swarm.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

const transform = new THREE.Object3D();
const color = new THREE.Color();

for (let i = 0; i < count; i += 1) {
  transform.position.set(
    (Math.random() - 0.5) * 30,
    Math.random() * 5 + 0.5,
    (Math.random() - 0.5) * 30,
  );
  transform.rotation.set(0, Math.random() * Math.PI * 2, 0);
  transform.scale.setScalar(0.6 + Math.random() * 0.8);
  transform.updateMatrix();
  swarm.setMatrixAt(i, transform.matrix);

  color.setHSL(i / count, 0.65, 0.55);
  swarm.setColorAt(i, color);
}

swarm.instanceMatrix.needsUpdate = true;
if (swarm.instanceColor) swarm.instanceColor.needsUpdate = true;
swarm.computeBoundingBox();
swarm.computeBoundingSphere();
scene.add(swarm);
```

For runtime updates, change all matrices, set `instanceMatrix.needsUpdate` once,
and recompute bounds after matrices or the active count change. Negative scales
are unsupported. Keep gameplay data in arrays keyed by instance index; do not
search the scene graph for an instance.

The constructor count is the fixed capacity. `swarm.count` may draw only a
dense prefix from `0` through `count - 1`, and must never exceed that capacity.
Use swap-removal to fill holes and update any gameplay-ID mapping; do not hide a
hole with a zero or far-away matrix. Raycasting returns `instanceId`, so validate
it against active gameplay state before acting on it. For morphing instances,
call `setMorphAt()` and then mark `morphTexture.needsUpdate = true` after the
batch.

## `BatchedMesh`

Use `BatchedMesh` when many objects share one material but use several
compatible geometries. Constructor capacities are initial allocations; estimate
them before creation and resize only at controlled transitions when necessary.

```ts
const box = new THREE.BoxGeometry(1, 1, 1);
const sphere = new THREE.SphereGeometry(0.65, 16, 12);
const material = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 0.8,
});

const vertexCapacity =
  box.getAttribute('position').count + sphere.getAttribute('position').count;
const indexCapacity = (box.index?.count ?? 0) + (sphere.index?.count ?? 0);
const batch = new THREE.BatchedMesh(
  200,
  vertexCapacity,
  indexCapacity,
  material,
);

const boxId = batch.addGeometry(box);
const sphereId = batch.addGeometry(sphere);
const matrix = new THREE.Matrix4();
const position = new THREE.Vector3();

for (let i = 0; i < 200; i += 1) {
  const geometryId = i % 3 === 0 ? sphereId : boxId;
  const instanceId = batch.addInstance(geometryId);
  position.set((i % 20) - 10, 0.5, Math.floor(i / 20) - 5);
  matrix.makeTranslation(position);
  batch.setMatrixAt(instanceId, matrix);
}

// Both per-object frustum culling and object sorting default to true.
batch.computeBoundingBox();
batch.computeBoundingSphere();
scene.add(batch);
```

All registered geometries must have compatible attributes and the same indexed
or non-indexed state. Full attribute/index data is copied into batch storage;
source groups, `drawRange`, and morph attributes are not transferred. Dispose
the input geometries only when no other object owns them.

Use `addGeometry(geometry, reservedVertexCount, reservedIndexCount)` when a
future `setGeometryAt()` replacement needs more room. Replacing a geometry
changes every instance that references its ID. `deleteGeometry()` also deletes
all instances referencing that geometry; `deleteInstance()` affects only one.
Both operations free logical slots. Call `optimize()` only at a controlled
transition because it reorganizes internal ranges.

`setInstanceCount()` and `setGeometrySize()` resize capacity by reallocating and
copying internal data, so keep them out of active-frame loops. Use
`setVisibleAt()` for temporary hiding, `setGeometryIdAt()` when an instance
changes form, and `setColorAt()` with a `Color` or `Vector4` for per-object
color. Negative-scale matrices are unsupported. After adding, deleting,
replacing, or moving objects, recompute the batch bounds; `setMatrixAt()` does
not invalidate them automatically. Raycasts identify objects with `batchId`.

Prefer `InstancedMesh` for one geometry, especially when matrices change every
frame. Prefer `BatchedMesh` for mixed compatible geometry and mostly stable
objects. `perObjectFrustumCulled` and `sortObjects` default to `true`; profile
their CPU cost, and use `setCustomSort()` only when the default order is not
appropriate. Transparent sorting orders batch objects, not intersecting
triangles within an object, so transparency artifacts can still remain.

`SceneOptimizer` is an experimental addon that can replace compatible scene
meshes with `BatchedMesh` instances. It mutates the supplied scene and its
instancing conversion is not implemented in r185. Treat it as an opt-in loading
or authoring experiment: clone or otherwise preserve the source hierarchy,
inspect semantic IDs/material ownership after conversion, and keep it only when
measurement and lifecycle tests beat an explicit batch design.

## `LOD`

`LOD` selects one child by camera distance. Create visibly compatible levels,
add hysteresis to prevent boundary flicker, and test the actual gameplay lens.
Hysteresis is a fraction of the level distance, not a world-unit distance; `0.1`
offsets that level's switch threshold by ten percent while it is active.

```ts
const lod = new THREE.LOD();
lod.addLevel(highDetailMesh, 0, 0.1);
lod.addLevel(mediumDetailMesh, 18, 0.1);
lod.addLevel(lowDetailMesh, 45, 0.1);
lod.autoUpdate = true;
scene.add(lod);
```

Only one level is visible, but every level remains allocated. Share materials
and textures where possible. If using `autoUpdate = false`, call
`lod.update(camera)` from one camera/update owner. Do not use the render camera
distance as the sole rule for gameplay simulation quality.

For large worlds, combine regional culling with LOD. A single `LOD` containing
the entire world does not solve visibility, streaming, or collision cost.

## Common Failures

- **Black or strangely lit custom mesh:** normals are absent, invalid, or face
  inward. Verify triangle winding and visualize normals.
- **Texture stretches unpredictably:** `uv` is missing or has the wrong item
  count. Every vertex referenced by the index needs matching attribute data.
- **Merged objects appear at the origin:** transforms were not baked before
  merging.
- **`mergeGeometries()` returns `null`:** attribute names, item sizes, typed
  arrays, normalized flags, morph targets, or index state differ.
- **Instances disappear after moving:** bounding volumes were computed before
  the new matrices. Recompute them after the update batch.
- **Instances have stale transforms/colors:** `needsUpdate` was not set after
  all writes.
- **One shared geometry changes every object:** mutation affects all borrowers.
  Clone before making an object-specific vertex edit.
- **Transparent batch renders in the wrong order:** transparency requires
  sorting and can defeat batching assumptions. Prefer opaque/alpha-tested art
  or enable and measure batch object sorting.
- **LOD pops or changes silhouette:** levels do not share a stable pivot,
  bounds, material value, or sufficient hysteresis.
- **Collision is slow:** gameplay is testing render triangles. Replace them
  with boxes, spheres, capsules, planes, or another measured broadphase.

## Performance And Memory

- Watch WebGL `renderer.info.render.calls` or WebGPU/common
  `renderer.info.render.drawCalls`, plus triangles, geometries, and frame time
  in the worst active state. A lower draw-call count can still lose if CPU
  update or triangle cost rises.
- Share immutable geometry. Clone only at a deliberate mutation or ownership
  boundary.
- Keep procedural builders and typed-array allocation out of the hot loop.
- Set buffer usage before first render and dirty attributes once per update
  batch.
- Split static merged geometry into spatial regions so frustum culling remains
  useful.
- Keep instance gameplay data in dense typed arrays or structs indexed by
  `instanceId`.
- Use lower segment counts for distant, small, fast, or repeated objects.
- Avoid `DoubleSide` as a geometry repair; it increases fragment work and can
  conceal incorrect normals or winding.
- Use `drawRange` only when the intended range and bounds are kept consistent.
- Measure `BatchedMesh.perObjectFrustumCulled` and sorting; both trade CPU work
  for less GPU work or correct ordering.

## Disposal

Three.js does not dispose GPU resources when an object leaves the scene.
Ownership must be explicit:

```ts
scene.remove(swarm);
swarm.dispose(); // releases an internal morph texture if one exists
geometry.dispose();
material.dispose();

scene.remove(batch);
batch.dispose(); // releases its internal geometry and data textures
material.dispose(); // only if this owner created and exclusively owns it
```

`InstancedMesh.dispose()` does not dispose its geometry or material.
`BatchedMesh.dispose()` disposes its internal geometry and textures but not its
material. `LOD` does not dispose child resources. Use reference counts or one
asset owner when resources are shared, and deduplicate geometries/materials
before disposal.

## Verification

1. Render the mesh with a normal material and a temporary wireframe view.
2. Add `Box3Helper`, `BoxHelper`, or `AxesHelper` only in debug builds to verify
   bounds, pivot, scale, and axes. Import the addon `VertexNormalsHelper`
   explicitly from `three/addons/helpers/VertexNormalsHelper.js`; it is not a
   `THREE` namespace export.
3. Rotate the camera around custom and merged geometry to find missing or
   reversed faces.
4. Move the furthest instance beyond its original bounds and confirm it remains
   visible and pickable.
5. Raycast an instanced object and verify the returned `instanceId` maps to the
   expected game record.
6. Cross every LOD threshold slowly in both directions and look for flicker,
   pivot changes, value shifts, and silhouette pops.
7. Compare calls, triangles, CPU frame time, and GPU frame time before and after
   merging, instancing, or batching.
8. Remove and recreate the system repeatedly, then confirm
   `renderer.info.memory.geometries` reaches a stable plateau. Internal reusable
   resources can legitimately remain allocated, so an exact return to the
   initial count is not required.

## Official Documentation

- [BufferGeometry](https://threejs.org/docs/pages/BufferGeometry.html)
- [BufferAttribute](https://threejs.org/docs/pages/BufferAttribute.html)
- [Built-in geometries](https://threejs.org/manual/en/primitives.html)
- [Custom BufferGeometry](https://threejs.org/manual/en/custom-buffergeometry.html)
- [BufferGeometryUtils](https://threejs.org/docs/pages/module-BufferGeometryUtils.html)
- [InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html)
- [BatchedMesh](https://threejs.org/docs/pages/BatchedMesh.html)
- [SceneOptimizer](https://threejs.org/docs/pages/SceneOptimizer.html)
- [LOD](https://threejs.org/docs/pages/LOD.html)
- [Optimizing many objects](https://threejs.org/manual/en/optimize-lots-of-objects.html)
- [How to dispose of objects](https://threejs.org/manual/en/how-to-dispose-of-objects.html)

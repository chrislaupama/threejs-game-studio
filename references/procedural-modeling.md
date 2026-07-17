# Procedural Model Recipes

## Contents

- Modeling principles and polished content floor
- Hero vehicle and character recipes
- Threat, reward, and world-kit recipes
- Geometry recipes and official constraints
- Hard edges, UVs, materials, diagnostics, and disposal
- Official documentation

These recipes are for scratch-built Three.js models when procedural art is the
chosen production method. The goal is not automatic photorealism; it is
authored, layered, readable browser-game art.

## Modeling Principles

- Start with silhouette. A model should be recognizable as a dark shape before materials or glow.
- Combine primitive bases with authored geometry: extrusions, bevels, curves, tubes, lathes, custom buffers, decals, trim, and instanced micro-detail.
- Use asymmetry and functional parts: hinges, fins, vents, handles, rails, brackets, sensors, cables, panels, bolts.
- Put detail where the camera sees it. Spend triangles on player-facing surfaces, not hidden undersides.
- Create state variants through material swaps, animated child parts, emissive strips, and VFX sockets.
- Keep a simple collision proxy separate from the detailed visual group.
- Use shared geometries/materials and instancing for repeated bolts, panels, lights, windows, spikes, rocks, or rail segments.
- Name important child meshes: `cockpitGlass`, `leftEngine`, `hazardTeeth`, `pickupCore`, `collisionProxy`.

## Minimum Premium Asset Pass

For a game that asks for polished/premium/showcase quality, build at least:

- One hero/player model with readable front/up/side and three state cues.
- Three obstacle/enemy variants with unique silhouettes and telegraphs.
- Two reward/interactable variants with idle and collect states.
- One world prop kit with at least eight reusable parts.
- One material kit with trim, decals, panel lines, and emissive masks.
- Collision proxies and renderer diagnostics for the above.

## Hero Vehicle Recipe

Use for runners, racers, hovercraft, spaceships, drones, or arcade vehicles.

- Core hull: `ExtrudeGeometry` or custom tapered `BufferGeometry`, not just a box.
- Nose/front: wedge, intake, sensor strip, bumper, or blade shape.
- Cockpit/core: glass dome from sphere/lathe segments, beveled capsule, or faceted canopy.
- Engines: cylinders/cones/tubes with nozzle rings, inner emissive discs, heat fins, and trail sockets.
- Wings/fins: extruded triangular or curved plates with bevel/trim lines.
- Undercarriage: skids, landing pads, rail clamps, suspension arms, or thruster pods.
- Decals: panel lines, numeric marks, faction glyph, hazard ticks, small bolts.
- State cues: boost flares, shield shell, damage scorch, pickup glow, overheat red.
- Collision proxy: one capsule/box/sphere group matching gameplay footprint.

Reject if the hero is mostly a box with two cylinders and a glow.

### Worked hero factory: readable hovercraft

This compact factory demonstrates the production contract: a custom silhouette,
named functional parts, material roles, VFX sockets, a separate gameplay
collider, one boost cue, and one disposal owner. It is a foundation example,
not the complete premium content floor above; add at least two more authored
states such as damage and shield/selection. Treat dimensions as metres and
declare the game's forward axis before adapting it.

```ts
import * as THREE from 'three'

type HovercraftAsset = {
  root: THREE.Group
  collider: { center: THREE.Vector3; halfExtents: THREE.Vector3 }
  sockets: { leftTrail: THREE.Object3D; rightTrail: THREE.Object3D }
  setBoosting(active: boolean): void
  dispose(): void
}

function taperedHullGeometry(): THREE.BufferGeometry {
  // Local forward is -Z. The narrow front gives a readable heading.
  const positions = new Float32Array([
    -0.45, -0.18, -1.45,   0.45, -0.18, -1.45,
    -0.78, -0.22,  0.70,   0.78, -0.22,  0.70,
    -0.30,  0.24, -1.20,   0.30,  0.24, -1.20,
    -0.62,  0.32,  0.55,   0.62,  0.32,  0.55,
  ])
  // Counter-clockwise when viewed from outside. Reversing any triangle makes
  // that face disappear with the default FrontSide material.
  const indices = [
    0, 1, 2, 1, 3, 2,       // underside
    4, 6, 5, 5, 6, 7,       // upper deck
    0, 4, 1, 1, 4, 5,       // nose
    2, 3, 6, 3, 7, 6,       // rear
    0, 2, 4, 2, 6, 4,       // left side
    1, 5, 3, 3, 5, 7,       // right side
  ]
  const geometry = new THREE.BufferGeometry()
  geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3))
  geometry.setIndex(indices)
  geometry.computeVertexNormals()
  geometry.computeBoundingBox()
  geometry.computeBoundingSphere()
  return geometry
}

export function createHovercraft(): HovercraftAsset {
  const root = new THREE.Group()
  root.name = 'hovercraft'

  const body = new THREE.MeshStandardMaterial({
    color: 0x2d4b73,
    metalness: 0,
    roughness: 0.32,
    // The hull reuses eight vertices, so flat shading preserves hard panels.
    flatShading: true,
  })
  const trim = new THREE.MeshStandardMaterial({
    color: 0xe9eef5,
    metalness: 1,
    roughness: 0.24,
  })
  const glass = new THREE.MeshPhysicalMaterial({
    color: 0x75d6ff,
    roughness: 0.12,
    metalness: 0,
    transmission: 0.35,
    thickness: 0.08,
  })
  const engine = new THREE.MeshStandardMaterial({
    color: 0x17202b,
    metalness: 1,
    roughness: 0.28,
  })
  const thrusterGlow = new THREE.MeshStandardMaterial({
    color: 0x06131d,
    emissive: 0x27a8ff,
    emissiveIntensity: 0.8,
    metalness: 0,
    roughness: 0.5,
  })

  const hull = new THREE.Mesh(taperedHullGeometry(), body)
  hull.name = 'mainHull'
  hull.castShadow = true
  hull.receiveShadow = true
  root.add(hull)

  const canopy = new THREE.Mesh(
    new THREE.SphereGeometry(0.48, 20, 12, 0, Math.PI * 2, 0, Math.PI * 0.52),
    glass,
  )
  canopy.name = 'cockpitGlass'
  canopy.scale.set(0.9, 0.62, 1.35)
  canopy.position.set(0, 0.27, -0.34)
  root.add(canopy)

  const engineGeometry = new THREE.CylinderGeometry(0.22, 0.28, 0.72, 16)
  engineGeometry.rotateX(Math.PI / 2)
  const leftEngine = new THREE.Mesh(engineGeometry, engine)
  leftEngine.name = 'leftEngine'
  leftEngine.position.set(-0.63, 0.02, 0.52)
  const rightEngine = leftEngine.clone()
  rightEngine.name = 'rightEngine'
  rightEngine.position.x *= -1
  root.add(leftEngine, rightEngine)

  // Restrict emissive energy to authored nozzle surfaces, not the whole engine.
  const nozzleGlowGeometry = new THREE.CylinderGeometry(0.13, 0.13, 0.02, 16)
  nozzleGlowGeometry.rotateX(Math.PI / 2)
  for (const side of [-1, 1] as const) {
    const nozzleGlow = new THREE.Mesh(nozzleGlowGeometry, thrusterGlow)
    nozzleGlow.name = side < 0 ? 'leftNozzleGlow' : 'rightNozzleGlow'
    nozzleGlow.position.set(side * 0.63, 0.02, 0.89)
    root.add(nozzleGlow)
  }

  const finGeometry = new THREE.BoxGeometry(0.08, 0.30, 0.72)
  for (const side of [-1, 1] as const) {
    const fin = new THREE.Mesh(finGeometry, trim)
    fin.name = side < 0 ? 'leftFin' : 'rightFin'
    fin.position.set(side * 0.78, 0.06, 0.26)
    fin.rotation.z = side * -0.18
    root.add(fin)
  }

  const leftTrail = new THREE.Object3D()
  leftTrail.name = 'leftTrailSocket'
  leftTrail.position.set(-0.63, 0.02, 0.94)
  const rightTrail = leftTrail.clone()
  rightTrail.name = 'rightTrailSocket'
  rightTrail.position.x *= -1
  root.add(leftTrail, rightTrail)

  // Gameplay collision stays stable even when visual children animate. This
  // forgiving proxy intentionally excludes cosmetic fin tips.
  const collider = {
    center: new THREE.Vector3(0, 0.02, -0.18),
    halfExtents: new THREE.Vector3(0.72, 0.28, 1.02),
  }

  return {
    root,
    collider,
    sockets: { leftTrail, rightTrail },
    setBoosting(active) {
      thrusterGlow.emissiveIntensity = active ? 3.2 : 0.8
    },
    dispose() {
      const geometries = new Set<THREE.BufferGeometry>()
      const materials = new Set<THREE.Material>()
      root.traverse((object) => {
        if (!(object instanceof THREE.Mesh)) return
        geometries.add(object.geometry)
        const list = Array.isArray(object.material)
          ? object.material
          : [object.material]
        for (const material of list) materials.add(material)
      })
      for (const geometry of geometries) geometry.dispose()
      for (const material of materials) material.dispose()
      root.removeFromParent()
    },
  }
}
```

If factories share a global geometry or material library, the library—not each
asset instance—owns disposal. Add reference counting only when real dynamic
loading makes simple scene-level ownership insufficient.

The hull intentionally combines an indexed eight-vertex shape with
`flatShading`. Shared indexed vertices otherwise average adjacent face normals
and round off the panel edges. For selective smoothing, duplicate vertices at
hard boundaries or use `toCreasedNormals()` from
`three/addons/utils/BufferGeometryUtils.js`; it produces geometry with normals
split at the chosen crease angle. It modifies a non-indexed input and converts
an indexed input to a new non-indexed geometry, so clone first when ownership
requires preserving the source. Keep smooth shading for truly curved parts.

This hull does not need UVs because it uses solid colors. Before adding mapped
paint, decals, or normal detail, author a matching `uv` attribute and duplicate
vertices at UV seams. Tangent-space normal maps also need a valid UV/tangent
basis; use the MikkTSpace tangent utility when matching a MikkTSpace-authored
normal map.

## Hero Character Recipe

Use for arena fighters, brawlers, platformers, or stylized third-person games.

- Body mass: torso, pelvis, head/helmet, limbs with tapered capsule/cylinder custom scales.
- Rig illusion: separate shoulders, elbows, knees, wrists, ankles, belt, backpack, armor plates.
- Face/identity: visor, mask, hair/helmet crest, color-blocked silhouette, weapon/tool.
- Animation-ready pivots: group limbs under named joints even if animation is procedural.
- Material zones: skin/fabric/armor/metal/glass/emissive accents.
- State cues: hit flash material, shield ring, attack trail socket, stamina/charge glow.
- Collision proxy: capsule or cylinder independent of mesh detail.

Reject if the character reads as stacked spheres/cylinders with no costume, joints, or silhouette.

## Obstacle And Enemy Families

Build distinct gameplay reads:

- Low barrier: ground-hugging slab, spikes, rails, caution panels, animated warning light.
- Gate/arch: overhead frame, side posts, pulsing pass/avoid lane, moving shutters.
- Moving hazard: rotating arm, sweeper beam, drone, crusher, sliding block, orbiting mines.
- Trap/zone: laser grid, electric puddle, collapsing tile, gravity well, proximity mine.
- Enemy: body core, sensor/head, weapon, shield, locomotion/hover base, attack telegraph.

Each variant needs:

- Unique silhouette.
- Material cue for danger.
- Telegraph from distance.
- Animation or state change.
- Collision proxy.
- Low-cost repeated detail.

Reject if all hazards are recolored cubes/cones.

## Reward And Interactable Recipes

Rewards should be readable and desirable during motion.

- Token: outer ring, inner core, value icon, shimmer cards, collect burst socket.
- Shard: faceted crystal, metal bracket, orbiting chips, emissive seam.
- Capsule: glass shell, suspended item, end caps, rotating label strip.
- Power-up: icon silhouette matched to effect, color and shape differ from score pickups.
- Objective item: larger scale, unique motion, UI echo, stronger lighting/VFX.

States:

- Idle: slow rotation, pulse, bob, or orbit.
- Attract: line/trail toward player.
- Collect: vanish, burst, score trail, HUD meter update.

Reject if rewards are plain spheres or torus rings without state feedback.

## World Prop Kit

Build modular props that can be instanced and recombined:

- Track/road: lane plates, seams, arrows, side rails, guard segments, repair panels.
- Arena: boundary rings, floor tiles, spawn pads, cover blocks, goal markers.
- City/sci-fi: window strips, antennas, rooftop units, bridge trusses, pylons, billboards.
- Nature: rocks from custom faceted buffers, cliffs, roots, crystals, grasses as cards.
- Industrial: pipes, vents, cables, tanks, crates, gantries, lights, warning signs.
- Space/air: debris panels, satellites, buoys, asteroid chunks, parallax dust.

Layer the kit:

- Near props create speed and scale.
- Mid props define the playable corridor.
- Far props create depth without stealing draw calls.

Reject if the world is mostly stretched boxes or a flat plane.

## Procedural Geometry Techniques

Choose the constructor by topology and update rate, not only by silhouette:

| Tool | Strong uses | Important constraint |
| --- | --- | --- |
| `ExtrudeGeometry` | Panels, fins, wings, signs, thick glyphs | Extrudes a 2D `Shape`; beveling is unavailable when `extrudePath` is used |
| `LatheGeometry` | Nozzles, domes, bottles, turret bases | Revolves `Vector2` profile points around Y; profile X values should be greater than zero |
| `TubeGeometry` | Static cables, pipes, rails, curved weapons | Samples a curve at construction; changing the curve later does not update the geometry |
| `ShapeGeometry` | Flat badges, icons, plates, hazard markers | Triangulates a planar shape; it does not project onto another mesh like a decal |
| `DecalGeometry` addon | Projected scratches, markings, damage, paint | Samples base geometry into a world-space snapshot; deformed targets need an evaluated snapshot source |
| Custom `BufferGeometry` | Hulls, rocks, shards, wedges, terrain | Winding, normals, UVs, bounds, and update ownership are the author’s responsibility |
| `InstancedMesh` | Many copies of one geometry/material | Fixed instance capacity; active instances occupy a dense prefix |
| `BatchedMesh` | Mixed compatible geometries sharing one material | Copies full geometry data; source groups, draw ranges, and morph data are not transferred |
| `LOD` | Hero/background variants and prop reductions | All levels remain allocated; hysteresis is a fraction of the distance threshold |

### Compact shape recipes

Build a beveled plate from a closed XY profile. Keep bevel segments low on
small or repeated parts:

```ts
const finProfile = new THREE.Shape()
finProfile.moveTo(-0.48, -0.18)
finProfile.lineTo(0.46, -0.10)
finProfile.lineTo(0.18, 0.24)
finProfile.lineTo(-0.38, 0.18)
finProfile.closePath()

const finGeometry = new THREE.ExtrudeGeometry(finProfile, {
  depth: 0.06,
  steps: 1,
  bevelEnabled: true,
  bevelSize: 0.018,
  bevelThickness: 0.018,
  bevelSegments: 2,
})
finGeometry.center()
```

Lathe a positive-X profile around Y, and sample a static curve into a cable:

```ts
const nozzleGeometry = new THREE.LatheGeometry([
  new THREE.Vector2(0.11, -0.34),
  new THREE.Vector2(0.18, -0.26),
  new THREE.Vector2(0.22, 0.18),
  new THREE.Vector2(0.15, 0.32),
], 24)

const cablePath = new THREE.CatmullRomCurve3([
  new THREE.Vector3(-0.7, 0.4, 0.1),
  new THREE.Vector3(-0.2, 0.2, 0.25),
  new THREE.Vector3(0.35, 0.5, 0.15),
  new THREE.Vector3(0.8, 0.3, -0.1),
])
const cableGeometry = new THREE.TubeGeometry(
  cablePath,
  40,   // tubular segments
  0.025,
  6,    // radial segments
  false,
)
```

For a cable, trail, rope, or ribbon that deforms every frame, allocate a custom
buffer once and update its positions in batches. Rebuilding `TubeGeometry`
every frame creates avoidable CPU work and garbage.

Use the decal addon for markings that must conform to a target mesh:

```ts
import { DecalGeometry } from 'three/addons/geometries/DecalGeometry.js'

function createDecal(
  target: THREE.Mesh,
  texture: THREE.Texture,
  position: THREE.Vector3,
  orientation: THREE.Euler,
) {
  target.updateWorldMatrix(true, false)
  const geometry = new DecalGeometry(
    target,
    position,
    orientation,
    new THREE.Vector3(0.35, 0.35, 0.12),
  )
  const material = new THREE.MeshStandardMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -4,
  })
  const decal = new THREE.Mesh(geometry, material)

  // DecalGeometry outputs world-space positions. Convert them to this rigid
  // target's local space before parenting so later Object3D motion is shared.
  geometry.applyMatrix4(target.matrixWorld.clone().invert())
  target.add(decal)
  return decal
}
```

The decal mesh, material, and texture still need explicit ownership and
disposal. Projection across a sharp corner can stretch or distort triangles;
use smaller projectors or split the marking by surface. The helper handles rigid
target motion; re-project if the target geometry itself changes.
`DecalGeometry` reads base position/normal attributes, so it does not follow
morph targets or skinned deformation. For a one-time deformed snapshot,
`BufferGeometryUtils.computeMorphedAttributes()` provides the evaluated
attributes needed to build a temporary projection source.

When real bevel geometry is too expensive, add deliberate trim geometry or use
material/normal detail. Avoid nearly coplanar duplicate panels: they flicker
because of z-fighting. Give layers real separation or use a measured
`polygonOffset` policy for decal-like surfaces.

## Production Factory Contract

Every reusable procedural factory should make these decisions explicit:

- Units, local forward/up axes, origin, pivot, and intended scale.
- Parameter ranges and a seeded random input when variation must be replayable.
- Named meshes, animation pivots, VFX/audio sockets, and gameplay attachment points.
- Render bounds and a separate collision proxy that intentionally matches gameplay.
- Which geometries, materials, and textures are shared versus exclusively owned.
- One teardown path that removes the root and disposes each exclusively owned resource once.
- Expected mesh count, triangles, draw calls, and distance/culling strategy.

Compute bounding boxes and spheres after procedural vertex edits, not before.
Keep transforms on the root when the asset moves; rewrite vertices only when the
shape itself changes. See [Geometry, Instancing, Batching, And LOD](geometry.md)
for dynamic-buffer, merge, instance, batch, and ownership recipes.

## Material And Detail Rules

- Use roughness/metalness contrast, not only hue contrast. In a physical
  workflow, most texels are dielectric (`metalness = 0`) or metal
  (`metalness = 1`); encode mixed surfaces in a map rather than choosing an
  arbitrary whole-object midpoint.
- Give reflective metals a suitable `scene.environment` or `envMap`; without
  reflected surroundings, even correct metallic values read dull or black.
- Use emissive for authored signals, screens, seams, and nozzles—not entire
  objects. Emissive appearance does not cast light into the scene by itself.
- Use `MeshPhysicalMaterial` features such as transmission, clearcoat, sheen,
  and iridescence only where they materially improve the asset; they add
  per-pixel cost. Keep `opacity = 1` when using physical transmission.
- Add darker contact zones through geometry, textures, ambient occlusion, or
  lighting rather than a floating coplanar patch.
- Use decals and trim to imply scale and function. Reuse UI icon shapes as
  world markings for cohesion.
- Preserve comparable color value, roughness, and emissive cues across LODs so
  a geometry transition does not look like a material pop.

## Diagnostics Checklist

After a model pass, report:

- Mesh count.
- Instanced mesh count.
- Unique geometries/materials/textures.
- Triangles and render calls in the worst active view, using `renderer.info`.
- Approximate geometry bytes per unique geometry with
  `BufferGeometryUtils.estimateBytesUsed()`; texture/GPU overhead is separate.
- Collision proxies included.
- LOD or culling strategy for repeated/background props.
- Bounds, winding, hard-edge normals, UV seams, decal depth, and transparency
  checked from multiple camera angles.
- Dynamic states checked: boost, damage, collect, open/closed, destroyed, and
  the most expensive repeated configuration.
- Active-play screenshots, not only showroom renders.

## Official Documentation

- [BufferGeometry](https://threejs.org/docs/pages/BufferGeometry.html)
- [BufferGeometryUtils](https://threejs.org/docs/pages/module-BufferGeometryUtils.html)
- [Custom BufferGeometry manual](https://threejs.org/manual/en/custom-buffergeometry.html)
- [ExtrudeGeometry](https://threejs.org/docs/pages/ExtrudeGeometry.html)
- [LatheGeometry](https://threejs.org/docs/pages/LatheGeometry.html)
- [TubeGeometry](https://threejs.org/docs/pages/TubeGeometry.html)
- [ShapeGeometry](https://threejs.org/docs/pages/ShapeGeometry.html)
- [DecalGeometry](https://threejs.org/docs/pages/DecalGeometry.html)
- [InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html)
- [BatchedMesh](https://threejs.org/docs/pages/BatchedMesh.html)
- [LOD](https://threejs.org/docs/pages/LOD.html)
- [MeshStandardMaterial](https://threejs.org/docs/pages/MeshStandardMaterial.html)
- [MeshPhysicalMaterial](https://threejs.org/docs/pages/MeshPhysicalMaterial.html)

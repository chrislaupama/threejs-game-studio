# Procedural Model Recipes

## Contents

- Modeling principles and polished content floor
- Hero vehicle and character recipes
- Threat, reward, and world-kit recipes
- Geometry, material, detail, and diagnostic rules

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
collider, and one disposal owner. Treat dimensions as metres and declare the
game's forward axis before adapting it.

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
  const indices = [
    0, 2, 1, 1, 2, 3,       // underside
    4, 5, 6, 5, 7, 6,       // upper deck
    0, 1, 4, 1, 5, 4,       // nose
    2, 6, 3, 3, 6, 7,       // rear
    0, 4, 2, 2, 4, 6,       // left side
    1, 3, 5, 3, 7, 5,       // right side
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
    metalness: 0.45,
    roughness: 0.32,
  })
  const trim = new THREE.MeshStandardMaterial({
    color: 0xe9eef5,
    metalness: 0.7,
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
    emissive: 0x27a8ff,
    emissiveIntensity: 0.8,
    metalness: 0.65,
    roughness: 0.28,
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

  // Gameplay collision stays stable even when visual children animate.
  const collider = {
    center: new THREE.Vector3(0, 0.02, -0.18),
    halfExtents: new THREE.Vector3(0.72, 0.28, 1.02),
  }

  return {
    root,
    collider,
    sockets: { leftTrail, rightTrail },
    setBoosting(active) {
      engine.emissiveIntensity = active ? 3.2 : 0.8
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

- `ExtrudeGeometry`: panels, fins, wings, badges, UI/world glyphs, signs.
- `LatheGeometry`: capsules, domes, engines, pipes, bottles, turret bases.
- `TubeGeometry`: cables, rails, trails, conduits, curved weapons.
- Custom `BufferGeometry`: tapered hulls, rocks, shards, wedges, low-poly terrain.
- `ShapeGeometry`: decals, flat icons, trim strips, hazard markers.
- `InstancedMesh`: windows, bolts, lane markers, debris, grass, lights, small props.
- `LOD`: hero/background variants and dense prop reductions.

Use bevel-like layering when real bevel geometry is too expensive: duplicate thin trim meshes, edge strips, or slightly offset darker panels.

## Material And Detail Rules

- Use roughness/metalness contrast, not only hue contrast.
- Use emissive for authored signals, not entire objects.
- Use glass/clearcoat sparingly on hero details.
- Add darker contact material under important objects.
- Use decals to imply scale and function.
- Reuse UI icon shapes as world decals for cohesion.

## Diagnostics Checklist

After a model pass, report:

- Mesh count.
- Instanced mesh count.
- Unique geometries/materials/textures.
- Approximate triangle count if available.
- Collision proxies included.
- LOD or culling strategy for repeated/background props.
- Active-play screenshots, not only showroom renders.

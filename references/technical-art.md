# Technical Art For Three.js Apps And Games

## Contents

- Technical-art brief and render budgets
- Material/shader and VFX systems
- Instancing, batching, LOD, culling, adaptive quality, and cleanup
- Surface detail, readability, and reporting

Use this reference before polished/showcase graphics work,
shader/material/post-processing changes, VFX systems, imported-local-asset
cleanup, LOD/instancing work, or any visual pass that could affect browser
performance.

Technical art bridges art direction and real-time constraints. The goal is
readable authored detail that survives active interaction, mobile viewports,
and the chosen WebGL or WebGPU budget.

Primary Three.js references: [WebGLRenderer.info](https://threejs.org/docs/pages/WebGLRenderer.html),
[InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html),
[BatchedMesh](https://threejs.org/docs/pages/BatchedMesh.html),
[LOD](https://threejs.org/docs/pages/LOD.html), and
[KTX2Loader](https://threejs.org/docs/pages/KTX2Loader.html).

## Technical Art Brief (Broad Visual Work)

Before a broad visual implementation, write the following. For a focused
performance or asset fix, preserve the established art direction and record
only the affected budget, baseline, and tradeoff.

- Art direction in renderable terms: shapes, materials, lighting, VFX, camera, UI/world motifs.
- Hero surfaces: what must look authored at active-play distance.
- Support surfaces: what can be procedural, instanced, simplified, or culled.
- Material kit: named roles, not one-off colors.
- VFX language: event-driven effects and state readability.
- Lighting stack: key/fill/rim/practical/contact/depth.
- Render budget target: draw calls, triangles, textures, materials, DPR, shadow/post cost.
- Asset strategy: procedural / project-local / user-supplied / hybrid local.
- Mobile constraint: what changes first if performance or readability fails.

## Render Budget Starting Points

These are starting contracts, not universal limits — measure on the target game,
and document every deliberate overrun as a tradeoff. The canvas inspector
(`npm run inspect:canvas`) compares live diagnostics against the same numbers
and reports over-budget rows. In a non-scaffold project, capture equivalent
`renderer.info` and viewport/DPR evidence directly when that command is absent.

| Metric (worst active-play view) | Desktop tier | Mobile tier |
| --- | --- | --- |
| Draw calls (`info.render.calls`) | <= 300 | <= 150 |
| Triangles (`info.render.triangles`) | <= 750k | <= 300k |
| Geometries (`info.memory.geometries`) | <= 300 | <= 200 |
| Textures (`info.memory.textures`) | <= 60 | <= 40 |
| Texture memory (est.) | <= 256 MB | <= 128 MB |
| Shadow-casting lights | <= 2 | 1 |
| Shadow map size | <= 2048 | <= 1024 |
| DPR cap | 2 | 1.5-2 |
| Post passes (beyond render+output) | <= 2 | 0-1 |

How to spend within them:

- Draw calls: repeated world/detail pieces should be instanced or merged by material.
- Triangles: spend on silhouettes near the camera; reduce background detail through LOD, impostors, or simplified meshes.
- Materials: share material roles aggressively. Unique material count often grows faster than geometry count.
- Textures: keep opaque large images compressed or small; avoid unique 2K+ textures for tiny repeated props.
- Shadows: reserve real shadows for hero objects and grounding anchors; use
  blob/contact meshes for small repeated props (see `shaders.md`).
- Post: every pass must earn its cost and preserve interaction clarity; concrete
  chain settings are in `shaders.md`.

Always report actual renderer diagnostics after the graphics pass: calls, triangles, geometries, textures, material count if available, post passes, shadow settings, DPR cap, and bottlenecks.

For a multi-pass WebGL frame, prevent `renderer.info` from resetting at every
pass and take the snapshot after the full frame:

```ts
renderer.info.autoReset = false;

function renderFrame(): void {
  renderer.info.reset();
  composer.render(); // or render every explicit pass here
  publishRendererInfo(renderer.info); // totals for this complete frame
}
```

If a framework or post stack owns rendering, place the reset and snapshot at
its outer frame boundary. Do not compare a single beauty-pass count against a
full multi-pass budget.

Estimate texture memory rather than treating `info.memory.textures` as bytes.
For an uncompressed 2D RGBA8 texture, use roughly
`width * height * 4 * 4/3` bytes with a complete mip chain. Cube maps multiply
by six; array/3D textures multiply by layers/depth; half-float RGBA is roughly
eight bytes per texel; block-compressed GPU formats need format-specific math.
Browser and driver allocations still vary, so label the number an estimate.

## Material And Shader System

Use a material kit of named shared roles, not one-off colors. Reuse each role across every mesh that plays the same part:

- `bodyPrimary`: dominant player/world shell.
- `bodySecondary`: panel contrast.
- `trim`: rails, bevel highlights, borders, edge highlights.
- `hazard`: danger surfaces, damage cues, warning stripes.
- `reward`: collectible surfaces with readable value.
- `shieldBoost`: shield, boost, and status states.
- `glass`: cockpit, shield, lens, visor.
- `emissiveSignal`: authored glow strips, status lights, beacon cores.
- `groundContact`: dark matte surfaces and shadow receivers.
- `decalDark` and `decalLight`: panel lines, scratches, numbers, icons.
- UI/world signal colors shared between HUD and diegetic markers.

Use `MeshStandardMaterial` for most surfaces. Use `MeshPhysicalMaterial` selectively for cockpit glass, clearcoat panels, iridescent shields, or premium hero details. Share materials across repeated meshes.

Build procedural material variation from shared causes rather than unrelated
noise in every channel:

1. Choose stable object, world, or UV coordinates at the correct physical
   scale.
2. Derive structural masks such as panels, seams, edges, cavities, or height.
3. Assign material identities, then apply causal modifiers such as wear,
   moisture, age, heat, or exposure.
4. Derive color, roughness, normal, metalness, and emission from those shared
   causes so the channels tell the same surface story.
5. Filter or fade microdetail with distance to prevent shimmer and noise.

Expose perceptual controls such as wear amount, edge width, wetness, or detail
scale, plus useful mask/channel debug views. A reduced quality tier may simplify
detail or resolution, but must preserve the mechanism that gives the material
its identity.

Shader or `onBeforeCompile` work must have a reason:

- State readability: shield ripple, heat, cloak, damage pulse.
- Surface identity: water, forcefield, hologram, scanline, energy core.
- Performance: cheap procedural variation instead of many textures.
- Composition: separating player/threat/reward from background.

Reject shader work that only adds noise, bloom bait, or hidden cost without
improving active-play decisions. When shader work is justified, use the recipes
in `shaders.md` and validate them against the installed Three.js version.

## VFX Readability

Every VFX effect must answer:

- What event or state triggers it?
- What does it tell the player?
- Does it point to player, threat, reward, objective, or impact?
- How long does it last?
- Is it pooled or cheap to recreate?
- Does it obscure collision, HUD, or the next decision?
- Is there a reduced-motion fallback for heavy shake/strobe?

Use event-driven VFX over permanent particle clutter:

- Pickup: ring contraction, shard burst, score trail, brief HUD echo.
- Hit/fail: impact ring, debris, damage flash, brief hit pause, camera impulse.
- Boost/speed: engine trail, lane streaks, FOV ease, side streaks, audio pitch.
- Near miss/combo: side spark, line snap, badge pulse, streak counter.
- Shield/invulnerable: refractive shell, rim pulse, absorbed-impact ripple, material swap.
- Spawn/despawn: anticipation pulse, telegraph, dissolve or scale snap.

Pool effects and reuse geometries/materials. Permanent particle fields must stay cheap and sparse.

## Choose Separate, Merge, Instance, Or Batch

| Structure | Choose when | Main tradeoff |
| --- | --- | --- |
| Separate `Mesh` objects | Few objects, unique materials/behavior | Most flexible, most draw calls |
| Merged `BufferGeometry` | Static geometry, one material, no per-object identity | Cheap submission, hard to update/cull individually |
| `InstancedMesh` | Same geometry and material, many transforms/colors | One draw call family; per-instance data only |
| `BatchedMesh` | Different geometries sharing a material | Multi-draw batch with capacity planning |
| `LOD` | One object needs distance variants | More asset variants and transition tuning |

Use `BufferGeometryUtils.mergeGeometries()` for compatible static geometry.
Do not claim shared materials alone batch draw calls. Sharing reduces state and
program churn; merging, instancing, or batching reduces submissions.

## Instancing, Batching, LOD, And Culling

Use instancing for many copies with the same geometry/material and different transforms: windows, bolts, lane markers, city lights, debris, foliage-like props, stars, crowd cards, track panels, repeated pickups, background modules.

Rules:

- Update `instanceMatrix.needsUpdate` and `instanceColor.needsUpdate` only after batched changes.
- Compute or update bounds for instanced groups when transforms change materially.
- Do not instance everything blindly. Different materials or constantly changing transforms can erase the win.
- Keep collision separate from instanced visual detail.

Minimal instancing update:

```ts
const instances = new THREE.InstancedMesh(geometry, material, count);
const transform = new THREE.Object3D();

for (let index = 0; index < count; index += 1) {
  transform.position.copy(positions[index]);
  transform.quaternion.copy(rotations[index]);
  transform.scale.setScalar(scales[index]);
  transform.updateMatrix();
  instances.setMatrixAt(index, transform.matrix);
}

instances.instanceMatrix.needsUpdate = true;
instances.computeBoundingSphere();
scene.add(instances);
```

Use `BatchedMesh` when one shared material covers a kit of different geometry:

```ts
const batch = new THREE.BatchedMesh(
  500,   // maximum instances
  80_000, // total reserved vertices
  160_000, // total reserved indices
  worldMaterial,
);

const crateGeometryId = batch.addGeometry(crateGeometry);
const barrierGeometryId = batch.addGeometry(barrierGeometry);
const crateId = batch.addInstance(crateGeometryId);
const barrierId = batch.addInstance(barrierGeometryId);
batch.setMatrixAt(crateId, crateMatrix);
batch.setMatrixAt(barrierId, barrierMatrix);
batch.computeBoundingSphere();
scene.add(batch);
```

Plan capacity from content counts and geometry sizes. Use per-instance
visibility for pooled objects and call `optimize()` only at an intentional
maintenance/loading boundary, not during active play. `batch.dispose()` frees
its GPU buffers; keep ownership of source geometries/materials explicit.

Use LOD when:

- A hero/background object spans large distance ranges.
- The silhouette matters near camera but not far away.
- Imported local models are heavier than needed for background use.

Rules:

- Add hysteresis or distance gaps to reduce visible popping.
- Use impostor cards or simplified silhouettes for far layers when appropriate.
- Verify LOD transitions during real camera motion, not only a static inspection.

Prefer hysteresis to rapid boundary flicker:

```ts
const lod = new THREE.LOD();
lod.addLevel(nearMesh, 0, 0.1);
lod.addLevel(midMesh, 35, 0.1);
lod.addLevel(farMesh, 90, 0.15);
```

Cull by meaningful groups. One huge merged world defeats fine-grained frustum
culling; thousands of tiny independent meshes defeat submission budgets. Chunk
the world around camera range, visibility cells, level rooms, track segments,
or authored encounter spaces.

## Adaptive Quality Without Device Guessing

Choose a starting tier from conservative project defaults, then adapt from
measured frame time with hysteresis. Do not sniff a device name and call it a
performance tier.

```ts
class FrameBudgetController {
  private samples: number[] = [];
  private slowWindows = 0;
  private fastWindows = 0;

  push(frameSeconds: number): 'lower' | 'raise' | null {
    this.samples.push(Math.min(frameSeconds, 0.25));
    if (this.samples.length < 120) return null;

    const sorted = [...this.samples].sort((a, b) => a - b);
    const p90 = sorted[Math.floor(sorted.length * 0.9)];
    this.samples = [];

    this.slowWindows = p90 > 1 / 45 ? this.slowWindows + 1 : 0;
    this.fastWindows = p90 < 1 / 70 ? this.fastWindows + 1 : 0;
    if (this.slowWindows >= 2) {
      this.slowWindows = 0;
      return 'lower';
    }
    if (this.fastWindows >= 4) {
      this.fastWindows = 0;
      return 'raise';
    }
    return null;
  }
}
```

Apply one tier step at a time at a safe frame boundary. Lower DPR, shadow map
size/update rate, post resolution/pass count, far effects, particles and LOD
distance before removing gameplay cues. Never change physics timestep,
difficulty or authoritative visibility with a visual-quality tier.

## Imported Local Asset Cleanup

For every project-owned or user-supplied GLB/FBX hero asset:

- Confirm scale, pivot, forward/up orientation, bounds, and active-play silhouette.
- Create a simple collision proxy independent from the visual mesh.
- Inspect file size, approximate triangles, mesh count, material count, texture count, and animation clips when available.
- Replace or simplify excessive materials and textures.
- Add LOD or simplified background variant when reused many times.
- Verify PBR material readability under the game's lighting, not only in a model viewer.
- Keep every runtime asset at a stable project path. Do not retain source-site
  handles, temporary locations, remote fallbacks, or non-local URLs.

## Decals, Trim, And Surface Detail

Prefer reusable surface systems:

- Canvas-generated trim sheets for panel lines, markings, arrows, numbers.
- Thin offset decal meshes for hazard marks, faction symbols, lane glyphs, scuffs.
- Shared small textures for noise/wear rather than unique full-size images.
- Procedural UV-independent detail for repeated hard-surface props.

Surface detail must reinforce scale, function, faction, route, or state. Do not add random lines everywhere.

## Color And Readability

Readability beats palette consistency:

- Threats differ from rewards by shape and motion, not only hue.
- Interactables differ from background by silhouette/value/material.
- UI signal colors match world signal colors.
- Bloom/fog/darkness cannot be the primary separator.
- Colorblind-risk information has shape/icon/motion backup.

## Technical Art Report

Report:

- Technical art brief.
- Material kit and shader/VFX decisions.
- Instancing/LOD/culling strategy.
- Render budget target and actual diagnostics.
- Imported local asset cleanup evidence.
- VFX readability checks.
- Mobile/DPR/post/shadow tradeoffs.
- Remaining visual performance risks.
- Renderer/backend and actual GPU/driver string when it can be probed; never
  assume headless means a specific renderer.

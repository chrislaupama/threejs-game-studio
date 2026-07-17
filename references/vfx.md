# VFX Systems

## Contents

- Event-driven ownership
- Hit sparks, trails, muzzle/impact flashes
- Pooled sprites and points
- Additive layers
- GPU particles pointer (WebGPU compute)

Treat VFX as a presentation system driven by gameplay events, not as scattered
mesh creation inside combat or pickup code. See also `game-feel.md` and
`implementation-recipes.md`.

## Event-Driven Ownership

```ts
type VfxEvent =
  | { type: 'hit'; position: THREE.Vector3; normal?: THREE.Vector3; intensity: number }
  | { type: 'muzzle'; position: THREE.Vector3; direction: THREE.Vector3 }
  | { type: 'pickup'; position: THREE.Vector3 }
  | { type: 'trail-sample'; id: string; position: THREE.Vector3 };

interface VfxBus {
  emit(event: VfxEvent): void;
  update(delta: number, elapsed: number): void;
  setReducedMotion(enabled: boolean): void;
  dispose(): void;
}
```

Gameplay systems emit; one `VfxWorld` owns pools, materials, and disposal.
Route randomness through the seeded RNG so visual baselines stay stable.

## Hit Sparks And Impact Flashes

```ts
function spawnHitSpark(pool: SparkPool, event: Extract<VfxEvent, { type: 'hit' }>): void {
  const spark = pool.acquire();
  spark.position.copy(event.position);
  spark.scale.setScalar(0.15 + event.intensity * 0.2);
  spark.material.opacity = 1;
  spark.userData.life = 0.18;
}
```

Prefer short lifetimes, additive materials, and pooled meshes/sprites over
allocating new geometries per hit.

## Trails

Sample authoritative motion at a fixed cadence; write into a ring buffer of
points for `Line2` or a ribbon mesh. Clear trails on death/teleport. Cap segment
count so long sessions do not grow unbounded.

## Muzzle Flashes

One-frame or sub-200ms sprites/point lights parented to the weapon socket.
Disable or shorten under `setReducedMotion(true)`. Prefer an emissive sprite or
mesh for most flashes. If a transient `PointLight` materially lights nearby
surfaces, pool it, keep `castShadow = false`, give it a tight distance, and
enforce a simultaneous-light budget; a shadow-casting point light renders six
shadow directions and is not a routine muzzle-flash effect.

## Starting VFX Budgets

These are starting contracts for the worst active-play burst, not universal
limits. Record actual draw calls, transparent coverage, frame-time percentiles,
and tier overrides on target devices.

| Metric | Desktop starting tier | Mobile starting tier |
| --- | ---: | ---: |
| Simultaneous transient real-time point lights | 2 | 0-1 |
| Shadow-casting transient point lights | 0 | 0 |
| Concurrent CPU transparent particles/sprites | 2,000 | 500-800 |
| Concurrent emitters | 16 | 8 |
| Full-screen transparent VFX layers | 1 brief layer | 0-1 brief layer |

GPU-compute particles may raise the particle count, but not the fill-rate,
memory, readability, or draw-call budget. Lower far effects, emission rate,
light count, and trail length before removing gameplay telegraphs.

## Pooled Sprites And Points

```ts
const positions = new Float32Array(max * 3);
const geometry = new THREE.BufferGeometry();
geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
const points = new THREE.Points(
  geometry,
  new THREE.PointsMaterial({
    size: 0.08,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    color: 0xffe0a0,
  }),
);
```

`depthWrite: false` is appropriate for many soft additive particles because
each sprite should not occlude later particles; keep `depthTest: true` when the
world should still hide them. It is not a blanket rule for all VFX. Opaque or
alpha-tested debris, decals, shield shells, smoke volumes, and gameplay
telegraphs can need depth writes, a depth prepass, or explicit layering.
Compare intersection artifacts and overdraw in motion before choosing. Sort or
layer deliberately against transparent world materials, and do not use
`renderOrder` to conceal a broken depth contract.

## GPU Particles (WebGPU)

For heavy particle counts, prefer WebGPU compute + storage buffers via TSL /
`computeAsync` after renderer init. Keep a CPU pooled fallback for the WebGL
path. See `webgpu.md` for compute ownership and disposal.

## Verification

- Emit events from combat/pickup without allocating per frame in steady state.
- Reduced-motion collapses bursts to short flashes or none.
- Normal-motion and reduced-motion deterministic captures both preserve the
  gameplay cue.
- Transient light, emitter, particle, screen-coverage, and draw-call peaks meet
  the declared desktop/mobile tier or carry a measured exception.
- Scene exit returns geometry/texture counts near the steady baseline.

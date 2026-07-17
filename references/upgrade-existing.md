# Upgrade An Existing Three.js Project

Use this for CDN/global builds, old revisions, mismatched runtime/types, or mixed
renderer-era recipes. Preserve playable behavior, take captures and performance
baselines first, and never make a wide revision jump as an unrelated side
effect.

## Contents

- Detect and choose a target
- Known migration boundary traps
- Ordered migration
- r185 semantic checks
- Mechanical scanners
- Verification

## Detect And Choose A Target

Look for:

- CDN/import-map runtime URLs, global `THREE`, `examples/js/`, removed builds
- runtime `three` and community `@types/three` on different revisions
- `Clock`, `outputEncoding`, `Texture.encoding`, encoding constants, legacy
  light flags, `RGBELoader`, and `PointerLockControls.getObject()`
- manual matrices, Matrix3 mutators, loader return-value assumptions
- WebGL GLSL/`EffectComposer` mixed with `three/webgpu`/TSL
- `PCFSoftShadowMap` without a renderer-and-revision qualification
- manual `requestAnimationFrame()` without an XR/WebGPU initialization contract

Run:

```bash
npm --prefix <skill-dir> run audit:project-apis -- <project>
npm --prefix <skill-dir> run probe:three -- <project>
npm ls three @types/three
```

The recipes here are verified against r185 / npm `three@0.185.1`. If the user
requested an upgrade, check current stable, choose an explicit target, and read
every intervening section of the official migration guide. For a large jump,
the official guide recommends increments of at most ten revisions so warnings
remain actionable. Runtime source is authoritative; `@types/three` is a separate
community compile contract and should align with the target runtime.

## Known Migration Boundary Traps

- `outputEncoding` and `Texture.encoding` were replaced in
  [r152](https://github.com/mrdoob/three.js/wiki/Migration-Guide#151--152) and
  removed before r179. If they appear to work in an r179 project, look for
  mismatched old types, ignored JavaScript properties, or a vendored addon.
- `PointerLockControls.getObject()` still exists as a deprecated shim in the
  [tagged r179 source](https://github.com/mrdoob/three.js/blob/r179/examples/jsm/controls/PointerLockControls.js),
  but the [r180 cleanup commit](https://github.com/mrdoob/three.js/commit/8fd936dd4ca0179ac8b207fbd7ed23773e34475f)
  removes it. The migration wiki currently places that bullet under an older
  heading; tagged source and the removal commit establish the real boundary.

## Ordered Migration

1. **Freeze evidence** — capture the active game, controls, console, renderer
   metrics, assets, saves, and visual/performance baselines.
2. **Lock the revision pair** — install the chosen `three` target and matching
   `@types/three`; update and inspect the lockfile before API work.
3. **Package imports** — move globals/CDN URLs to `three`, `three/addons/...`,
   and a local build. Do not mix `three` and `three/webgpu` in one renderer path.
4. **Choose renderer architecture** — keep mature `WebGLRenderer` when the game
   depends on GLSL or `EffectComposer`; evaluate experimental
   `WebGPURenderer` only as a deliberate TSL/node-material port.
5. **Loop** — prefer `Timer` + `timer.connect(document)` + one
   `timer.update(timestamp)` per renderer-owned `setAnimationLoop()`. WebXR
   requires that loop. A deliberate manual WebGPU RAF loop must first `await
   renderer.init()`.
6. **Transforms** — test reparenting, manual matrices, world queries, and old
   Matrix3 composition before changing gameplay or physics ownership.
7. **Color and tone** — set sRGB display output and color textures, keep data
   maps at `NoColorSpace`, then choose/capture-test an intentional tone mapper.
8. **Shadows** — on r185 WebGL use soft `PCFShadowMap`, not deprecated
   `PCFSoftShadowMap`; r185 WebGPU still exposes the latter. Untagged 185→186
   notes say it will be removed, but do not apply future guidance until that
   revision is installed. Verify the runtime and retune bias.
9. **Loaders** — use `HDRLoader` for RGBE `.hdr`; initialize WebGPU before KTX2
   detection; stop relying on FileLoader/ImageBitmapLoader return values.
10. **Post** — WebGL uses `EffectComposer`; order linear/HDR effects →
    `OutputPass` → FXAA or another pass requiring sRGB input. WebGPU uses
    `RenderPipeline`/TSL, sets `needsUpdate` after changing `outputNode`, and
    never uses `EffectComposer`.
11. **Retune and verify** — recheck lighting, PBR response, AO/reflections,
    animation, collision, camera, and performance before visual polish.

## r185 Semantic Checks

### Manual Object3D matrices

When `matrixAutoUpdate` is disabled and code directly edits `object.matrix`,
r185 `updateWorldMatrix()` requires an explicit dirty flag:

```ts
object.matrixAutoUpdate = false;
object.matrix.copy(nextLocalMatrix);
object.matrixWorldNeedsUpdate = true;
object.updateWorldMatrix(true, false);
```

`Object3D.attach()` preserves world transform only when the relevant graph does
not contain non-uniformly scaled nodes.

### Matrix3 mutators are not mechanical renames

Deprecated `scale/rotate/translate` premultiply the existing matrix;
`makeScale/makeRotation/makeTranslation` overwrite it. Old `rotate(theta)` also
uses `-theta` during premultiplication. Preserve old behavior only when intended:

```ts
const transform = new THREE.Matrix3();
matrix.premultiply(transform.makeScale(sx, sy));
matrix.premultiply(transform.makeRotation(-theta));
matrix.premultiply(transform.makeTranslation(tx, ty));
```

Prefer a clearer new composition and add a result test rather than copying this
compatibility form blindly.

### Rendering and asset semantics

- Set SSAAPassNode clear color/alpha on the renderer; its old properties were
  removed.
- In r185 TSL, `positionGeometry` is the raw geometry position attribute, before
  morphing, skinning, displacement, batching, or instancing. `positionLocal` is
  the transformed local position after those built-in steps. When a
  `material.positionNode` should modify and preserve the existing deformation,
  derive it from `positionLocal`; using `positionGeometry` there deliberately
  replaces the transformed result and can make a skinned mesh snap back to its
  bind geometry.
- Retune GTAONode radius/scale; port changed SSRNode/SSGINode graphs from the
  matching official examples.
- PLYLoader now preserves source field types. Convert float64/double attributes
  to `Float32BufferAttribute` before rendering, and validate PLYExporter color
  attribute types with downstream tools.

### WebGPU premultiplied alpha from r184 to r185

`WebGPURenderer` changed its premultiplied-alpha implementation in r185. If an
r184 project develops blending or fringe regressions after the upgrade, first
give an opaque game canvas an opaque background through `scene.background` or
`renderer.setClearColor(color, 1)`. Keep a transparent scene background or
clear alpha only when the canvas intentionally composites with HTML behind it;
then test that composition and every transparent material explicitly instead
of restoring an old renderer assumption.

The `positionLocal` ordering, WebGPU alpha migration, and other source-level
observations in this section are pinned to r185. Re-read the matching migration
guide, source, types, and official examples before carrying them into a later
revision.

Read [official-docs.md](official-docs.md) for the full verified-baseline denylist
and the stable-versus-next-release watchlist.

## Mechanical Scanners

- `audit:project-apis` — curated stale-API and renderer-family patterns,
  including legacy color-space properties and pointer-lock accessors
- `audit:assets` — local glTF/texture checklist
- `ship-check` — revision probe → APIs → local-only → build → canvas → report

Scanners find candidates; they cannot prove semantic transform, color, shader,
or gameplay equivalence.

## Verification

At every revision increment, run build/typecheck and the real production
preview. Exercise one complete input/objective/failure/retry path, compare
visual and renderer metrics, inspect console/shader/backend errors, resize,
pause/resume, loading cancellation/failure, and teardown/re-entry. Resume
premium polish only after the migrated baseline is behaviorally stable.

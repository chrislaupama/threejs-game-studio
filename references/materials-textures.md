# Materials, Textures, UVs, And Color

## Contents

- Choose this reference when
- Novice mental model
- Smallest correct PBR material
- Material selection
- Color and data texture policy
- UV sets and `Texture.channel`
- Texture loading and sampling
- PBR texture sets
- Transparency and special surfaces
- Environment maps
- Runtime changes and sharing
- Common failures
- Performance and memory
- Disposal
- Verification
- Official documentation

## Choose This Reference When

Read this file when a surface is the wrong color, too dark, too shiny, blurry,
transparent in the wrong order, missing texture detail, using the wrong UV set,
or consuming too much GPU memory. Also use it when designing a reusable
material kit, importing local image maps, building atlases, or deciding whether
an advanced `MeshPhysicalMaterial` feature is worth its cost.

Choose from the smallest material that produces the intended image:

| Requirement | Start with |
| --- | --- |
| Intentionally unlit UI marker, debug proxy, or flat graphic | `MeshBasicMaterial` |
| General game-world PBR surface | `MeshStandardMaterial` |
| Clearcoat, transmission, sheen, iridescence, or anisotropy | `MeshPhysicalMaterial` |
| Toon ramp | `MeshToonMaterial` |
| Legacy/specular art that specifically needs it | `MeshPhongMaterial` |
| WebGL-only custom GLSL | `ShaderMaterial` after a built-in material cannot do it |
| WebGPU custom surface | A node material and TSL, not `ShaderMaterial` |

Do not add a texture merely because a slot exists. Every map should express a
visible art decision at the expected screen size.

## Novice Mental Model

A material is the rule for turning surface data, lights, and camera direction
into pixels. A texture is an image or data grid sampled by that rule. UVs are
coordinates stored on geometry that say where each vertex lands on a texture.

Three.js performs lighting in a linear working color space and converts the
final image for display. Color images must be identified as sRGB so the
renderer can decode them. Numeric data images must not be color-converted.
Wrong color-space metadata changes the math even if the image file looks fine.

Treat these as different data classes:

- Color: base color/albedo, emissive color, sheen color, and specular color.
- Non-color data: normal, roughness, metalness, ambient occlusion, height,
  displacement, alpha masks, thickness, transmission amount, and lookup data.
- HDR lighting: linear high-dynamic-range radiance, normally configured by
  `HDRLoader`.

The material does not own its textures. Disposing a material does not dispose
any map assigned to it.

## Smallest Correct PBR Material

Load project-local files with `loadAsync()`, annotate the maps, and return an
explicit disposer. This example assumes the geometry already has a `uv`
attribute:

```ts
import * as THREE from 'three';

export async function createPaintedMetal() {
  const loader = new THREE.TextureLoader();
  const [baseColor, normal, roughness, metalness] = await Promise.all([
    loader.loadAsync('/assets/materials/panel/base-color.webp'),
    loader.loadAsync('/assets/materials/panel/normal.webp'),
    loader.loadAsync('/assets/materials/panel/roughness.webp'),
    loader.loadAsync('/assets/materials/panel/metalness.webp'),
  ]);

  baseColor.colorSpace = THREE.SRGBColorSpace;
  normal.colorSpace = THREE.NoColorSpace;
  roughness.colorSpace = THREE.NoColorSpace;
  metalness.colorSpace = THREE.NoColorSpace;

  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    map: baseColor,
    normalMap: normal,
    normalScale: new THREE.Vector2(1, 1),
    roughness: 1,
    roughnessMap: roughness,
    metalness: 1,
    metalnessMap: metalness,
  });

  return {
    material,
    dispose() {
      material.dispose();
      baseColor.dispose();
      normal.dispose();
      roughness.dispose();
      metalness.dispose();
    },
  };
}
```

PBR needs useful lighting. Add an intentional environment or light rig before
judging the material. A perfectly configured PBR surface can still render
nearly black in an unlit scene.

## Material Selection

### `MeshStandardMaterial`

Use it for most opaque game-world surfaces. Set physically meaningful endpoints
before adding maps:

```ts
const paintedWood = new THREE.MeshStandardMaterial({
  color: 0x8f4331,
  metalness: 0,
  roughness: 0.76,
});

const bareMetal = new THREE.MeshStandardMaterial({
  color: 0x9da4a9,
  metalness: 1,
  roughness: 0.28,
});
```

Avoid arbitrary values such as metalness `0.5` unless the map represents a
transition at a material boundary. A pixel is normally metal or non-metal.

### `MeshPhysicalMaterial`

Enable only features that are visible:

```ts
const coatedPlastic = new THREE.MeshPhysicalMaterial({
  color: 0x1459b8,
  metalness: 0,
  roughness: 0.45,
  clearcoat: 0.8,
  clearcoatRoughness: 0.12,
});

const thinGlass = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  metalness: 0,
  roughness: 0.04,
  transmission: 1,
  thickness: 0.08,
  ior: 1.5,
  attenuationColor: new THREE.Color(0xd8f2ff),
  attenuationDistance: 4,
});
```

Keep transmissive materials `transparent = false` unless ordinary alpha
blending is separately required. Transmission invokes a screen-space
refraction path and is substantially more expensive than opaque standard PBR.
Clearcoat, sheen, iridescence, and anisotropy also add shader work; do not turn
all of them on in a generic material factory.

### Material role kit

Give recurring game meanings stable material roles. For example:

- World structural: high roughness, low saturation, low emissive.
- Player: controlled contrast and a unique trim value.
- Reward: brighter value plus shape and motion, not color alone.
- Hazard: distinct silhouette plus authored emissive accent.
- Objective: a consistent color, pulse language, and UI match.

Reuse material instances only when all borrowers should change together.
Sharing reduces program/state churn but does not automatically merge draw
calls.

## Color And Data Texture Policy

Use this table for manually loaded maps:

| Map | `texture.colorSpace` | Important channel behavior |
| --- | --- | --- |
| `map` / base color | `SRGBColorSpace` | RGB color; alpha optional |
| `emissiveMap` | `SRGBColorSpace` | RGB multiplied by material emissive color |
| `sheenColorMap`, `specularColorMap` | `SRGBColorSpace` | Color data |
| `normalMap` | `NoColorSpace` | RGB direction data |
| `roughnessMap` | `NoColorSpace` | Green channel |
| `metalnessMap` | `NoColorSpace` | Blue channel |
| `aoMap` | `NoColorSpace` | Red channel |
| `alphaMap` | `NoColorSpace` | Green channel |
| `bumpMap`, `displacementMap` | `NoColorSpace` | Height data |
| Transmission/thickness/clearcoat numeric maps | `NoColorSpace` | Numeric data |

`NoColorSpace` is the default for ordinary textures, but setting it explicitly
at an asset boundary documents intent. Do not label data maps
`LinearSRGBColorSpace`; that asserts color meaning they do not have.

`GLTFLoader` configures color space, UV channel, and orientation for textures
inside a glTF asset. Do not reapply `flipY`, color space, or arbitrary wrapping
to those maps unless inspection proves an authored exception.

Colors created through normal hexadecimal, CSS, or string inputs are handled by
the enabled Three.js color-management system. Avoid legacy manual gamma math.

## UV Sets And `Texture.channel`

In current Three.js, texture channel selection maps as follows:

| `texture.channel` | Geometry attribute |
| --- | --- |
| `0` | `uv` |
| `1` | `uv1` |
| `2` | `uv2` |
| `3` | `uv3` |

The second UV set is named `uv1`, not `uv2`. For a manually authored AO map
that should use the second set:

```ts
const primaryUv = geometry.getAttribute('uv');
if (!primaryUv) throw new Error('Geometry needs primary UVs');

// Temporary fallback only when the same unwrap is acceptable for AO.
geometry.setAttribute('uv1', primaryUv.clone());
aoTexture.channel = 1;

const material = new THREE.MeshStandardMaterial({
  map: baseColorTexture,       // channel 0 -> uv
  aoMap: aoTexture,            // channel 1 -> uv1
  aoMapIntensity: 1,
});
```

Prefer a genuinely non-overlapping second unwrap for baked AO or light maps.
Copying `uv` to `uv1` satisfies the attribute contract but does not create a
valid lightmap unwrap.

A texture's transform and channel belong to the texture object. If one image
needs different UV channels or repeats on different materials, clone the
texture so each use has independent sampling state. A texture clone shares its
underlying source image but has separate transform/sampler properties:

```ts
const aoUse = packedOrmTexture.clone();
aoUse.channel = 1;
material.roughnessMap = packedOrmTexture; // channel 0
material.metalnessMap = packedOrmTexture; // channel 0
material.aoMap = aoUse;                   // channel 1
```

Track both texture objects for disposal even though their source is shared.

## Texture Loading And Sampling

### Use local `loadAsync()` and a loading owner

`TextureLoader`'s per-file progress callback is unsupported. Use a shared
`LoadingManager` for item progress, or fetch through an explicitly owned
pipeline when byte progress is truly required.

```ts
const manager = new THREE.LoadingManager();
manager.onProgress = (_url, loaded, total) => {
  loadingUi.setProgress(total === 0 ? 0 : loaded / total);
};
const textureLoader = new THREE.TextureLoader(manager);
const texture = await textureLoader.loadAsync('/assets/world/tiles.webp');
texture.colorSpace = THREE.SRGBColorSpace;
```

### Wrapping and transforms

```ts
texture.wrapS = THREE.RepeatWrapping;
texture.wrapT = THREE.RepeatWrapping;
texture.repeat.set(4, 4);
texture.offset.set(0, 0);
texture.center.set(0.5, 0.5);
texture.rotation = Math.PI / 8;
```

Set sampler state before first use when possible. After a texture has uploaded,
changing `wrapS`, `wrapT`, `minFilter`, `magFilter`, or `anisotropy` requires
`texture.needsUpdate = true` so the renderer rebuilds the GPU sampler state.

UV transforms are different: `offset`, `repeat`, `center`, and `rotation`
update `texture.matrix` automatically while `matrixAutoUpdate` is true and do
not require a texture re-upload. Avoid animating a shared UV transform when
borrowers need different states; clone the texture object first.

### Filtering

Keep mipmaps and `LinearMipmapLinearFilter` for ordinary world textures. Use
nearest filtering for intentionally pixelated art:

```ts
pixelTexture.magFilter = THREE.NearestFilter;
pixelTexture.minFilter = THREE.NearestMipmapNearestFilter;

worldTexture.anisotropy = Math.min(
  8,
  renderer.capabilities.getMaxAnisotropy(),
);
```

WebGLRenderer requires WebGL 2 in r185, so old blanket rules that disable
mipmaps for non-power-of-two images are stale. Power-of-two source dimensions
can still be useful for compression, atlases, and predictable mip chains.

### Atlas and sprite sheets

Prefer per-instance UV data or cloned texture transforms when multiple sprites
must render simultaneously. Mutating `atlas.offset` changes every material
that shares that texture object.

Add padding/extrusion around atlas cells to prevent mipmap bleeding. Verify the
lowest mip levels, not only the source image.

## PBR Texture Sets

Many pipelines pack ambient occlusion, roughness, and metalness into the red,
green, and blue channels of one image. Three.js already samples those material
maps from the expected channels:

```ts
const orm = await loader.loadAsync('/assets/materials/rock/orm.webp');
orm.colorSpace = THREE.NoColorSpace;

const material = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  roughness: 1,
  metalness: 1,
  aoMap: orm,
  roughnessMap: orm,
  metalnessMap: orm,
});
```

The same texture object means all three uses share the same UV channel and
transform. Clone it for AO when AO uses `uv1` but roughness/metalness use `uv`.

Normal maps come in OpenGL and DirectX Y conventions. Three.js tangent-space
normal maps normally expect the OpenGL convention. If a known DirectX map is
the only source, invert the Y scale deliberately:

```ts
material.normalScale.set(1, -1);
```

Displacement changes vertices, not pixels. The geometry needs enough segments,
and its bounds must cover the displaced result. Prefer a normal or bump map
when silhouette change is not visible.

## Transparency And Special Surfaces

Choose the least expensive correct alpha mode:

- Cutout foliage/fences: `alphaTest` with an opaque material path.
- Noisy soft cutouts that tolerate dither: evaluate `alphaHash`.
- True partial transparency: `transparent = true`, accept sorting limits, and
  usually set `depthWrite = false` for layered particles.
- Glass/refraction: physical `transmission`, with an environment and sufficient
  scene behind it.

```ts
const leaf = new THREE.MeshStandardMaterial({
  map: leafColor,
  alphaMap: leafAlpha,
  alphaTest: 0.45,
  side: THREE.DoubleSide,
});
```

`DoubleSide` can double work and may force extra passes for transparent
materials. Fix geometry/winding first. Use `forceSinglePass` only after a visual
comparison proves the faster result is acceptable.

Transparent objects cannot always be sorted correctly when their surfaces
intersect. Solve the art/geometry layering before reaching for `renderOrder` or
disabled depth testing.

## Environment Maps

`scene.environment` supplies image-based lighting to PBR materials;
`scene.background` controls what the camera sees. They can use the same HDR
texture but remain separate decisions.

```ts
environment.mapping = THREE.EquirectangularReflectionMapping;
scene.environment = environment;
scene.environmentIntensity = 0.9;
scene.environmentRotation.y = Math.PI * 0.15;

scene.background = environment;
scene.backgroundIntensity = 0.55;
scene.backgroundBlurriness = 0.12;
scene.backgroundRotation.y = Math.PI * 0.15;
```

Current renderers prefilter supported equirectangular environment textures for
PBR. Load HDR radiance with `HDRLoader`; do not tag it sRGB. Environment light
does not create cast shadows. Add a directional/spot/point shadow light or a
cheap contact cue when grounding matters.

Per-material `envMap` overrides the scene environment for that material. Use it
sparingly; a shared scene environment is easier to keep coherent and cache.

## Runtime Changes And Sharing

Scalar and color updates do not require recompilation:

```ts
material.color.set(0x2f8cff);
material.roughness = 0.35;
material.emissiveIntensity = 1.4;
```

Changing which shader features exist, such as switching a map slot from `null`
to a texture or changing certain material modes, can require
`material.needsUpdate = true`. Do not set it every frame.

`material.clone()` creates a material object but continues to share assigned
textures. `texture.clone()` creates sampling state but shares its source. Make
the intended sharing and disposal owner explicit.

For per-object color variation with a shared material, prefer vertex colors,
`InstancedMesh.setColorAt()`, or `BatchedMesh.setColorAt()` over cloning one
material per object.

## Common Failures

- **Base color looks washed out or too dark:** the color map is missing
  `SRGBColorSpace`, or color conversion happens twice.
- **Normal/roughness looks wrong:** a data map was tagged as color, its channel
  packing is wrong, or the normal Y convention differs.
- **AO has no effect:** the texture channel and geometry UV attribute do not
  match, lighting has little ambient contribution, or intensity is too low.
- **glTF texture is upside down:** code overwrote loader-managed `flipY`.
- **Object is black:** the PBR scene lacks light/environment, normals are bad,
  or exposure is inappropriate.
- **Texture swims across many objects:** a shared texture transform is being
  mutated.
- **Atlas seams appear at distance:** cells lack padding/extrusion or mipmaps
  sample neighboring cells.
- **Displacement does nothing:** geometry lacks segments or scale is too small.
- **Glass sorts like ordinary alpha:** transmission and transparent blending
  were mixed without intent.
- **Replacing a map does not change the shader:** a feature changed from absent
  to present without marking the material for update.
- **Every object changes color:** all meshes intentionally share one material.
- **Memory stays high after scene removal:** textures were never disposed, or
  shared ownership prevents safe disposal.

## Performance And Memory

- Estimate uncompressed mipmapped RGBA texture memory as roughly
  `width * height * 4 * 4/3` bytes before cube faces, layers, or copies.
- Use local KTX2/Basis textures where the asset pipeline justifies decoder
  setup and quality is verified on target GPUs.
- Resize source art to the maximum useful screen density; a 4K map on a tiny
  pickup wastes download, decode, CPU, and GPU memory.
- Pack compatible grayscale maps into channels when their resolution, UVs, and
  sampling state match.
- Reuse material programs and textures deliberately. Do not claim that sharing
  alone batches draw calls.
- Limit anisotropy to visible grazing-angle surfaces and the measured device
  tier.
- Prefer opaque or cutout rendering over blended transparency.
- Keep `MeshPhysicalMaterial` features limited to hero surfaces where they are
  visible.
- Avoid per-frame canvas texture uploads. Set `needsUpdate` only after actual
  content changes.
- Track `renderer.info.memory.textures`, material count, shader programs,
  texture dimensions, formats, and the worst gameplay camera.

## Disposal

Deduplicate shared resources before disposal. This utility handles common
material maps but should be called only by the confirmed owner:

```ts
function disposeMaterials(materials: THREE.Material[]) {
  const textures = new Set<THREE.Texture>();

  for (const material of materials) {
    for (const value of Object.values(material)) {
      if (value instanceof THREE.Texture) textures.add(value);
    }
    material.dispose();
  }

  for (const texture of textures) texture.dispose();
}
```

Special sources need browser cleanup too:

- Stop a video, remove its `src`, call `load()`, then dispose its
  `VideoTexture`.
- Call `ImageBitmap.close()` when this owner created the bitmap and no texture
  still uses it; `Texture.dispose()` does not close it.
- Dispose render targets rather than only their color/depth textures.
- Remove canvas-update timers, workers, and listeners.

Do not traverse one model and dispose shared glTF resources while another clone
still uses them. Let an asset cache own the source resources and release them
only after the final borrower is gone.

## Verification

1. Inspect each texture's dimensions, color space, channel, wrap, filtering,
   anisotropy, and UV attribute.
2. Toggle every map independently and compare screenshots.
3. Test the material under a neutral environment and a simple direct light to
   separate material errors from lighting errors.
4. View normals, roughness, metalness, and AO as temporary debug output when
   packed channels are suspect.
5. Check the closest and furthest gameplay camera distances for texture detail,
   atlas bleed, moire, and over-resolution.
6. Rotate transparent and transmissive objects through other geometry to expose
   sorting and depth faults.
7. Compare post-processing enabled/disabled so bloom or grading does not hide a
   bad material.
8. Unload and reload the scene; verify texture/material counts reach the same
   steady state and no disposed shared texture turns black.

## Official Documentation

- [Color management](https://threejs.org/manual/en/color-management.html)
- [Materials manual](https://threejs.org/manual/en/materials.html)
- [Textures manual](https://threejs.org/manual/en/textures.html)
- [Texture API](https://threejs.org/docs/pages/Texture.html)
- [TextureLoader](https://threejs.org/docs/pages/TextureLoader.html)
- [MeshStandardMaterial](https://threejs.org/docs/pages/MeshStandardMaterial.html)
- [MeshPhysicalMaterial](https://threejs.org/docs/pages/MeshPhysicalMaterial.html)
- [Material](https://threejs.org/docs/pages/Material.html)
- [CanvasTexture](https://threejs.org/docs/pages/CanvasTexture.html)
- [VideoTexture](https://threejs.org/docs/pages/VideoTexture.html)
- [KTX2Loader](https://threejs.org/docs/pages/KTX2Loader.html)
- [Scene environment and background](https://threejs.org/docs/pages/Scene.html)
- [How to dispose of objects](https://threejs.org/manual/en/how-to-dispose-of-objects.html)

# Shader And Node-Material Cookbook

## Contents

- Choose one renderer-specific shader path
- WebGL `ShaderMaterial` fundamentals
- WebGL `RawShaderMaterial` boundary
- WebGL `onBeforeCompile` extension pattern
- GLSL color, transparency, instancing, and diagnostics
- WebGPU node materials and TSL fundamentals
- WebGPU `RenderPipeline` and TSL post-processing
- WebGPU pipeline resize and disposal ownership
- Porting GLSL concepts to TSL
- Performance, fallback, and QA gates

This cookbook is verified against **Three.js r185**. Confirm the installed
revision and recheck the official API, source, types, migration notes, and
examples on every upgrade. Keep shader source, textures, lookup data, and
generated noise modules in the project. Never load shader strings, textures,
presets, or post-processing code from a runtime URL.

Public APIs in this cookbook should follow the installed documentation.
Implementation details—shader-chunk injection points, node setup ordering,
target ownership, and runtime methods missing from community types—are verified
for r185 only and must be rechecked against source, types, migration notes, and
official examples on every upgrade.

Texture-loading examples use the project-owned `publicAssetUrl()` helper from
`local-assets.md`; import it from the local asset boundary in real code.

## Choose The Path Before Writing Code

Use one primary renderer family per production path.

| Renderer | Supported customization | Supported post stack |
| --- | --- | --- |
| `WebGLRenderer` from `three` | GLSL `ShaderMaterial`, `RawShaderMaterial`, or version-sensitive `onBeforeCompile` | `EffectComposer` and GLSL addon passes |
| `WebGPURenderer` from `three/webgpu` | Node materials and TSL from `three/tsl` | `RenderPipeline` and TSL nodes |

The official [WebGPURenderer guide](https://threejs.org/manual/en/webgpurenderer)
states that `ShaderMaterial`, `RawShaderMaterial`, `onBeforeCompile`, and
`EffectComposer` are not supported by `WebGPURenderer`. Port those features to
node materials and TSL; do not add renderer checks around an incompatible
material and hope it degrades.

r185 has one narrow bridge in the other direction: a separate
`WebGLRenderer` can compile supported node materials after installing
`WebGLNodesHandler`, and can run supported effects through `setEffects()`.
Use it only as the measured migration aid described in `rendering.md`; it does
not make `RenderPipeline` valid on WebGL or GLSL valid on WebGPURenderer.

Prefer built-in materials first. Add custom shader logic only when it creates a
visible gameplay read, art-direction feature, or measured performance win that
material parameters, vertex colors, textures, particles, or geometry cannot
provide more simply.

## WebGL ShaderMaterial Fundamentals

Use [ShaderMaterial](https://threejs.org/docs/pages/ShaderMaterial.html) with
`WebGLRenderer` when Three.js's injected built-ins and uniforms are useful.
Author display shader colors in the working linear space and include the
current tone-mapping and color-space chunks at the end of a screen-facing
fragment shader.

```ts
import * as THREE from 'three';

const uniforms = {
  uTime: { value: 0 },
  uBase: { value: new THREE.Color(0x14345c) },
  uGlow: { value: new THREE.Color(0x24d8ff) },
};

const material = new THREE.ShaderMaterial({
  uniforms,
  vertexShader: /* glsl */ `
    uniform float uTime;
    varying vec2 vUv;
    varying float vWave;

    void main() {
      vUv = uv;

      vec3 transformed = position;
      float anchoredHeight = max(position.y, 0.0);
      vWave = sin(position.x * 5.0 + uTime * 2.0);
      transformed.z += vWave * 0.04 * anchoredHeight;

      gl_Position = projectionMatrix * modelViewMatrix * vec4(transformed, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    uniform vec3 uBase;
    uniform vec3 uGlow;
    varying vec2 vUv;
    varying float vWave;

    void main() {
      float stripe = smoothstep(0.42, 0.5, sin(vUv.y * 80.0 + vWave) * 0.5 + 0.5);
      vec3 linearColor = mix(uBase, uGlow, stripe * 0.7);
      gl_FragColor = vec4(linearColor, 1.0);

      #include <tonemapping_fragment>
      #include <colorspace_fragment>
    }
  `,
});

function updateShader(elapsedSeconds: number) {
  uniforms.uTime.value = elapsedSeconds;
}
```

Update the uniform's `.value`; do not recreate the uniform object or material
every frame. Share one material when all objects share values. Use instanced
attributes, vertex colors, a data texture, or separate material instances when
values must differ per object.

Shader chunks and their injection locations are renderer implementation details;
the example above is pinned to r185. Confirm their names and placement against
the installed Three.js source, then typecheck and render-test after every
upgrade. The
[r185 ShaderChunk source](https://github.com/mrdoob/three.js/blob/r185/src/renderers/shaders/ShaderChunk.js)
lists the verified-baseline chunks but does not make arbitrary injection points
stable.

## Texture Sampling And Color

Annotate a color texture before sampling it. Three.js supplies the appropriate
decode when the texture participates in its material pipeline; custom shaders
still own how values are composed and output.

```ts
const colorMap = await new THREE.TextureLoader().loadAsync(
  publicAssetUrl('assets/textures/energy-color.webp'),
);
colorMap.colorSpace = THREE.SRGBColorSpace;

const dataMap = await new THREE.TextureLoader().loadAsync(
  publicAssetUrl('assets/textures/energy-mask.webp'),
);
dataMap.colorSpace = THREE.NoColorSpace;

const material = new THREE.ShaderMaterial({
  uniforms: {
    uColorMap: { value: colorMap },
    uMask: { value: dataMap },
  },
  vertexShader,
  fragmentShader,
});
```

Keep base-color/emissive art in sRGB and masks/normals/roughness/noise in
non-color space. Read the official
[color-management guide](https://threejs.org/manual/en/color-management.html)
before mixing texture, uniform, vertex, and framebuffer color.

Do not apply gamma or sRGB conversion twice. With WebGL `EffectComposer`, put
`OutputPass` near the end so tone mapping and output conversion happen once,
but order display-referred antialiasing by its documented input space:

- `SMAAPass` works in Linear-sRGB and must run **before** `OutputPass`.
- `FXAAPass` expects sRGB input and must run **after** `OutputPass`.

Without post-processing, keep the shader's output chunks for display-facing
materials. See the official
[OutputPass](https://threejs.org/docs/pages/OutputPass.html),
[FXAAPass](https://threejs.org/docs/pages/FXAAPass.html), and
[SMAAPass](https://threejs.org/docs/pages/SMAAPass.html) contracts.

## RawShaderMaterial Boundary

Use [RawShaderMaterial](https://threejs.org/docs/pages/RawShaderMaterial.html)
only when explicit GLSL declarations and complete shader ownership are worth
losing Three.js's injected shader definitions. This minimal WebGL 2 example
owns every declaration:

```ts
const raw = new THREE.RawShaderMaterial({
  glslVersion: THREE.GLSL3,
  uniforms: {
    uColor: { value: new THREE.Color().setRGB(0.1, 0.5, 1.0) },
  },
  vertexShader: /* glsl */ `
    precision highp float;

    in vec3 position;
    uniform mat4 modelViewMatrix;
    uniform mat4 projectionMatrix;

    void main() {
      gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    }
  `,
  fragmentShader: /* glsl */ `
    precision highp float;

    uniform vec3 uColor;
    out vec4 outColor;

    void main() {
      outColor = vec4(uColor, 1.0);
    }
  `,
});
```

This raw output does not automatically reproduce the built-in material's
lighting, fog, clipping, tone mapping, color conversion, skinning, morphing,
instancing, logarithmic depth, or shadow support. Use it for controlled data or
specialized unlit passes, or implement and test every required concern.

Do not use `RawShaderMaterial` to avoid learning the existing render pipeline;
the apparent short snippet transfers substantial responsibility to the game.

## WebGL onBeforeCompile

Use [Material.onBeforeCompile](https://threejs.org/docs/pages/Material.html)
only with `WebGLRenderer` when a small modification must preserve a built-in
material's lighting, shadows, fog, skinning, morphing, and PBR behavior. It is
not supported by `WebGPURenderer`, and shader-chunk replacements are
version-sensitive.

Current safe pattern:

```ts
const rimMaterial = new THREE.MeshStandardMaterial({
  color: 0x245ec7,
  metalness: 0.1,
  roughness: 0.48,
});

const RIM_PROGRAM_KEY = 'player-rim-r185-v1';
const rimColor = { value: new THREE.Color(0x25d9ff) };
const rimPower = { value: 3.0 };
const rimStrength = { value: 1.25 };

rimMaterial.onBeforeCompile = (shader) => {
  // Reuse the same holders across every compiled material variant.
  shader.uniforms.uRimColor = rimColor;
  shader.uniforms.uRimPower = rimPower;
  shader.uniforms.uRimStrength = rimStrength;

  const marker = '#include <emissivemap_fragment>';
  if (!shader.fragmentShader.includes(marker)) {
    throw new Error(`Expected shader chunk missing: ${marker}`);
  }

  shader.fragmentShader = shader.fragmentShader.replace(
    marker,
    /* glsl */ `
      #include <emissivemap_fragment>
      float rim = pow(
        1.0 - saturate(dot(normalize(normal), normalize(vViewPosition))),
        uRimPower
      );
      totalEmissiveRadiance += uRimColor * rim * uRimStrength;
    `,
  );

  shader.fragmentShader = /* glsl */ `
    uniform vec3 uRimColor;
    uniform float uRimPower;
    uniform float uRimStrength;
  ` + shader.fragmentShader;
};

rimMaterial.customProgramCacheKey = () => RIM_PROGRAM_KEY;
rimMaterial.needsUpdate = true;
```

Update the shared uniform without recompiling every program variant:

```ts
function setRimStrength(value: number) {
  rimStrength.value = value;
}
```

Rules:

- Set `customProgramCacheKey()` to a stable key unique to the injected program.
- Fail loudly when the expected chunk marker is absent.
- Reuse shared uniform holders across every program variant; one material can
  compile separate fog, clipping, skinning, morphing, or instancing programs.
- Set `needsUpdate = true` only when defines or program structure change, not
  for ordinary uniform values.
- Test shadows, fog, skinning, morphs, instancing, clipping, and all material
  variants the base material supports.
- Re-audit every replacement after a Three.js upgrade.
- Prefer a TSL node material for new renderer-agnostic shader work.

## WebGL Instancing And Per-Object Data

Do not clone one shader material per repeated object merely to vary color or a
scalar. Prefer current built-ins:

```ts
const instances = new THREE.InstancedMesh(geometry, material, count);

for (let index = 0; index < count; index += 1) {
  instances.setMatrixAt(index, matrices[index]);
  instances.setColorAt(index, colors[index]);
}

instances.instanceMatrix.needsUpdate = true;
if (instances.instanceColor) instances.instanceColor.needsUpdate = true;
instances.computeBoundingSphere();
```

When custom instance data is required, add an `InstancedBufferAttribute` and
read it in the vertex shader. Keep attribute count and bandwidth measured.
Update bounding volumes after transform changes so culling and raycasting stay
correct. See [InstancedMesh](https://threejs.org/docs/pages/InstancedMesh.html).

## WebGL Transparency And Depth

Choose blending intentionally:

- Keep opaque shaders opaque whenever possible.
- Use `alphaTest` for cutouts and `transparent` blending for genuinely soft
  edges.
- Use `depthWrite: false` for selected additive/overlay effects only after
  checking intersections.
- Use `premultipliedAlpha` only with matching output math and renderer/canvas
  composition.
- Avoid `discard` across large opaque surfaces; it can defeat early depth
  rejection.
- Keep particles and transparent meshes sorted/grouped enough that gameplay
  silhouettes remain stable.

Test both sides explicitly. `DoubleSide` changes shader defines, lighting,
raycasting, and cost.

## WebGPU And TSL Baseline

Import the WebGPU renderer family and [TSL](https://threejs.org/docs/TSL.html)
from their current package exports:

```ts
import * as THREE from 'three/webgpu';
import { color, mix, texture, time, uniform, uv } from 'three/tsl';

const renderer = new THREE.WebGPURenderer({ antialias: true, alpha: false });
// This renderer's later pipeline enters XR, so select XRManager before init.
renderer.xr.enabled = true;
await renderer.init();
await renderer.setAnimationLoop(render);
```

`setAnimationLoop()` can initialize asynchronously, but handling
`await renderer.init()` at the boot boundary makes failure explicit before UI
and GPU-dependent setup continue. Use current synchronous `render()` and
`compute()` methods afterward. Catch initialization failure in the app shell
and show an accessible retry or renderer-choice message.

Build a current node material:

```ts
const cool = uniform(new THREE.Color(0x16457a));
const hot = uniform(new THREE.Color(0x31dcff));
const pulse = time.mul(2.0).sin().mul(0.5).add(0.5);

const material = new THREE.MeshStandardNodeMaterial();
material.colorNode = mix(cool, hot, pulse.mul(0.35));
material.emissiveNode = color(0x14bde8).mul(pulse.mul(1.5));
material.roughness = 0.45;
material.metalness = 0.1;
```

Update uniforms through `.value`:

```ts
cool.value.set(0x1c4f8f);
hot.value.set(0x6cf4ff);
```

Use `.onObjectUpdate()`, `.onRenderUpdate()`, or `.onFrameUpdate()` when a node
value should derive automatically at that cadence. Do not perform per-fragment
work on the CPU.

The official TSL detail-map form is compact and composable:

```ts
const detail = texture(detailMap, uv().mul(10));

const material = new THREE.MeshStandardNodeMaterial();
material.colorNode = texture(colorMap).mul(detail);
```

Annotate `colorMap.colorSpace = THREE.SRGBColorSpace` and leave a scalar/detail
data map at `NoColorSpace` when it is data rather than color.

Read [MeshStandardNodeMaterial](https://threejs.org/docs/pages/MeshStandardNodeMaterial.html)
for current `colorNode`, `normalNode`, `emissiveNode`, `metalnessNode`,
`roughnessNode`, `lightsNode`, `envNode`, shadow, mask, MRT, and output hooks.

## TSL RenderPipeline

Use [RenderPipeline](https://threejs.org/docs/pages/RenderPipeline.html), not
the deprecated `PostProcessing` wrapper:

```ts
import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';

const pipeline = new THREE.RenderPipeline(renderer);
const scenePass = pass(scene, camera);

pipeline.outputNode = scenePass;

await renderer.setAnimationLoop(() => {
  if (renderer.xr.isPresenting) {
    renderer.render(scene, camera);
  } else {
    pipeline.render();
  }
});
```

In r185, `RenderPipeline.render()` temporarily disables XR while rendering.
Use the pipeline for desktop/non-XR presentation, but call
`renderer.render(scene, camera)` directly whenever `renderer.xr.isPresenting`.
That deliberately disables the desktop post chain in-headset; use an alternate
XR post path only after exact-version, on-device verification.

For a current bloom composition:

```ts
import { pass } from 'three/tsl';
import { bloom } from 'three/addons/tsl/display/BloomNode.js';

const pipeline = new THREE.RenderPipeline(renderer);
const scenePass = pass(scene, camera);
const sceneColor = scenePass.getTextureNode('output');
const glow = bloom(sceneColor, 0.45, 0.25, 0.9);
glow.setResolutionScale(0.5); // deliberate half-resolution mobile/low tier

pipeline.outputNode = sceneColor.add(glow);
```

For selective bloom, configure MRT outputs such as `output` and `emissive`,
bloom only the emissive texture, then add it to the scene color. Follow the
official [BloomNode](https://threejs.org/docs/pages/BloomNode.html) example.

Complete pass configuration before optional precompilation. Calls such as
`setMRT()` and `getTextureNode()` must happen before
`await scenePass.compileAsync(renderer)`. `renderer.compileAsync(scene, camera)`
precompiles scene materials; `PassNode.compileAsync()` additionally prepares
the configured post pass.

Changing uniform values updates the existing graph. Replacing `outputNode` or
the graph after its first render requires explicit invalidation:

```ts
pipeline.outputNode = nextOutputNode;
pipeline.needsUpdate = true;
```

`RenderPipeline` applies output tone mapping and color conversion by default.
If an effect needs display-referred input before the end, insert
[`renderOutput`](https://threejs.org/docs/pages/RenderOutputNode.html) at that
point and set `pipeline.outputColorTransform = false`. Never transform twice.

Use `packNormalToRGB()` and `unpackRGBToNormal()` in the installed revision;
reject deprecated `directionToColor()` and `colorToDirection()`. Use current
`BloomNode`; reject removed `AnamorphicNode` recipes.

### Resize and dispose the WebGPU pipeline

Resize the renderer and camera from one owner. In r185, `PassNode` and
`BloomNode` read the renderer drawing-buffer size during their update and
resize their own internal targets. There is no `RenderPipeline.setSize()` call.
Custom targets or effect nodes that are not self-sizing remain their creator's
responsibility.

```ts
let lastWidth = 0;
let lastHeight = 0;
let lastDpr = 0;
const MAX_DPR = 1.5;
const MAX_DRAWING_BUFFER_PIXELS = 1920 * 1080;

function resizeWebGpuFrame() {
  const canvas = renderer.domElement;
  const width = Math.max(1, Math.floor(canvas.clientWidth));
  const height = Math.max(1, Math.floor(canvas.clientHeight));
  const requestedDpr = Math.min(window.devicePixelRatio || 1, MAX_DPR);
  const budgetDpr = Math.sqrt(
    MAX_DRAWING_BUFFER_PIXELS / (width * height),
  );
  const dpr = Math.min(requestedDpr, budgetDpr);
  if (width === lastWidth && height === lastHeight && dpr === lastDpr) return;

  lastWidth = width;
  lastHeight = height;
  lastDpr = dpr;
  renderer.setPixelRatio(dpr);
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}

await renderer.setAnimationLoop(() => {
  resizeWebGpuFrame();
  if (renderer.xr.isPresenting) {
    renderer.render(scene, camera);
  } else {
    pipeline.render();
  }
});
```

Stop the loop before releasing the pipeline. `RenderPipeline.dispose()`
releases its full-screen material; render/effect nodes with their own targets
must also be disposed explicitly:

```ts
async function disposeWebGpuRendering() {
  const session = renderer.xr.getSession();
  if (session) await session.end();
  await renderer.setAnimationLoop(null);
  // Runtime BloomNode has dispose(); some @types/three releases omit it.
  if ('dispose' in glow && typeof glow.dispose === 'function') glow.dispose();
  scenePass.dispose();
  pipeline.dispose();
  renderer.dispose();
}
```

Do not separately dispose `sceneColor`; it is a texture node borrowed from
`scenePass`. Dispose additional pass, history, MRT, or custom render-target
owners exactly once. Keep the guarded bloom cleanup until the installed type
declaration exposes `BloomNode.dispose()`; verify the runtime method against the
matching Three.js source before carrying this workaround to another revision.

## Porting GLSL To TSL

Port intent, not syntax:

| GLSL concern | TSL direction |
| --- | --- |
| Uniform | `uniform(value)` and update `.value` |
| UV sampling | `texture(map, uvNode)` |
| Arithmetic | Node methods such as `.mul()`, `.add()`, `.sin()` or TSL functions |
| Varying/object position | Use current position/normal/model nodes from TSL |
| `material.positionNode` that must preserve morphing, skinning, displacement, batching, or instancing | Modify `positionLocal`; `positionGeometry` is the raw, pre-transform geometry attribute |
| Built-in PBR extension | Assign `colorNode`, `normalNode`, `emissiveNode`, `roughnessNode`, and related hooks |
| Full-screen effect | Compose nodes in `RenderPipeline` |
| MRT | `pass()`, `setMRT(mrt({...}))`, and `getTextureNode(name)` |
| Compute | Build a TSL compute node and dispatch through the initialized renderer |

In r185, `NodeMaterial` applies its built-in morph, skinning, displacement,
batch, and instance transforms to `positionLocal` before evaluating
`material.positionNode`. Base an additive deformation on `positionLocal` to
preserve those transforms. Use `positionGeometry` only when raw attribute-space
input is intentional and the custom position fully owns any transformations it
still needs. This setup order is an r185 implementation detail; re-verify it on
upgrade.

Do not transliterate shader chunks or copy GLSL preprocessor branches into
TSL. Identify inputs, coordinate spaces, material outputs, render-pass outputs,
and update cadence, then rebuild those semantics with current nodes.

Use the official [TSL specification](https://threejs.org/docs/TSL.html) as the
primary API surface. TSL changes quickly; verify every imported symbol against
the installed revision's exports and matching official example.

## Shader Diagnostics

When a shader fails:

1. Capture the first compile/link or WebGPU validation error verbatim.
2. Confirm renderer family and imports.
3. Reduce to a solid-color material on one known-visible mesh.
4. Verify camera, bounds, side, depth, clipping, and draw call before editing
   shader math.
5. Verify all attributes, uniforms, texture dimensions, color spaces, sampler
   types, and coordinate spaces.
6. Restore one feature at a time.
7. Test the actual animated, instanced, skinned, shadowed, fogged, and post
   variants required by the game.

Keep shader error checking enabled during development. Gate debug views that
show normals, UVs, depth, roughness, metalness, emissive, overdraw proxies, and
MRT targets. Remove or disable them in production builds.

Use `renderer.info.programs` and render-call/triangle counts for WebGL program
growth. A rising program count can indicate accidental define/material
variants. Use browser GPU profiling for pass cost; JavaScript frame time alone
cannot identify fragment or bandwidth bottlenecks.

## Cost And Quality Rules

- Prefer one shared shader plus uniforms/attributes over many material clones.
- Keep varyings and texture reads purposeful; mobile bandwidth is often the
  limiting resource.
- Avoid full-screen noise, loops with large static bounds, high-frequency
  procedural detail, and derivative-heavy work until measured.
- Keep displacement within updated bounding volumes or disable culling only as
  a deliberate last resort.
- Keep transparent shader area small and particle overdraw bounded.
- Pool transient VFX and dispose abandoned materials, textures, and render
  targets.
- Provide a lower-cost material or post path when the target tier cannot hold
  its frame budget.
- Compare each effect on/off in the active game. Keep it only if the player can
  perceive the intended read.

## Shader QA Gate

Prove all applicable checks before accepting custom shader work:

- Build and typecheck pass against the pinned package.
- No compile, link, validation, or missing-chunk errors appear.
- WebGL and WebGPU recipes are not mixed.
- Color decoding, tone mapping, and output conversion occur once.
- Resize and DPR changes preserve the effect and do not leak render targets.
- Required fog, shadows, clipping, skinning, morphing, instancing, and XR views
  still work.
- Transparent ordering and depth behavior remain stable in dense play.
- GPU/pass cost is measured at the target resolution and worst active state.
- A low-cost fallback preserves gameplay state and silhouettes.
- Repeated scene entry/exit returns materials, programs, textures, and targets
  to a stable baseline.
- Production runtime makes no outbound request for shader or texture content.

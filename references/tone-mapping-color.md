# Tone Mapping And Color (r185 Verified Baseline)

## Contents

- Linear workflow checklist
- Tone-mapping starting points
- WebGL OutputPass ordering
- WebGPU RenderOutputNode ordering
- Verification

Physically based lighting produces scene-referred HDR values. Choose the output
transform as part of the art direction, then apply tone mapping and color-space
conversion exactly once.

## Linear Workflow Checklist

1. Display output → `renderer.outputColorSpace = THREE.SRGBColorSpace`
2. Albedo/base-color and emissive textures → `THREE.SRGBColorSpace`
3. Normal, roughness, metalness, AO, displacement, masks → `NoColorSpace`
4. Actual linear color data, such as compatible HDR color textures →
   `LinearSRGBColorSpace` or the loader-provided linear annotation
5. Pick and capture-test one tone mapper and exposure for the art direction
6. In WebGL post: linear/HDR effects → `OutputPass` → FXAA or any other pass
   requiring display-referred sRGB input
7. Use half-float linear intermediates when the post path needs HDR range; do
   not blindly pay that bandwidth cost for every direct-display path

Do not call generic non-color maps “linear textures”: `NoColorSpace` means the
texels are data and must not receive a color-space conversion.

## Tone-Mapping Starting Points

These are skill recommendations to test, not official declarations that one
operator is universally best.

| Operator | Useful starting point | Watch |
| --- | --- | --- |
| `ACESFilmicToneMapping` | Cinematic lit PBR scaffold | Strong film response can reshape saturated highlights |
| `AgXToneMapping` | High-dynamic lighting and a softer shoulder | Recheck authored contrast and emissive hierarchy |
| `NeutralToneMapping` | UI-adjacent 3D, product, or restrained looks | Milder remap can leave highlight control to lighting |
| `NoToneMapping` | Explicit untonemapped debug or intentionally LDR output | Not a neutral substitute for an HDR art-direction decision |

```ts
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1;
```

## WebGL Post Path

```ts
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const composer = new EffectComposer(renderer);
const renderPass = new RenderPass(scene, camera);
composer.addPass(renderPass);
// Add bloom, depth of field, and other linear/HDR effects here.

const outputPass = new OutputPass();
composer.addPass(outputPass);

// If used, add FXAA here, after OutputPass, because FXAA requires sRGB input.
// composer.addPass(fxaaPass);

function disposePost(): void {
  // EffectComposer owns its internal targets, not arbitrary passes added to it.
  // Dispose every optional pass here too (for example fxaaPass.dispose()).
  outputPass.dispose();
  renderPass.dispose();
  composer.dispose();
}
```

`OutputPass` reads `renderer.toneMapping`, `toneMappingExposure`, and
`outputColorSpace`. Keep those renderer properties as the configuration source;
do not disable them merely because a composer is active, and do not add another
output conversion. Update an FXAA pass's inverse-resolution uniform from the
actual drawing-buffer size.

`material.toneMapped = false` is ignored when rendering into a render target,
using post-processing, or using `WebGPURenderer`. Put display-referred UI after
the output transform when supported, use a DOM overlay, or author it for the
selected output chain.

## WebGPU Path

`RenderPipeline` applies the output transform automatically. For an effect such
as FXAA that must run afterward, take explicit ownership with `renderOutput()`:

```ts
import * as THREE from 'three/webgpu';
import { pass, renderOutput, rtt } from 'three/tsl';
import { fxaa } from 'three/addons/tsl/display/FXAANode.js';

const pipeline = new THREE.RenderPipeline(renderer);
const scenePass = pass(scene, camera);
const displayOutput = renderOutput(scenePass);
// Retain this explicit RTT: fxaa() otherwise creates the same target internally,
// where application teardown cannot release it directly.
const fxaaInput = rtt(displayOutput);
const fxaaNode = fxaa(fxaaInput);

pipeline.outputColorTransform = false;
pipeline.outputNode = fxaaNode;
pipeline.needsUpdate = true;

async function disposeWebGpuOwner() {
  // This graph is renderer-lifetime-owned in r185. End XR first because the
  // manager restores its saved desktop loop while processing session end.
  const session = renderer.xr.getSession();
  if (session) await session.end();
  await renderer.setAnimationLoop(null);
  pipeline.dispose();
  fxaaNode.dispose();
  fxaaInput.renderTarget?.dispose();
  fxaaInput.dispose();
  displayOutput.dispose();
  scenePass.dispose();
  renderer.dispose();
}
```

In r185, `RTTNode.dispose()` is only the inherited node event; it does not expose
complete disposal of the node's private fullscreen-quad material. Disposing the
explicit render target is necessary but is not a complete route-remount
boundary while the renderer survives. Keep this FXAA/RTT graph for the
renderer owner's lifetime and dispose the renderer with it as shown. If a
route must preserve one renderer across remounts, avoid this RTT topology for
route-owned post or retain/reuse the graph until renderer teardown. Re-check
the matching source before relaxing that restriction on a later revision.

When a runtime quality switch replaces `outputNode`, stop the loop at an owned
boundary, assign the new graph, set `pipeline.needsUpdate = true`, and dispose
every retired target owner only after nothing in the new graph borrows it. Then
restart the loop. Do not overwrite the property in a live frame and lose the
old target owners. Defer the switch until XR ends, or end and await the session
before clearing the restored desktop loop. Do not mix this path with
`EffectComposer`. `RenderPipeline.dispose()` releases the pipeline's fullscreen
material, not target-owning graph nodes.
Follow the official
[WebGPU post-processing guide](https://threejs.org/manual/en/webgpu-postprocessing)
for MRT formats and effect composition.

## Verification

- Compare ACES / AgX / Neutral on the same lit scene at fixed exposure.
- Inspect neutral gray, saturated color, matte dielectric, metal, skin/organic
  material where relevant, emissive cues, and bright UI reference values.
- Capture the processed and post-disabled paths; check for missing or duplicate
  sRGB conversion.
- Record operator, exposure, intermediate type, output owner, and any
  display-referred passes after conversion.

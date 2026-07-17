# Tone Mapping And Color (r185+)

## Contents

- Linear workflow checklist
- Tone-mapping comparison
- WebGL OutputPass vs WebGPU RenderOutputNode
- Copyable setup

Games that light with physically based materials need an intentional tone map.
Leaving the default `NoToneMapping` makes HDR lighting look flat or blown out.

## Linear Workflow Checklist

1. `renderer.outputColorSpace = THREE.SRGBColorSpace`
2. Color textures / albedo → `texture.colorSpace = THREE.SRGBColorSpace`
3. Data textures (normal, roughness, metalness, AO) → `NoColorSpace` / linear
4. Choose a tone-mapping operator and exposure for the art direction
5. On WebGL post stacks, keep `OutputPass` last so color/tone mapping apply once

## Tone-Mapping Comparison

| Operator | When to prefer | Notes |
| --- | --- | --- |
| `ACESFilmicToneMapping` | Default lit PBR games, cinematic contrast | Strong film response; good scaffold default |
| `AgXToneMapping` | High-dynamic lighting, softer shoulder | Often more natural highlight rolloff |
| `NeutralToneMapping` | UI-adjacent 3D, product/viewer looks | Milder remapping; preserves more source contrast |
| `NoToneMapping` | Explicitly untonemapped debug / UI-only | Do not leave lit games here without a reason |

```ts
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
// AgX: renderer.toneMapping = THREE.AgXToneMapping;
// Neutral: renderer.toneMapping = THREE.NeutralToneMapping;
```

## WebGL Post Path

```ts
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
// ... bloom / FXAA / etc ...
composer.addPass(new OutputPass()); // last
```

If you tone-map on the renderer and also run a post stack, keep a single owner
for final output transform so you do not double-apply.

## WebGPU Path

Use `RenderPipeline` / `RenderOutputNode` / `outputColorTransform` on the node
graph. Do not mix `EffectComposer`. Prefer opaque `alpha: false` unless HTML
compositing is required (see `official-docs.md` and `webgpu.md`).

## Verification

- Compare the same lit scene under ACES / AgX / Neutral at fixed exposure.
- Capture active-play evidence after changing tone mapping.
- Record the chosen operator in the game report.

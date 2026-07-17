# Three.js r185 Verified-Baseline Quick Reference

## Contents

- WebGL and experimental WebGPU imports
- Timer and animation loop
- Color, tone mapping, shadows, and opaque canvases
- Loaders and renderer-specific post-processing
- Teardown and stale-API rejection list

Authority: installed `three` runtime → matching official source/docs/migration →
aligned community `@types/three` → these recipes. For another revision, verify
before copying.

## Imports

Choose one renderer family per module; these are mutually exclusive baselines.

### WebGL

```ts
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
```

### Experimental WebGPU

```ts
import * as THREE from 'three/webgpu';
import { emissive, mrt, output, pass } from 'three/tsl';
```

## Loop

```ts
const timer = new THREE.Timer();
timer.connect(document);

renderer.setAnimationLoop((timestamp) => {
  timer.update(timestamp);
  const delta = Math.min(timer.getDelta(), 0.1);
  update(delta); // use a fixed-step accumulator for timing-sensitive gameplay
  renderer.render(scene, camera);
});

function disposeLoop() {
  renderer.setAnimationLoop(null);
  timer.dispose();
}
```

Prefer `setAnimationLoop()`. WebXR requires the renderer-owned loop. If a
WebGPU app deliberately uses manual `requestAnimationFrame()`, call `await
renderer.init()` first and own the renderer/session lifecycle explicitly.

## Color And Tone Mapping

```ts
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; // skill default; compare AgX / Neutral
renderer.toneMappingExposure = 1;
texture.colorSpace = THREE.SRGBColorSpace; // color textures only
```

Keep normal, roughness, metalness, AO, and other data textures at
`NoColorSpace`. Tone-mapper choice is art direction, not an official universal
default.

## Shadows

```ts
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap;
```

At r185, `PCFSoftShadowMap` is deprecated on `WebGLRenderer` because
`PCFShadowMap` is soft. r185 WebGPU still exposes it. The current, untagged
185→186 migration notes say the next revision removes it there; treat that as
upgrade-preview information, not as proof about an installed release.

## Opaque Canvas (Games)

```ts
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
// Experimental WebGPU: also pass alpha:false to override its transparent default.
scene.background = new THREE.Color(0x0b1020);
```

Use transparent output deliberately for HTML compositing or AR camera
passthrough; do not add an opaque scene background to the passthrough path.

## Loaders

| Need | Use |
| --- | --- |
| glTF | `GLTFLoader` (+ DRACO / KTX2 / Meshopt as needed) |
| HDR environment | `HDRLoader` (not the deprecated `RGBELoader` alias) |
| Progress / grouped abort | `LoadingManager` (abort works only for supporting loaders) |

## Post Boundary

| Renderer | Post path |
| --- | --- |
| WebGL | `EffectComposer`: linear/HDR effects → `OutputPass` → FXAA or another pass requiring sRGB input |
| Experimental WebGPU | `RenderPipeline` + TSL nodes; never `EffectComposer` |

Apply tone mapping and output conversion once. `OutputPass` reads the renderer's
tone-mapping and output-color-space settings.

## Teardown

- Dispose owned geometry, material, texture, render target, post pass, control,
  listener, loader/worker, timer, and renderer resources.
- `AnimationMixer` has no `dispose()`: call `stopAllAction()`, then
  `uncacheRoot()` and/or `uncacheClip()` for owned animation data.
- Do not dispose shared resources through blind scene traversal. Prefer one
  lifecycle owner and explicit catalogs for hidden shader/node resources.

## Reject Quickly At The Verified Baseline

`Clock`, `outputEncoding`, deprecated `RGBELoader`, WebGL
`PCFSoftShadowMap`, WebGPU + `ShaderMaterial` / `EffectComposer`, and a manual
renderer loop without the initialization/session contract above.

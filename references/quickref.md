# Three.js r185+ Quick Reference

One-page cheat sheet. Authority: installed `three` revision → official docs /
migration → these recipes. Confirm `THREE.REVISION >= 185`.

## Imports

```ts
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// WebGPU path
import * as THREE from 'three/webgpu';
import { pass, mrt, output, emissive } from 'three/tsl';
```

## Loop

```ts
const timer = new THREE.Timer();
renderer.setAnimationLoop((time) => {
  timer.update(time);
  const delta = timer.getDelta();
  update(delta);
  renderer.render(scene, camera);
});
```

## Color And Tone Mapping

```ts
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; // or AgX / Neutral
renderer.toneMappingExposure = 1;
texture.colorSpace = THREE.SRGBColorSpace; // color maps only
```

## Shadows

```ts
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFShadowMap; // not PCFSoftShadowMap
```

## Opaque Canvas (games)

```ts
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: false });
// WebGPU: same — override docs default alpha:true
scene.background = new THREE.Color(0x0b1020);
```

## Loaders

| Need | Use |
| --- | --- |
| glTF | `GLTFLoader` (+ DRACO / KTX2 / Meshopt as needed) |
| HDR env | `HDRLoader` (not `RGBELoader`) |
| Progress | `LoadingManager` |

## Post Boundary

| Renderer | Post path |
| --- | --- |
| WebGL | `EffectComposer` + `OutputPass` last |
| WebGPU | `RenderPipeline` + TSL nodes; never `EffectComposer` |

## Disposal

Dispose owned geometries, materials, textures, render targets, mixers,
controls, listeners, and the renderer on teardown. Prefer one lifecycle owner.

## Reject Quickly

`Clock`, `outputEncoding`, `RGBELoader`, `PCFSoftShadowMap`, WebGPU +
`ShaderMaterial` / `EffectComposer`, `requestAnimationFrame` as loop owner.

# Upgrade An Existing Three.js Project

Use this when the project uses CDN/`examples/js` globals, pre-r185 APIs, or mixed
legacy patterns. Preserve playable behavior; do not silently jump many revisions.

## Contents

- Detection
- Ordered migration
- Mechanical scanners
- Verification

## Detection

Look for:

- `<script src=".../three.min.js">` or import maps pointing at CDNs
- Global `THREE.` without `import * as THREE from 'three'`
- `examples/js/` (non-module) addons
- `THREE.Clock`, `outputEncoding`, `sRGBEncoding`, `RGBELoader`, `PCFSoftShadowMap`
- Manual `requestAnimationFrame` owning the renderer loop
- `EffectComposer` mixed into a `three/webgpu` import path

Run:

```bash
npm --prefix <skill-dir> run audit:project-apis -- <project>
npm --prefix <skill-dir> run probe:three -- <project>
```

## Ordered Migration

1. **Package imports** — `npm install three@^0.185.0` (or current latest ≥ r185). Switch to ES modules and `three/addons/...`.
2. **Loop** — `THREE.Timer` + `timer.connect(document)` + `timer.update(timestamp)` once per frame via `renderer.setAnimationLoop()`.
3. **Color** — `renderer.outputColorSpace = SRGBColorSpace`; color textures `SRGBColorSpace`; data maps `NoColorSpace`.
4. **Tone mapping** — intentional ACES / AgX / Neutral for lit PBR; opaque canvas unless HTML compositing is required.
5. **Shadows** — `PCFShadowMap` (not `PCFSoftShadowMap`).
6. **Loaders** — `HDRLoader` for RGBE `.hdr`; initialize WebGPU before KTX2 detect when on that path.
7. **Post** — keep WebGL `EffectComposer`+`OutputPass` or WebGPU `RenderPipeline`; never mix families.
8. **Retune** — light intensities and shadow bias after r185 behavior changes.

Do not perform a wide revision jump as a side effect of an unrelated fix. Read
intervening migration guide sections when crossing many releases.

## Mechanical Scanners

- `audit:project-apis` — stale API denylist
- `audit:assets` — local glTF/texture checklist
- `ship-check` — probe → APIs → local-only → build → canvas → report

## Verification

Build/typecheck, browser smoke, one real input path, nonblank canvas, and a short
list of remaining risks. Only then resume premium polish refs from `load-budgets.md`.

# Lighting, Environment, And Shadows

## Contents

- Choose this reference when
- Novice mental model
- Smallest correct lighting rig
- Choose light types
- HDR environment lighting
- Directional, spot, point, and area-light recipes
- Shadow quality and stability
- Cheap grounding and baked alternatives
- Common failures
- Performance
- Disposal
- Verification
- Official documentation

## Choose This Reference When

Read this file when surfaces are black, flat, overexposed, ungrounded, hard to
read, or casting poor shadows. Also use it when adding an HDR environment,
choosing a light type, fitting a shadow camera, building a day/night rig,
reducing shadow cost, or replacing expensive lights with authored cues.

Asset-loading examples use the project-owned `publicAssetUrl()` helper from
`local-assets.md`; import it from the local asset boundary in real code.

Start with the fewest roles that explain the scene:

| Need | Prefer |
| --- | --- |
| Global PBR reflections and soft ambient illumination | HDR environment |
| Sun/moon or a distant strong direction | `DirectionalLight` |
| Flashlight, headlamp, cone, or stage light | `SpotLight` |
| Bulb, explosion, beacon, or compact local source | `PointLight` |
| Window, softbox, monitor, or rectangular emitter | `RectAreaLight` |
| Very cheap ambient floor/sky separation | `HemisphereLight` |
| Debug-only uniform fill | Small `AmbientLight` |
| Repeated contact cue | Blob/contact plane or baked AO |

Do not solve every dark area with another light. First check material color
space, normals, exposure, environment strength, camera composition, and the
intended value hierarchy.

## Novice Mental Model

Lights affect materials; they do not illuminate empty space by themselves.
PBR materials combine direct light, environment radiance, surface roughness,
metalness, normals, and camera direction. A background image is visible scenery;
an environment image is lighting. They may share one HDR source but have
different intensity, blur, and rotation.

A shadow is another render from the light's point of view into a depth map.
Directional and spot lights usually need one shadow render. A point light needs
six directions, so it is much more expensive. Shadow map resolution covers the
whole shadow camera volume; tightening that volume often improves quality more
than increasing map size.

Environment light and ambient light do not cast shadows. Use direct shadow
lights, baked lighting, AO, or a deliberate contact cue for grounding.

## Smallest Correct Lighting Rig

This local-only WebGL example combines one HDR environment with one fitted
directional shadow light. It assumes the renderer and scene already exist:

```ts
import * as THREE from 'three';
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

export async function installLighting(
  scene: THREE.Scene,
  renderer: THREE.WebGLRenderer,
) {
  const environment = await new HDRLoader().loadAsync(
    publicAssetUrl('assets/environments/studio-1k.hdr'),
  );
  environment.mapping = THREE.EquirectangularReflectionMapping;
  scene.environment = environment;
  scene.environmentIntensity = 0.85;

  const sun = new THREE.DirectionalLight(0xfff3df, 2.5);
  sun.position.set(8, 12, 6);
  sun.target.position.set(0, 1, 0);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.near = 0.5;
  sun.shadow.camera.far = 35;
  sun.shadow.camera.left = -10;
  sun.shadow.camera.right = 10;
  sun.shadow.camera.top = 10;
  sun.shadow.camera.bottom = -10;
  sun.shadow.camera.updateProjectionMatrix();
  sun.shadow.normalBias = 0.025;
  scene.add(sun, sun.target);

  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;

  return {
    environment,
    sun,
    dispose() {
      if (scene.environment === environment) scene.environment = null;
      if (scene.background === environment) scene.background = null;
      scene.remove(sun, sun.target);
      sun.dispose();
      environment.dispose();
    },
  };
}
```

Each participating mesh still needs `castShadow` and/or `receiveShadow`:

```ts
character.traverse((object) => {
  if (object instanceof THREE.Mesh) object.castShadow = true;
});
ground.receiveShadow = true;
```

Do not enable shadow casting on every decorative triangle by default.

## Choose Light Types

### Ambient and hemisphere fill

`AmbientLight` has no direction and can flatten form. Keep it small when an HDR
environment is already present. `HemisphereLight` adds a sky/ground gradient
that is useful for stylized outdoor scenes but still creates no shadows.

```ts
const skyFill = new THREE.HemisphereLight(0x9cc7ff, 0x30261d, 0.45);
scene.add(skyFill);
```

### Direct-light intensity

Current Three.js light behavior no longer uses legacy light toggles. Retune old
projects rather than restoring removed legacy flags. `PointLight` and
`SpotLight` intensity is measured in candela and their `power` in lumens.
Default physically meaningful decay is `2`; keep it unless art direction has a
measured reason to change it. Directional, ambient, and hemisphere intensities
are relative scene strengths.

Tone mapping and exposure are part of the same calibration. Record exposure,
environment intensity, and key-light intensity together so one system does not
silently compensate for another.

## HDR Environment Lighting

Use `HDRLoader` for local RGBE `.hdr` files in r185. `RGBELoader` still ships
only as a deprecated compatibility alias, so do not use it in new code. Use
`EXRLoader` for `.exr` and `UltraHDRLoader` for Ultra HDR JPEG. All three
loaders return environment color data tagged `LinearSRGBColorSpace`; preserve
that metadata rather than changing it to `SRGBColorSpace` or `NoColorSpace`.

```ts
import { HDRLoader } from 'three/addons/loaders/HDRLoader.js';

const hdr = await new HDRLoader().loadAsync(
  publicAssetUrl('assets/env/dusk-1k.hdr'),
);
hdr.mapping = THREE.EquirectangularReflectionMapping;

scene.environment = hdr;
scene.environmentIntensity = 0.8;
scene.environmentRotation.y = Math.PI * 0.2;

scene.background = hdr; // optional; lighting does not require this
scene.backgroundIntensity = 0.55;
scene.backgroundBlurriness = 0.18;
scene.backgroundRotation.y = Math.PI * 0.2;
```

Current renderers prefilter supported environment textures for rough PBR
reflections. Keep the source texture alive while it is assigned. Use a modest
resolution for lighting; a giant visible background can be a separate asset if
the camera requires more detail.

When an HDR is unavailable, `RoomEnvironment` can provide a procedural neutral
IBL for viewers and material validation. This version is for `WebGLRenderer`,
with `THREE` imported from `three`:

```ts
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';

const room = new RoomEnvironment();
const pmrem = new THREE.PMREMGenerator(renderer);
const environmentTarget = pmrem.fromScene(room);
scene.environment = environmentTarget.texture;

room.dispose();
pmrem.dispose();

function disposeGeneratedEnvironment() {
  // Run at scene teardown, after clearing every assignment.
  if (scene.environment === environmentTarget.texture) {
    scene.environment = null;
  }
  if (scene.background === environmentTarget.texture) {
    scene.background = null;
  }
  environmentTarget.dispose();
}
```

Retain and dispose the returned `WebGLRenderTarget`, not only its `.texture`.
The target owns the generated environment texture and render attachments.

For `WebGPURenderer`, import `THREE` from `three/webgpu` so its renderer-aware
`PMREMGenerator` is used, and initialize the backend before synchronous PMREM
generation:

```ts
import * as THREE from 'three/webgpu';

await renderer.init();
const pmrem = new THREE.PMREMGenerator(renderer);
const environmentTarget = pmrem.fromScene(room);
```

Do not pass a `WebGPURenderer` to the WebGL PMREM implementation imported from
`three`. The older `fromSceneAsync()` initialization workaround is deprecated;
initialize the renderer explicitly instead.

## Directional, Spot, Point, And Area-Light Recipes

### Follow a bounded play area with a directional shadow

Keep the light direction and orthographic extent fixed, then snap the moving
center in light space by one shadow texel. This assumes the light and target
are direct scene children and the chosen offset is not parallel to world-up:

```ts
const sunOffset = new THREE.Vector3(12, 18, 8);
const worldUp = new THREE.Vector3(0, 1, 0);
const lightDepthAxis = sunOffset.clone().normalize();
const lightRight = new THREE.Vector3()
  .crossVectors(worldUp, lightDepthAxis)
  .normalize();
const lightUp = new THREE.Vector3()
  .crossVectors(lightDepthAxis, lightRight)
  .normalize();
const shadowCenter = new THREE.Vector3();

const shadowCamera = sun.shadow.camera;
const texelX =
  (shadowCamera.right - shadowCamera.left) / sun.shadow.mapSize.x;
const texelY =
  (shadowCamera.top - shadowCamera.bottom) / sun.shadow.mapSize.y;

function updateSunRegion(playerPosition: THREE.Vector3) {
  const x = Math.round(playerPosition.dot(lightRight) / texelX) * texelX;
  const y = Math.round(playerPosition.dot(lightUp) / texelY) * texelY;
  const z = playerPosition.dot(lightDepthAxis);

  shadowCenter
    .copy(lightRight)
    .multiplyScalar(x)
    .addScaledVector(lightUp, y)
    .addScaledVector(lightDepthAxis, z);

  sun.target.position.copy(shadowCenter);
  sun.position.copy(shadowCenter).add(sunOffset);
  sun.target.updateMatrixWorld();
}
```

Recompute texel size whenever the map size or frustum extent changes. For a
large world that needs multiple ranges, use `CSM` from
`three/addons/csm/CSM.js` with `WebGLRenderer`, or `CSMShadowNode` from
`three/addons/csm/CSMShadowNode.js` with `WebGPURenderer`. Cascades multiply
shadow passes; start with the fewest ranges that solve the measured view.

The WebGL addon must receive every affected material through
`csm.setupMaterial(material)` and run `csm.update()` before each render. For
WebGPU, construct `CSMShadowNode` with the directional light, assign it to
`light.shadow.shadowNode`, and call `updateFrustums()` after camera or cascade
settings change; its per-frame positioning runs through the node update path.

### Flashlight with `SpotLight`

```ts
const flashlight = new THREE.SpotLight(
  0xeaf4ff,
  180,                 // candela; tune with exposure and world scale
  24,
  THREE.MathUtils.degToRad(24),
  0.35,
  2,
);
flashlight.castShadow = true;
flashlight.shadow.mapSize.set(1024, 1024);
flashlight.shadow.camera.near = 0.1;
flashlight.shadow.camera.far = 24;
flashlight.position.set(0, 1.6, 0);
flashlight.target.position.set(0, 1.4, -5);
cameraRig.add(flashlight, flashlight.target);
```

The target must be in the scene graph. Keep its transform updated with the
owner. The shadow camera follows the cone; avoid manually fighting its field of
view without checking the official behavior.

### Local point lights

```ts
const beacon = new THREE.PointLight(0x53b8ff, 90, 8, 2);
beacon.position.set(0, 1.5, 0);
scene.add(beacon);
```

Prefer emissive geometry without a real light for repeated distant beacons.
Enable a point-light shadow only for a hero source that visibly needs all six
shadow faces.

### Rectangular area light

With `WebGLRenderer`, initialize the official uniform library once:

```ts
import { RectAreaLightUniformsLib } from
  'three/addons/lights/RectAreaLightUniformsLib.js';
import { RectAreaLightHelper } from
  'three/addons/helpers/RectAreaLightHelper.js';

RectAreaLightUniformsLib.init();
const windowLight = new THREE.RectAreaLight(0xbfdcff, 6, 4, 2);
windowLight.position.set(0, 3, 2);
windowLight.lookAt(0, 1, 0);
scene.add(windowLight);

const helper = new RectAreaLightHelper(windowLight);
windowLight.add(helper); // debug only
```

For `WebGPURenderer`, install the LTC textures on the area-light node instead:

```ts
import * as THREE from 'three/webgpu';
import { RectAreaLightTexturesLib } from
  'three/addons/lights/RectAreaLightTexturesLib.js';

THREE.RectAreaLightNode.setLTC(RectAreaLightTexturesLib.init());
```

Initialize the relevant library once for the chosen renderer. Rect area lights
affect `MeshStandardMaterial` and `MeshPhysicalMaterial` and do not cast native
shadows. Use a separate shadow strategy if grounding is needed.

## Shadow Quality And Stability

### Fit the light camera

Add a temporary helper and make the volume just large enough for relevant
casters and receivers:

```ts
const helper = new THREE.CameraHelper(sun.shadow.camera);
scene.add(helper);

// After changing the shadow camera:
sun.shadow.camera.updateProjectionMatrix();
helper.update();
```

Anything outside the shadow camera cannot cast or receive that light's shadow.
For a directional shadow, orthographic width and height determine world units
per texel in X/Y; the near/far span determines depth precision. Tighten those
independently instead of assuming a larger map fixes both.

### Bias deliberately

- `bias` offsets depth comparison and can reduce acne, but excessive values
  detach shadows from objects.
- `normalBias` offsets along the receiver normal and often helps grazing-angle
  acne, but can distort thin objects.
- Fix world scale, normals, overlapping faces, and shadow-camera range before
  applying large bias values.

Tune with a close ground contact, a vertical wall, a thin prop, and a distant
receiver all visible.

### Custom-deformed casters

Built-in skinning, morph targets, displacement maps, alpha-tested maps, and
opt-in shadow clipping (`clipShadows = true`) are mirrored by the renderer's
shadow materials. A custom WebGL vertex deformation added through
`onBeforeCompile` or `ShaderMaterial` is not. Apply the same transform to the
visible, depth, and distance programs:

```ts
const windTime = { value: 0 };

function installWindDeformation(material: THREE.Material) {
  material.onBeforeCompile = (shader) => {
    shader.uniforms.windTime = windTime;
    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        '#include <common>\nuniform float windTime;',
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>
         transformed.x += sin(position.y * 5.0 + windTime)
           * 0.08 * max(position.y, 0.0);`,
      );
  };
  material.customProgramCacheKey = () => 'shared-wind-v1';
}

const visibleMaterial = new THREE.MeshStandardMaterial({ color: 0x5f8f43 });
const windDepthMaterial = new THREE.MeshDepthMaterial({
  depthPacking: THREE.RGBADepthPacking,
});
const windDistanceMaterial = new THREE.MeshDistanceMaterial();

installWindDeformation(visibleMaterial);
installWindDeformation(windDepthMaterial);
installWindDeformation(windDistanceMaterial);

mesh.material = visibleMaterial;
mesh.customDepthMaterial = windDepthMaterial;       // directional and spot
mesh.customDistanceMaterial = windDistanceMaterial; // point

// In the frame update:
windTime.value = elapsedSeconds;
```

Keep the injected transform and its uniforms in one shared function as above;
any mismatch produces detached or undeformed shadows. Dispose both custom
shadow materials with the visible material. For production lit bending, also
deform the visible material's normals; the depth and distance passes only need
matching positions and cutout rules. These `custom*Material` hooks are
WebGL-only. With a WebGPU/node material, `positionNode` is reused for the shadow
pass by default; set `castShadowPositionNode` only when the caster needs a
different shadow-specific position.

### Static shadows

When one light's casters, receivers, and transform are static, freeze only that
light's map:

```ts
sun.shadow.autoUpdate = false;
sun.shadow.needsUpdate = true; // render one fresh update for this light

function afterStaticLightingChanged() {
  sun.shadow.needsUpdate = true;
}
```

With `WebGLRenderer` only, use `renderer.shadowMap.autoUpdate = false` when every
shadow light can be frozen; `renderer.shadowMap.needsUpdate = true` then
refreshes the global shadow system. `WebGPURenderer` exposes the per-light
`LightShadow` flags shown above, not those two global update flags. If both
WebGL's global gate and a light's per-light gate are disabled, set both
`renderer.shadowMap.needsUpdate` and `light.shadow.needsUpdate` for the next
refresh. Do not freeze a light while any caster or receiver visible to it still
moves. Separate static baked/fake shadowing from dynamic casters.

### Directional framing + contact-shadow fake

Frame the key light so the playable silhouette reads clearly, then ground
characters with a cheap blob rather than a second expensive shadow map:

```ts
const sun = new THREE.DirectionalLight(0xfff2dd, 2.4);
sun.position.set(6, 10, 4);
sun.target.position.set(0, 0, 0);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.camera.left = -12;
sun.shadow.camera.right = 12;
sun.shadow.camera.top = 12;
sun.shadow.camera.bottom = -12;
sun.shadow.camera.near = 1;
sun.shadow.camera.far = 40;
sun.shadow.camera.updateProjectionMatrix();
scene.add(sun);
scene.add(sun.target);

// Cheap contact cue under the player (see blob texture helper above).
blob.position.set(player.x, 0.02, player.z);
blob.scale.setScalar(0.9 + player.speed * 0.05);
```

### Shadow type

Use `THREE.PCFShadowMap` as the current filtered baseline. Do not introduce
deprecated `PCFSoftShadowMap`. `BasicShadowMap` is cheapest and unfiltered.
`VSMShadowMap` adds separable blur controlled by `light.shadow.radius` and
`light.shadow.blurSamples`, can leak light, and renders `receiveShadow` objects
into the shadow pass even when `castShadow` is false. Shadow-map type is a
renderer-wide choice, not a per-light setting.

With `WebGLRenderer`, VSM does not support `PointLight`; the renderer warns and
skips that point-light shadow. With `WebGPURenderer`, point lights use the point
shadow filter rather than the VSM blur path, so do not select VSM expecting a
variance-blurred point shadow. Prefer Basic or PCF behavior for portable point
shadows. Compare screenshots, caster counts, and GPU time before changing type.

## Cheap Grounding And Baked Alternatives

Do not import a nonexistent `ContactShadows` object. Build a cheap local cue or
use an intentional screen-space/baked technique.

### Procedural blob shadow

```ts
function makeBlobTexture(size = 128) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('2D canvas unavailable');

  const gradient = context.createRadialGradient(
    size / 2, size / 2, 0,
    size / 2, size / 2, size / 2,
  );
  gradient.addColorStop(0, '#ffffff');
  gradient.addColorStop(0.55, '#9a9a9a');
  gradient.addColorStop(1, '#000000');
  context.fillStyle = gradient;
  context.fillRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.NoColorSpace;
  return texture;
}

const blobMap = makeBlobTexture();
const blobMaterial = new THREE.MeshBasicMaterial({
  color: 0x000000,
  alphaMap: blobMap,
  transparent: true,
  opacity: 0.32,
  depthWrite: false,
  toneMapped: false,
});
const blob = new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8), blobMaterial);
blob.rotation.x = -Math.PI / 2;
blob.position.y = 0.006;
scene.add(blob);
```

Scale and fade the blob from height; keep it aligned with the actual ground
query. Pool blobs for many characters and avoid one unique texture/material per
object.

Use baked lightmaps/AO for static architecture. Baked maps need a valid
non-overlapping `uv1` set and the texture's `channel` set to `1`. A bake is not
proof of correct dynamic gameplay lighting; keep interactive silhouettes and
hazards readable.

For an HDR/EXR lightmap, preserve `LinearSRGBColorSpace`; for AO, use
`NoColorSpace`. Both commonly use the second UV set:

```ts
bakedLight.colorSpace = THREE.LinearSRGBColorSpace;
bakedLight.channel = 1;

bakedAo.colorSpace = THREE.NoColorSpace;
bakedAo.channel = 1;

material.lightMap = bakedLight;
material.lightMapIntensity = 1;
material.aoMap = bakedAo;
material.aoMapIntensity = 1;
material.needsUpdate = true; // required when adding previously absent maps
```

Do not blindly tag an LDR lightmap as linear; match the encoding produced by
the baker/export pipeline and verify it through the complete output transform.

## Common Failures

- **PBR object is black:** no useful direct/environment light, invalid normals,
  extreme exposure, or a color-space error.
- **Directional/spot light points nowhere:** its target was moved but not added
  to the scene graph or updated.
- **Shadow is clipped:** caster/receiver lies outside the shadow camera.
- **Shadow is blocky:** the fitted region is too large for the map, not merely
  a low map-size number.
- **Shadow acne/peter-panning:** bias is compensating for scale, normals,
  overlapping geometry, or a poor near/far range.
- **Shadow follows late or swims:** light/target updates occur after render, or
  a continuously moving frustum lacks snapping/stability.
- **Performance collapses with a point light:** six shadow views multiplied the
  caster cost.
- **Area light has no visible effect:** initialization was skipped, material is
  unsupported, light faces away, or renderer-specific setup is wrong.
- **HDR is visible but does not light the model:** it was set only as background
  rather than environment.
- **Model is lit but floats:** environment/ambient light cannot cast a contact
  shadow; add a direct shadow, bake, or contact cue.
- **Old project changed brightness after upgrade:** legacy light behavior was
  removed; recalibrate lights and exposure instead of restoring old flags.

## Performance

- Measure shadow passes and GPU frame time, not only the main render calls.
- Limit shadow-casting lights and casters. One well-fitted key shadow usually
  communicates more than many low-quality maps.
- Start with 512 or 1024 maps and a tight frustum; raise resolution only when a
  screenshot at gameplay distance proves it is needed.
- Respect `renderer.capabilities.maxTextureSize`; large shadow maps consume GPU
  memory and bandwidth.
- Disable shadow updates for genuinely static rigs.
- Use emissive materials, decals, lightmaps, probes, vertex colors, and blobs
  for repeated/distant cues.
- Keep point-light distances finite and light counts small.
- Remove helpers in production; helpers add draws and can contaminate captures.
- Use one lower-resolution HDR for environment lighting when the visible
  background does not need matching detail.
- Profile the worst view: maximum enemies, particles, transparent effects, and
  every relevant caster in the light frustum.

## Disposal

- Call `dispose()` on directional, spot, and point lights that created shadow
  render targets.
- Remove both a light and its target from the scene.
- Call helper `dispose()` methods and remove helpers.
- Clear `scene.environment` and `scene.background` before disposing an assigned
  environment texture.
- Dispose generated PMREM render targets and the `PMREMGenerator` that produced
  them; do not dispose only `renderTarget.texture`.
- For WebGL `CSM`, call `remove()` and `dispose()`. For `CSMShadowNode`, clear
  the light's custom shadow-node assignment and call the node's `dispose()`.
- Dispose blob geometry, material, and texture once their shared owner releases
  the final borrower.
- Remove animated-light callbacks, timers, debug GUI bindings, and listeners.

Never dispose an HDR or shared light material while another scene still uses
it. Keep environment ownership at the scene/asset boundary.

## Verification

1. Capture a neutral material sphere, matte object, metal object, and player
   under the rig.
2. Toggle environment, each direct light, and each shadow independently.
3. Use light and shadow-camera helpers to confirm direction and coverage, then
   remove them.
4. Inspect near contact, thin geometry, vertical surfaces, distant receivers,
   and fast-moving casters for acne, detachment, clipping, and shimmer.
5. Rotate the camera through the playable route and verify threats/rewards by
   value and shape, not only by hue.
6. Compare 512/1024/2048 shadow maps with the frustum held constant and record
   GPU time.
7. Compare shadows updating every frame versus an allowed static update.
8. Test the HDR/background at low and high exposure and confirm output color is
   transformed once.
9. Tear down and recreate the scene; verify shadow targets and environment
   textures return to the same steady memory count.

## Official Documentation

- [Lights manual](https://threejs.org/manual/en/lights.html)
- [Shadows manual](https://threejs.org/manual/en/shadows.html)
- [DirectionalLight](https://threejs.org/docs/pages/DirectionalLight.html)
- [PointLight](https://threejs.org/docs/pages/PointLight.html)
- [SpotLight](https://threejs.org/docs/pages/SpotLight.html)
- [RectAreaLight](https://threejs.org/docs/pages/RectAreaLight.html)
- [RectAreaLightUniformsLib](https://threejs.org/docs/pages/RectAreaLightUniformsLib.html)
- [RectAreaLightTexturesLib](https://threejs.org/docs/pages/RectAreaLightTexturesLib.html)
- [LightShadow](https://threejs.org/docs/pages/LightShadow.html)
- [WebGLRenderer shadow map](https://threejs.org/docs/pages/WebGLRenderer.html)
- [WebGPURenderer guide](https://threejs.org/manual/en/webgpurenderer.html)
- [HDRLoader](https://threejs.org/docs/pages/HDRLoader.html)
- [EXRLoader](https://threejs.org/docs/pages/EXRLoader.html)
- [UltraHDRLoader](https://threejs.org/docs/pages/UltraHDRLoader.html)
- [PMREMGenerator](https://threejs.org/docs/pages/PMREMGenerator.html)
- [RoomEnvironment](https://threejs.org/docs/pages/RoomEnvironment.html)
- [Scene environment controls](https://threejs.org/docs/pages/Scene.html)
- [Object3D custom shadow materials](https://threejs.org/docs/pages/Object3D.html)
- [NodeMaterial shadow position](https://threejs.org/docs/pages/NodeMaterial.html)
- [WebGL cascaded shadow maps](https://threejs.org/docs/pages/CSM.html)
- [WebGPU cascaded shadow maps](https://threejs.org/docs/pages/CSMShadowNode.html)

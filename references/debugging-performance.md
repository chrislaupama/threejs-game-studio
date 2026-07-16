# Debug And Profile Checklists

## Contents

- Reproduction triage and blank-canvas checks
- Assets, audio, animation, physics, input, and mobile
- Performance measurement and preferred optimizations
- Diagnostics, report format, and common mistakes

Use this for blank canvases, bad framing, runtime errors, asset/audio loading issues, animation/collision/input failures, mobile bugs, and performance optimization.

## Triage Order

1. Reproduce locally with the same command and URL the user used when possible.
2. Capture console, page, and network errors.
3. Confirm the app is serving the expected build, not another local server on the same port.
4. Identify the owner: renderer, scene, camera, loop, assets, audio, input, physics, UI, CSS, build/base path, or performance.
5. Fix the root cause in the owning module.
6. Retest the exact broken path.

## Blank Or Bad Canvas

Check in this order:

- Canvas exists in the DOM.
- Canvas CSS size is nonzero and visible.
- Drawing buffer size is nonzero and matches expected DPR behavior.
- The chosen WebGL2 or WebGPU renderer initialized successfully. For WebGPU,
  eager renderer-dependent work occurs only after `await renderer.init()`.
- `webglcontextlost` is not firing during restart; no code accidentally calls
  `forceContextLoss()`. If loss is deliberate, `preventDefault()` and the
  restoration/recreation path are owned and tested.
- Renderer is rendering inside exactly one active loop.
- Camera has correct aspect, projection matrix, near/far, and points at visible content.
- Scene has visible objects at expected transforms and scale.
- Materials are visible: opacity, transparent, side, depth, color space, fog interaction.
- Lights exist when lit materials need them.
- Background/fog is not matching object color.
- Resize updates renderer, camera, composer, and CSS.
- CSS overlays are not covering the canvas.
- Render target/composer output is displayed.

## Asset Loading

Check:

- URLs and Vite base path.
- Files in `public/` or imported asset paths.
- Loader type and `three/addons/...` imports.
- CORS and MIME type errors.
- glTF external buffers/textures.
- Texture color space and flipY where relevant.
- Async load state, loading UI, error fallback, and retry behavior.
- Disposal of replaced assets.

For imported local GLB assets, also check file size, URL casing, Vite
public/import path, local Draco/Meshopt requirements, scene scale, pivot/origin,
bounds, texture dimensions, material count, animation clip names, and whether
all dependent files are present under stable project paths.

## Audio Loading And Playback

Check:

- Audio files exist at runtime URLs and have compatible MIME types.
- `AudioContext` is resumed from a user gesture before playback.
- Decode/load promises reject visibly instead of failing silently.
- SFX triggers are event-driven and not firing every frame.
- Ambience/music loops stop on pause, restart, and scene teardown.
- Mute/volume state controls every group.
- Page visibility pause/resume does not stack duplicate sources.
- Mobile browser unlock behavior is tested when mobile is in scope.

## Animation, Loop, And Physics

Check:

- Delta time units in seconds vs milliseconds.
- Delta clamping for tab sleep and frame spikes.
- Fixed-step physics accumulator if physics is timing-sensitive.
- Collision/physics state initialized before creating bodies or stepping.
- One simulation system owns body/collider creation and disposal.
- Physics timestep is stable and not tied directly to variable render delta.
- Animation mixer updates and clip actions.
- Multiple animation loops or a mixture of `requestAnimationFrame` and
  `renderer.setAnimationLoop()` owners.
- Deprecated `THREE.Clock`; current r185 code should update one `THREE.Timer`
  exactly once per frame.
- State transitions that stop updates or restart timers.
- Collision proxies vs visual meshes.
- Collider scale, rotation, and offset match the visual expectation.
- High-speed tunneling and spawn overlap.
- Swept collision or bounded substeps cover high-speed bodies that need it.
- Sensors/triggers have explicit enter/stay/exit or overlap checks.
- Kinematic moving platforms update physics bodies, not only visual meshes.
- Restart cleanup for entities, listeners, timers, effects, and physics bodies.
- Repeated restart soak: run enough cycles to reproduce the intermittent window
  and compare active loops, listeners, timers, entities, colliders, geometries,
  textures, render targets, and audio voices after every cycle.
- Imported model animation mixer exists, clips are bound to the correct root, root motion is intentional, and clip actions are stopped/cleaned up on restart.

## Input And Mobile Bugs

Check:

- Keyboard focus and prevented default only where needed.
- Pointer listeners attached to the correct element.
- Pointer capture and release/cancel behavior.
- `touch-action` CSS and viewport meta.
- Page scroll stealing gestures.
- Device pixel ratio causing tiny controls or high GPU cost.
- Safe-area insets.
- Orientation/resize after rotation.
- Desktop input still works after mobile controls are added.
- UI controls emit game intents and do not directly duplicate simulation rules.
- Held actions track keyboard, pointer, touch and gamepad sources independently;
  releasing one source does not cancel another still-held source.

## Performance Profiling Order

Measure in production preview when user-facing performance matters.

1. Establish scenario: viewport, DPR, route, gameplay state, camera view, mobile/desktop.
2. Baseline:
   - Frame-time distribution (p50/p90/p95 and worst relevant spike), not only a
     rounded FPS counter.
   - Renderer calls.
   - Triangles.
   - Geometries.
   - Materials.
   - Textures.
   - Render targets/post passes.
   - JS heap or memory estimate when available.
   - Bundle and large assets when relevant.
   - Imported model file sizes, animation clips, and texture dimensions when
     local 3D assets were added.
   - Body count, collider count, sensors, swept/substepped bodies, active
     contacts/pairs, and simulation-step cost when collision changed.
   - Event-correlated measures for spikes: `performance.mark/measure` around the
     suspect callback, a performance trace, long tasks/GC evidence when
     available, and p50/p95/p99 frame or handler time over the same event burst.
3. Classify bottleneck:
   - CPU: simulation, allocations, pathfinding, physics, animation mixers, UI layout.
   - GPU draw: draw calls, material switches, too many unique meshes.
   - GPU fragment: overdraw, post-processing, high DPR, transparent particles.
   - GPU vertex: high triangle count, dense shadows.
   - Memory: textures, render targets, undisposed resources.
   - Loading/bundle: large dependencies or local assets, decode/transcode and
     shader-compilation stalls.
4. Apply one optimization.
5. Re-measure the same scenario.
6. Check visual/playability regression.

For intermittent defects, do not stop after one passing reproduction. Run an
N-cycle soak where N exceeds the original failure window, and prove lifecycle
and resource counters return to a stable baseline.

## Preferred Optimizations

- `InstancedMesh` for repeated objects sharing geometry and material.
- `BatchedMesh` for different geometries sharing one material.
- `BufferGeometryUtils.mergeGeometries()` for compatible static geometry.
- Shared geometries/materials/textures.
- Object pools for effects, bullets, pickups, and debris.
- Frustum/distance culling.
- LOD for background props and repeated world kits.
- DPR cap or adaptive quality.
- Cheaper shadows: fewer casters, smaller maps, static/contact alternatives.
- Limited post-processing passes.
- Texture atlases, compression, reuse, and mipmaps.
- Avoid per-frame allocations and unnecessary layout reads.
- Reduce physics cost with simple colliders, sleeping, fewer dynamic bodies, collision groups, pooled bodies, and narrower sensors before removing important gameplay.
- Dispose geometries, materials, textures, render targets, and audio resources.
- Create a simpler local variant, reduce texture resolution, consolidate
  materials, add LOD, or simplify unseen geometry before deleting important
  hero readability.

## Renderer Diagnostics Snippet

When possible, expose a diagnostic object:

```ts
window.__THREE_GAME_DIAGNOSTICS__ = {
  renderer: renderer.info,
  get state() {
    return game.getDebugState();
  },
};
```

Useful fields include `renderer.info.render.calls`, `triangles`, `points`, `lines`, `memory.geometries`, and `memory.textures`.

With multiple WebGL render/post passes, `renderer.info` resets after each
render call by default. Own the reset at the outer frame boundary:

```ts
renderer.info.autoReset = false;

function renderCompleteFrame(): void {
  renderer.info.reset();
  composer.render();
  publishRendererCounts(renderer.info);
}
```

Probe rather than assume the WebGL implementation, especially in headless CI:

```ts
function describeWebGL(renderer: THREE.WebGLRenderer): Record<string, string> {
  const gl = renderer.getContext();
  const debugInfo = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    version: String(gl.getParameter(gl.VERSION)),
    vendor: String(
      gl.getParameter(debugInfo ? debugInfo.UNMASKED_VENDOR_WEBGL : gl.VENDOR),
    ),
    renderer: String(
      gl.getParameter(debugInfo ? debugInfo.UNMASKED_RENDERER_WEBGL : gl.RENDERER),
    ),
  };
}
```

The extension can be unavailable or privacy-masked. Report the literal result;
do not infer a real GPU merely because a headed browser was used.

## Shader And Pipeline Triage

- Keep `renderer.debug.checkShaderErrors` enabled during development.
- Capture the first material/program error before subsequent warnings obscure
  it. Verify required attributes, defines, uniforms and color output.
- Identify the renderer path. WebGL accepts GLSL `ShaderMaterial`,
  `RawShaderMaterial`, `onBeforeCompile` and `EffectComposer`; WebGPU requires
  node materials/TSL and `RenderPipeline`.
- Test with post disabled. If the beauty pass is correct, add passes back one at
  a time and verify size, resolution, output transform and disposal.
- Prewarm a stable WebGL scene with `renderer.compileAsync(scene, camera)` only
  after assets/material permutations are ready; it is not a substitute for
  handling compilation errors.
- For WebGPU, initialize before eager rendering, KTX2 support detection, or
  other renderer-dependent setup. Use current synchronous `render()` after
  initialization.

Official APIs: [WebGLRenderer](https://threejs.org/docs/pages/WebGLRenderer.html)
and [WebGPURenderer](https://threejs.org/docs/pages/WebGPURenderer.html).

For physics-heavy games, add:

```ts
collision: {
  model: 'custom-fixed-step',
  timestep: 1 / 60,
  bodies: bodies.length,
  colliders: colliders.length,
  sensors,
  sweepTests,
}
```

## Bug Report Format

```text
Issue:
Reproduction:
Expected:
Actual:
Root cause:
Fix:
Verification:
Residual risk:
```

## Common Mistakes

- Guessing without reproducing.
- Optimizing development-server performance instead of production preview.
- Removing visual detail before checking DPR, post, shadows, instancing, or culling.
- Fixing symptoms in CSS when renderer/camera sizing is wrong.
- Adding mobile controls without testing pointer cancel and safe areas.
- Ignoring console/page errors because the canvas appears nonblank.
- Trusting a headless renderer label or FPS assumption without probing it.
- Publishing only the last post pass's renderer counts because info auto-reset
  was left enabled.
- Shipping an imported model without checking scale, pivot, collision, animation clips, texture memory, or mobile cost.

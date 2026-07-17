# Local Three.js Visual Architecture

## Contents

- Ownership and local content strategy
- Production surfaces and technical-art contract
- Materials, procedural textures, model factories, and world layers
- Render/VFX diagnostics, budgets, and implementation order

Use this when a Three.js game reads as basic even after it is playable. The goal
is a production graphics architecture that can be iterated, scored, profiled,
and reused. For polished/showcase work, also read `technical-art.md` and treat
the technical-art brief and budget as part of the graphics architecture.

## Recommended Ownership

```text
src/assets/MaterialLibrary.ts
src/assets/ProceduralTextures.ts
src/assets/DecalShapes.ts
src/assets/ModelDiagnostics.ts
src/assets/ImportedAssetRegistry.ts
src/assets/modelFactories/HeroFactory.ts
src/assets/modelFactories/ObstacleFactory.ts
src/assets/modelFactories/RewardFactory.ts
src/assets/modelFactories/WorldPropKit.ts
src/systems/LightingRig.ts
src/systems/RenderPipeline.ts
src/systems/VfxSystem.ts
src/systems/WorldArtDirector.ts
src/systems/QualityDiagnostics.ts
```

Keep these boundaries lightweight. In small projects, a single file can contain multiple factories, but the concepts must remain separate: materials, authored geometry, repeated props, effects, render settings, and diagnostics.

## Local Content Strategy

Choose the asset path per surface:

- Procedural Three.js: hero forms, repeated detail, props, rails, track parts,
  decals, collision proxies, VFX geometry, sky, and debug-friendly primitives.
- Authored browser content: Canvas/SVG/CSS UI art, `CanvasTexture`,
  `DataTexture`, trim sheets, procedural noise, signs, icons, and gradients.
- Project-local imports: models, images, textures, fonts, and audio already
  owned by the project.
- User-supplied files: local content attached or placed by the user, with its
  source and license preserved.
- Hybrid local construction: imported local subject -> asset wrapper ->
  procedural collision/VFX/prop kit -> active-play scorecard.

Fill the local content plan from `workflow.md` before broad graphics work. A
premium hero may be fully procedural when its silhouette, secondary structure,
tertiary detail, materials, state cues, active-play readability, and measured
cost pass the same quality gate as an imported model.

## Production Surfaces

A premium pass must touch every weak visible surface:

- Hero/player: authored silhouette, state feedback, decals/trim, readable front/up/side, collision proxy.
- Hazards/enemies: the design-required family breadth, repetition budget,
  telegraphs, and material cues (or `N/A` with a prewritten non-combat reason).
- Rewards/interactables: the design-required value/state families with
  activation states and motion/VFX hooks (or justified `N/A`).
- World kit: foreground, playable lane/arena, midground, background/parallax, set dressing, scale cues.
- Materials/textures: shared PBR/stylized material library, procedural panel lines, noise, trim, wear, emissive masks.
- Lighting/render: color space, tone mapping, exposure, shadows/contact, fog/depth, post-processing discipline.
- VFX/motion: event-driven bursts, trails, impact rings, speed lines, shield/boost states, pickup/fail feedback.
- UI/world cohesion: UI colors, icons, alerts, and meters echo gameplay materials and status colors.
- Diagnostics: renderer counts, material/geometry/texture counts, screenshots, scorecard.

For imported local 3D assets, require stable project files, import wrappers with
scale/pivot/bounds, simple collision proxies, animation clips when relevant,
and triangle/material/texture/file-size diagnostics.

## Technical Art Contract

Before broad implementation, write the technical art brief and render budget from `references/technical-art.md`: hero vs support surfaces, render budget target, material kit roles, shader/VFX purpose, instancing/LOD/culling plan, and imported asset cleanup. Treat that brief as part of this graphics architecture.

Do not add costly effects until this contract exists. A technical-art pass should make the scene more authored and more measurable at the same time.

## Material Library

Implement the named material-role kit defined in `references/technical-art.md` (`bodyPrimary`, `bodySecondary`, `trim`, `hazard`, `reward`, `glass`, `emissiveSignal`, `groundContact`, `decalDark`/`decalLight`, plus shared UI/world signal colors) in `src/assets/MaterialLibrary.ts`. Create named roles instead of one-off colors and share materials across repeated meshes.

## Procedural Texture And Decal Kit

Use canvas textures, shape geometry, or thin offset meshes for detail that would otherwise require separate image assets:

- Panel lines and access hatches.
- Trim sheets and edge bands.
- Window strips, city light grids, arena markings.
- Hazard stripes, arrows, target indicators, lane glyphs.
- Scratches, wear, noise, dirt, heat tint, scorch marks.
- UI/world icon motifs reused in HUD and diegetic markers.

Set texture filtering, mipmaps, repeat/wrap, color space, and anisotropy intentionally. Avoid unique full-size textures for tiny repeated marks.

Author high-value 2D content locally with Canvas/SVG/CSS or use project-owned
files: terrain patterns, trim sheets, signs, hazard stripes, cockpit decals,
sky/background plates, menu art, faction marks, pickup icons, ability icons,
and GUI glyphs. Keep them in stable project paths and share motifs between the
world and UI.

## Model Factories

Factories should return a grouped object plus metadata:

```ts
type ModelFactoryResult = {
  root: THREE.Group;
  collision?: THREE.Object3D;
  lod?: THREE.LOD;
  bounds?: THREE.Box3;
  diagnostics?: {
    meshes: number;
    materials: number;
    geometries: number;
    triangles?: number;
  };
};
```

Use named child meshes for readable debugging. Separate visual detail from collision proxies. Keep repeated detail instanced where practical.

For imported local 3D models, create an `ImportedAssetRegistry` or loader
wrapper that returns similar metadata: root group, bounds, collision proxy,
animation clips, and diagnostics. Keep every URL same-origin and project-local.

## World Art Director

Build the world as layers:

- Play layer: ground, lanes, rails, objective path, hazards, pickups.
- Near layer: speed props, signs, arches, barriers, debris, foreground occluders used carefully.
- Mid layer: buildings, cliffs, hangars, pillars, platforms, arena machinery.
- Far layer: skyline, terrain silhouettes, nebula/cloud/fog cards, parallax planes.
- Motion layer: speed lines, particles, trail strips, dust, sparks, screen-space UI feedback.

Every layer should support gameplay readability. Do not obscure threats or the next decision.

## Render Pipeline

Own renderer setup in one place:

- `outputColorSpace = THREE.SRGBColorSpace`.
- Tone mapping and exposure selected for the art direction.
- DPR and drawing-buffer pixels capped per declared desktop/mobile/constrained
  tier; record actual buffer size after resize rather than sharing one desktop
  cap across every device.
- Shadows enabled only for objects that benefit from grounding.
- Post-processing is limited and measured: bloom, vignette, chromatic aberration, film grain, or color grade only when they improve authored forms.
- Resize updates canvas, renderer, camera, composer, and UI CSS variables.

## VFX System

Implement the event-driven VFX language from `references/technical-art.md` in `src/systems/VfxSystem.ts`. Effects should be pooled, readable, and tied to state; they must clarify state instead of adding permanent particle clutter.

## Diagnostics

Own diagnostics in `src/systems/QualityDiagnostics.ts`. Report the renderer diagnostics defined in `references/technical-art.md` (calls, triangles, geometries, textures, material count, DPR/post/shadow settings), plus these architecture-specific counts:

- Scene mesh count, instanced mesh count, unique materials/geometries/textures.
- Approximate visible prop counts by layer.
- Screenshot paths and visual scorecard.
- Performance notes after post-processing, shadows, or many repeated props.

## Browser Game Budgets

Use the render budget starting points and instancing/LOD/culling guidance in `references/technical-art.md`, then measure on the target game after every major graphics pass.

## Implementation Order

1. Declare category applicability from the game brief, score active screenshots,
   and identify the weakest three applicable categories.
2. Add material and diagnostic foundations.
3. Decide which weak surfaces need procedural, project-local, user-supplied, or
   hybrid local treatment.
4. Build/import the hero/player and one complete obstacle/reward family.
5. Add world prop kit and layered composition.
6. Add lighting/render polish.
7. Add event-driven VFX.
8. Rebuild, replay through real input, and recapture the same deterministic
   full-shell desktop/mobile states in normal and reduced-motion modes.
9. Re-score and remeasure the same worst-case render scene.
10. Fix the lowest category or highest measured bottleneck, then repeat steps
    8-10 until the requested score and performance thresholds pass with no
    automatic failure. If they cannot pass, report the blocker and next pass.

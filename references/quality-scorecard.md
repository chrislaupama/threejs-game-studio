# Game Visual Scorecard

## Contents

- Verbal calibration and scoring scale
- Packaged screenshot calibration anchors
- Ten quality categories
- Thresholds, automatic failures, and measured evidence
- Fresh-eyes review and report format

Score complete active-play game-shell screenshots (canvas plus player-facing
HUD/touch UI), not idle title screens, canvas-only crops, or isolated showroom
models. Use desktop and mobile screenshots when mobile is in scope, and inspect
the separate deterministic normal- and reduced-motion captures for categories
affected by animation or effects.

Scores are self-assessed, so they drift optimistic. Two countermeasures are
mandatory for polished/premium/showcase claims: cite measured evidence for the
categories it supports, and run the fresh-eyes review before finalizing.

## Packaged Calibration Anchors

Before scoring art direction, hero/player, world/environment,
materials/textures, lighting/render, or UI/HUD, view all three local images in
`assets/scorecard-anchors/`:

- `scene-1.jpg`: approximately score 1 — playable but primitive-dominant,
  sparse arena, repeated pickups, utility HUD.
- `scene-2.jpg`: approximately score 2 — authored route/world kit, differentiated
  game pieces, stronger hierarchy, designed genre HUD.
- `scene-3.jpg`: approximately score 2.5-3 — active-play composition, layered
  depth and speed cues, readable hero path, cohesive lighting and HUD.

Use the anchors as calibration, not templates or runtime game assets. Compare
the complete active capture set at intended play distance. If the result reads
closer to `scene-1.jpg` than `scene-3.jpg` for a surface, do not award a high
score because the implementation was difficult or code-heavy. Use the verbal
calibration below if image viewing is unavailable.

## Verbal Calibration

- Around 1: primitive player and pickups, flat/sparse arena, repeated
  silhouettes, utility HUD, and styling carried mainly by color or glow.
- Around 2: authored hero and threat/reward families, modular world depth,
  designed genre HUD, intentional materials/lighting, and measured budgets.
- Around 3: memorable cohesive art direction across active play, layered world,
  expressive state feedback, disciplined VFX/rendering, responsive UI, and
  strong diagnostics without sacrificing clarity.

Judge what is visible at the intended play distance. Code volume and hidden
detail do not raise a score.

## Scoring Scale

- 0: Placeholder. Default primitives, sparse world, unreadable state, debug UI, or no evidence.
- 1: Basic styled. Playable and themed, but still obvious prototype assets, flat composition, repeated silhouettes, or generic UI.
- 2: Premium stylized. Authored silhouettes, material/detail systems, readable state, cohesive UI/world, measured performance.
- 3: Showcase. Strong art direction, memorable hero and world, dense authored detail, excellent readability, polished VFX/rendering, and diagnostics.

## Applicability Contract

Mark applicability from the written game/design brief **before** looking at the
result. `N/A` is valid only when the surface is genuinely absent by design —
for example, obstacles/enemies in a peaceful model viewer, or collectible
rewards in a narrative scene with no interactables. It is not valid because a
required surface was omitted, is still a placeholder, or scored poorly.

For every `N/A`, record the design evidence and remove that category from both
the numerator and denominator. Art direction, world/environment,
materials/textures, lighting/render, UI/accessibility shell, and performance
evidence normally remain applicable even in non-combat experiences. Replace
combat-specific nouns with the closest designed interactive family where
appropriate rather than forcing irrelevant enemy or pickup counts.

## Categories

1. Art direction.
   - 0: No clear theme.
   - 1: Theme is mostly colors/fog.
   - 2: Theme affects forms, materials, UI, world, and feedback.
   - 3: Distinct identity visible in every surface.
2. Hero/player.
   - 0: Default primitive stack.
   - 1: Basic object with glow or simple attachments.
   - 2: Authored silhouette, decals/trim, state cues, collision proxy.
   - 3: Memorable model with layered construction and expressive feedback.
3. Obstacles/enemies.
   - 0: Cubes/cones/spheres.
   - 1: Recolored repeated silhouette.
   - 2: The authored family breadth promised by the design brief is present,
     with readable telegraphs and material cues.
   - 3: Memorable variation, animation, anticipation, and gameplay clarity at
     the encounter density the design actually ships.
4. Rewards/interactables.
   - 0: Plain sphere/ring/token.
   - 1: Repeated object with simple glow.
   - 2: The design-required interactable/reward family has authored forms,
     idle/activation states, and UI feedback.
   - 3: Each designed value/state reads immediately during motion and the
     family remains desirable without relying on color alone.
5. World/environment.
   - 0: Flat plane, empty arena, box skyline.
   - 1: Themed but sparse repeated blocks.
   - 2: Layered prop kit with foreground/midground/background and scale cues.
   - 3: Dense authored world that supports gameplay readability.
6. Materials/textures.
   - 0: Flat colors.
   - 1: Basic roughness/metalness or emissive color.
   - 2: Shared material roles, procedural decals, trim, panel lines, wear/noise.
   - 3: Rich cohesive material language with measured texture/resource use.
7. Lighting/render.
   - 0: Default lights or unreadable darkness.
   - 1: Fog/bloom used as main style.
   - 2: Intentional tone mapping, exposure, key/fill/rim, contact, depth.
   - 3: Cinematic but readable composition with disciplined post-processing.
8. VFX/motion.
   - 0: None or random particles.
   - 1: Generic particles/trails.
   - 2: Event-driven VFX for boost, pickup, hit, fail, combo, shield, or spawn.
   - 3: High-impact effects that clarify gameplay and remain performant.
9. UI/HUD.
   - 0: Debug text or missing UI.
   - 1: Generic stat-card dashboard.
   - 2: Genre-specific HUD states, meters/icons, responsive text fit.
   - 3: Cohesive game interface with strong hierarchy and polished transitions.
10. Performance evidence.
   - 0: No metrics after visual changes.
   - 1: Informal "seems fine".
   - 2: Renderer counts, build/browser QA, desktop/mobile screenshots, and technical-art budget notes.
   - 3: Baseline/post metrics, bottleneck notes, budgets, optimized asset strategy, and VFX/readability tradeoffs.

## Thresholds

Premium:

- Every applicable category at least 2.
- Average across applicable categories at least 2.3.
- Desktop and mobile active-play screenshots captured when mobile is in scope.
- Renderer diagnostics reported after graphics changes.
- Every `N/A` is justified against the prewritten design brief.

Showcase:

- At least `ceil(0.6 * applicable categories)` score 3 (six when all ten apply).
- No applicable category below 2.
- Average across applicable categories at least 2.7.
- Performance evidence includes before/after or budget-aware notes.

## Automatic Failures

Any of these prevents a polished/premium/showcase claim:

- Active screenshot is primitive-dominant.
- Main world is mostly stretched boxes, flat planes, or a sparse arena.
- Hero asset is mostly default primitives plus glow.
- A design-required obstacle, enemy, reward, or interactable family collapses
  to one repeated silhouette without a documented gameplay reason.
- HUD is mostly rectangular stat/debug cards.
- Fog, darkness, bloom, or particles hide missing authored geometry.
- UI overlaps the play path, clips text, or fails mobile safe areas.
- The game is not playable through real input.
- No active-play screenshot was captured.
- Only a canvas crop or reduced-motion capture was used to claim full-shell,
  UI, or default-motion quality.
- No renderer diagnostics were collected after major graphics work.
- No technical-art budget or imported-local-asset diagnostics were reported for
  premium graphics work.

## Measured Evidence

Run the canvas inspector (`npm run inspect:canvas` or
`scripts/inspect-threejs-canvas.ts`) on relevant viewports and cite its
`metrics` and `renderBudget` blocks. Pixel metrics are smoke signals only. They
can reward visual noise and penalize an intentionally sparse, high-quality art
direction, so never convert a threshold directly into a score or automatic
failure. Calibrate them against the packaged anchors and the game's own prior
captures, then interpret them with the complete active capture set:

- Large entropy/dominant-color changes can reveal blank, flat, or unexpectedly
  noisy output; inspect the image before drawing an art conclusion.
- Large edge-density changes can reveal missing geometry, aliasing, excessive
  particles, or texture noise; they do not measure authored detail.
- Large contrast changes can reveal fog/darkness compression or a broken output
  transform; a low-key palette may still be deliberate and readable.
- `renderBudget` rows over the tier budget require a documented tradeoff in the
  technical-art budget (see `technical-art.md`).
- Renderer diagnostics (calls, triangles, geometries, textures) back the Performance evidence category.

## Fresh-Eyes Review

The builder must not be the only grader. For polished/premium/showcase claims:

- If the runner supports subagents (Task tool or equivalent), spawn a reviewer with ONLY: the screenshots, this scorecard file, and the inspector metrics JSON. No build context, no prior scores. The reviewer must receive the COMPLETE capture set — every captured state, desktop and mobile — never a hand-picked subset; a curated selection can hide weak states or miss content the builder knows exists (capture states with the inspector's `--state` flag so nothing is gated behind live play). The reviewer fills the scorecard independently; reconcile by taking the lower score per category unless concrete evidence overturns it. Report both score sets.
- If subagents are unavailable, run an adversarial self-review before finalizing: for each category, write one sentence making the strongest case that the score is a 1, citing what is visible in the screenshot; only then assign the score. Include these sentences in the report.

## Score-Fix-Measure Loop

One scoring pass is a diagnosis, not completion. Repeat this bounded loop:

1. Capture the complete deterministic desktop/mobile state set and record
   renderer/performance evidence.
2. Score all applicable categories and list automatic failures.
3. Fix the lowest applicable category or highest-impact automatic failure.
4. Rebuild, replay through real input, recapture the same states, and remeasure
   the same budget scene.
5. Repeat until the requested threshold passes with no automatic failure, or
   report the exact blocker and next pass.

Do not average away a category below the floor, reuse a pre-fix measurement,
or stop because the first visual change looks subjectively better.

## Report Format

```text
Visual scorecard:
- Art direction [applicable]: before X / after Y - evidence:
- Hero/player [applicable or N/A + design reason]: before X / after Y - evidence:
- Obstacles/enemies [applicable or N/A + design reason]: before X / after Y - evidence:
- Rewards/interactables [applicable or N/A + design reason]: before X / after Y - evidence:
- World/environment [applicable]: before X / after Y - evidence:
- Materials/textures [applicable]: before X / after Y - evidence:
- Lighting/render [applicable]: before X / after Y - evidence:
- VFX/motion [applicable or N/A + design reason]: before X / after Y - evidence:
- UI/HUD [applicable]: before X / after Y - evidence:
- Performance evidence [applicable]: before X / after Y - evidence:
Measured evidence: colorEntropyBits / edgeDensity / luminance.contrast /
  dominantColorShare per viewport, renderer diagnostics, render budget rows
Fresh-eyes review: subagent scores or adversarial self-review notes
Applicable categories / N/A reasons:
Average (applicable denominator only):
Automatic failures remaining:
Iterations and score/metric delta per pass:
```

If any applicable category remains below threshold, state the exact next pass
instead of declaring completion.

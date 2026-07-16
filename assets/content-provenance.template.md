# Local Content Provenance

Copy this file into a broad game project at discovery time. Add one row for
every meaningful model, texture, font, audio file, shader source, icon, or
procedural content family. Static audits cannot prove how a local file was
obtained; this inventory is the human-reviewed evidence.

Allowed source categories: `procedural`, `project-local`, `user-supplied`, and
`deferred`.

Use a stable key that matches code or the content ledger. Record file bytes on
disk; use `generated at runtime` for procedural content. Use `n/a — reason`
where a field truly does not apply. Never leave ownership or teardown
ambiguous. Delete the labeled example rows after replacing them.

| Content key | Asset type | Runtime path | Source category | Original/local source + license/ownership | Bytes | Scale / axes / pivot | Bounds / collider | Clips | Textures / color space / compression | Sharing | Teardown owner |
| --- | --- | --- | --- | --- | ---: | --- | --- | --- | --- | --- | --- |
| `example-hero-procedural` | procedural model | `src/content/createHero.ts` | procedural | project-authored; project-owned | generated at runtime | 1 unit = 1 m; +Y up; -Z forward; feet pivot | local AABB; gameplay capsule | n/a — no rig | 0 textures; vertex colors in linear workflow | one geometry/material set shared by hero instances | `HeroFactory.dispose()` |
| `example-player-glb` | model + animation | `/assets/models/player.glb` | user-supplied | attachment `player.glb`; user confirmed project-use rights | 2,430,112 | normalized to 1.8 m; +Y up; -Z forward; feet pivot | measured world AABB; separate capsule | `Idle` 2.0 s, `Run` 0.8 s; in-place | 3 textures, max 2048 px; sRGB base color, linear normal/ORM; KTX2 | GLB loaded once; skeleton-safe clone per player | `AssetStore.dispose()` after all clones |

## Inventory checks

- [ ] Every meaningful asset or procedural family has one row and an asset
  type.
- [ ] Every runtime path is stable, local, case-correct, and exercised in the
  production preview.
- [ ] Every source category is allowed, and the original/local source plus
  license or ownership is recorded without guessing.
- [ ] File bytes are measured; deferred or generated content says so plainly.
- [ ] Models record units/scale, up and forward axes, pivot, measured bounds,
  and a deliberately separate gameplay collider when appropriate.
- [ ] Animated assets record clip names, durations, root-motion policy, and
  the gameplay state mapping; non-animated assets say `n/a`.
- [ ] Texture-bearing assets record texture count, maximum resolution, color
  space by role, and compression choice; other assets say `n/a`.
- [ ] Sharing states what is cached, shared, cloned, or instanced and prevents
  one owner from disposing resources still used by another.
- [ ] Teardown owner names the system or method that releases GPU, audio, DOM,
  worker, cache, and object-URL resources during disposal/re-entry.

Declaration:

- No asset search, download, hotlink, MCP call, hosted generator, provider SDK,
  remote API, or cloud runtime was used for this content set.
- Any user-supplied third-party file retains its source and license notes.
- Every runtime path is stable, local, and included in production-preview QA.
- Scale/axes/pivot, bounds/collider, clips, textures/color-space/compression,
  sharing, and teardown ownership were checked rather than inferred from the
  filename.

Reviewed by:
Date:

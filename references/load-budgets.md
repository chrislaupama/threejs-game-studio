# Reference Load Budgets

Use this file immediately after classifying scope. Load only the minimum set for
the current scope, then add triggered refs. Do not preload premium, WebGPU,
shader, or release manuals before the playable loop is proven.

## Contents

- Scope budgets
- Hard defer rules
- Trigger map

## Scope Budgets

| Scope | Always load first | Load only when triggered | Hard defer until |
| --- | --- | --- | --- |
| Focused | Owning tech ref + `quickref.md` + `qa-release.md` | `debugging-performance.md` if blank/broken | Premium refs, genre playbooks, full `workflow.md` ledgers |
| First playable / greenfield | `official-docs.md`, `quickref.md`, `gameplay-architecture.md`, `fundamentals.md`, matching `genre-playbooks.md` section | `physics.md` / `audio.md` / `ui.md` when adding those systems | Scorecard, `webgpu.md`, `shaders.md`, `webxr.md` |
| Premium polish | Prior playable set + `visual-architecture.md`, `quality-scorecard.md`, `rendering.md`, `vfx.md` | `webgpu.md` / `shaders.md` if renderer/post changes; `overlays.md` for world labels | Full release matrix until scorecard path is green |
| Release | `qa-release.md`, `visual-regression.md` or bot decision, `quality-gates.md` | `ship-check` outputs; mobile/a11y refs when claimed | New features after freeze |
| Legacy upgrade | `upgrade-existing.md`, `official-docs.md`, `quickref.md` | Owning tech refs per migration step | Premium polish until build + smoke pass |
| Network ask | `networking-boundary.md` first | Nothing else for net until architecture approved | Inventing sockets inside the render loop |

Focused scope does **not** keep full design, content, or performance ledgers.
Reproduce → fix → proportionate QA only.

Broad, premium, and release scopes use the ledgers in `workflow.md`.

## Hard Defer Rules

- Do not load `shaders.md` until a playable loop has browser smoke evidence.
- Do not claim scorecard categories until active-state captures exist.
- Do not load `webxr.md` until desktop/mobile non-XR loop is stable (unless the
  request is XR-only).
- Do not load the full `implementation-recipes.md` for a one-line fix; load the
  owning section only when the decision tree points there.
- Do not skip `load-budgets.md` itself on broad or greenfield work.

## Trigger Map

| Signal | Add |
| --- | --- |
| Blank or black canvas | `debugging-performance.md` |
| Controls feel bad | `game-feel.md`, `interaction.md` |
| Looks basic / premium ask | `visual-architecture.md`, `quality-scorecard.md` |
| Import / texture / glTF issues | `local-assets.md`, `loaders-animation.md`; run `audit:assets` |
| Physics-heavy | `physics.md` |
| Multiplayer / cloud saves | `networking-boundary.md` — stop and get approval |
| Pre-r185 / CDN / global THREE | `upgrade-existing.md`; run `audit:project-apis` |

# Runner Genre Contract

Overlay for the endless-runner playbook in `references/genre-playbooks.md`.

- Player promise: pilot a compact sprint craft through a readable obstacle lane at speed.
- Primary verb: steer laterally while the craft auto-runs along local `-Z`.
- Objective: reach `120 m`; recycled barriers supply continuous pressure and collision failure.
- Skill expression: read the open line early, smooth lateral corrections, and hold boost only when
  the route is safe.
- Input: `A`/`D` or left/right arrows steer; `Space`/`Shift` or the touch Boost button increases
  forward and lateral pace; pause and retry use the scaffold controls.
- Camera/presentation: the chase rig and runner both use fixed-step interpolation. The directional
  light and its scene-owned target follow the active track window so shadows remain available down
  the full run rather than only near the origin.
- HUD: distance/target, elapsed run time, current pace, boost state, pause, collision failure, and
  retry copy are runner-specific.
- Deterministic evidence: seed/state/reduced-motion/screenshot hooks and renderer diagnostics are
  available during development. Production builds expose them only when built with
  `VITE_ENABLE_GAME_DIAGNOSTICS=true`.

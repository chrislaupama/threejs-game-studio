# Platformer Genre Contract

This overlay turns the arena scaffold into **Skyline Steps**, a compact authored
3D platformer slice. The generator copies the overlay after the base scaffold,
so `index.html`, `src/game/Game.ts`, and `src/systems/Hud.ts` replace the generic
arena versions.

## Player-facing contract

- Player promise: make a clean ascent across a chain of floating platforms.
- Target feeling: responsive, readable, and precise without simulation-heavy
  character physics.
- Primary verbs: run and jump.
- Objective: touch the summit flag on the final platform.
- Pressure: gaps get longer while platforms narrow and change height.
- Reward: a clear-state panel records the completion time.
- Failure/retry: falling below `FALL_KILL_Y` ends the run; retry immediately
  resets movement, camera, timer, flag state, and presentation history.
- Skill expression: preserve momentum, correct in the air, and jump near an edge
  to shorten the route.
- Non-goals: moving platforms, wall movement, enemies, slopes, and rigid-body
  interactions. Add Rapier before introducing those collision requirements.

Core loop:

```text
Run and jump toward the flag while gaps punish poor timing; reaching it records
a clear time, while a fall gives an immediate retry.
```

## Course and camera plan

The safe start pad teaches movement before five authored jumps. Successive pads
alternate lateral direction and rise from `y=0` to `y=3`, with the teal summit
pad and gold flag acting as the destination landmark. The route advances along
world `-Z`, matching the scaffold's `W`/Arrow Up convention.

The player mesh faces local `-Z`. Its yaw therefore uses
`atan2(-velocity.x, -velocity.z)`; this makes rightward travel face world `+X`
instead of mirroring the model. The follow camera sits at positive Z behind the
route so upcoming landing decisions remain visible.

## Controls

| Intent | Keyboard | Touch |
| --- | --- | --- |
| Move | `WASD` or arrow keys | Movement joystick |
| Jump | `Space` or either `Shift` key | **Jump** button |
| Pause/resume | `P` or `Escape` | Pause/Resume button |
| Retry after a run | `R`, `Enter`, or the retry button | Retry button |
| Mute | Mute button | Mute button |

`InputController.isDashHeld()` is the scaffold's generic action-slot API; in
this overlay the slot means **jump**. Player-facing text must never call it a
dash.

## Movement and collision tuning

| Constant | Value | Purpose |
| --- | ---: | --- |
| `MOVE_SPEED` | 6.2 units/s | Ground and air steering target |
| `JUMP_VELOCITY` | 10.5 units/s | Jump takeoff impulse |
| `GRAVITY` | -28 units/s² | Compact arcade jump arc |
| `COYOTE_TIME_SECONDS` | 0.10 s | Allows a jump just after leaving an edge |
| `JUMP_BUFFER_SECONDS` | 0.12 s | Remembers a press just before landing |
| `PLAYER_RADIUS` | 0.45 units | Horizontal landing tolerance |
| `FALL_KILL_Y` | -4 units | Readable failure plane below the course |

Collision is intentionally a fixed-step custom landing test. It checks the
player's previous and current foot heights while descending, then snaps to a
platform top only when the player crosses it inside the expanded X/Z bounds.
Passing the real previous height avoids hidden `1/60` assumptions and remains
stable if the loop timestep changes. Use separate simple collider data rather
than the rendered mesh bounds.

The platformer owns an `InterpolatedTransform` for the player because it applies
vertical movement directly instead of calling the arena player's planar update.
Every simulation step follows `beginStep -> mutate authoritative pose ->
endStep`; render calls `present(alpha)`, and reset/terminal states call `snap`.
Do not overwrite the presented transform without restoring the authoritative
pose first.

## HUD and accessibility semantics

- The HUD reports one flag objective and elapsed run time as `MM:SS.t`.
- Only the status line is a polite live region; the frequently changing timer
  is not announced on every update.
- Pause and terminal panels use platformer-specific instructions.
- The touch action is labelled **Jump**, while the canvas has a genre-specific
  accessible name.
- The flag-reached pulse is skipped when the operating system requests reduced
  motion.

## Diagnostics and deterministic QA

Development builds expose `window.__THREE_GAME_DIAGNOSTICS__` and
`window.__THREE_GAME_TEST_HOOKS__`. Production builds expose neither by default.
For a production-like QA build, opt in explicitly:

```bash
VITE_ENABLE_GAME_DIAGNOSTICS=true npm run build
```

Hook states remain compatible with the scaffold inspector:

- `active-play`: deterministic spawn and clean timer.
- `paused`: clean run held at the spawn platform.
- `complete`: player snapped to the flag, score `1/1`, state `won`.
- `failed`: player snapped below the kill plane, state `lost`.
- `seed(value)`: controls the small spawn jitter.
- `setPausedForScreenshot`, `setReducedMotion`, and `hideDebugUi`: stabilize
  capture without advancing gameplay.

Diagnostics use `score=0/1` for the objective, `hazards=0`, negative Z for course
progress, and a stable renderer type (`WebGLRenderer`). They avoid enumerating
the Three.js namespace in the frame loop.

Example movement assertion:

```ts
const before = await page.evaluate(
  () => window.__THREE_GAME_DIAGNOSTICS__?.player.position.z ?? 0,
);
await page.keyboard.down('KeyW');
await page.waitForTimeout(350);
await page.keyboard.up('KeyW');
await expect
  .poll(() =>
    page.evaluate(() => window.__THREE_GAME_DIAGNOSTICS__?.player.position.z ?? 0),
  )
  .toBeLessThan(before - 1);
```

## Release checks

1. Run the strict TypeScript production build.
2. Verify `W` moves toward negative Z and `D` turns the local `-Z` nose toward
   positive X.
3. Complete at least one real-input jump and one buffered near-landing jump.
4. Walk off a platform, confirm the fall state, and retry without stale velocity
   or camera interpolation.
5. Trigger the `complete`, `failed`, and `paused` test states and inspect desktop
   and mobile captures.
6. Confirm production output has no diagnostics globals unless the explicit
   environment opt-in is present.

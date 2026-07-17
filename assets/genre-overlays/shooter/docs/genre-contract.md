# Shooter Genre Contract

Overlay for dogfight/action shooter guidance in `references/genre-playbooks.md`.

- Player promise: pilot a responsive strike craft, line up its nose, and clear a compact arena under pressure.
- Primary verbs: move with WASD/arrows/touch; hold Space, Shift, or the touch `Fire` button to shoot.
- Direction contract: the craft's authored forward axis is local `-Z`; movement yaw, the nose mesh, and projectile velocity all follow that same convention.
- Objective: neutralize all six targets in wave 1 before the 45-second timer expires.
- Pressure/fail: enemy contact breaches the one-point hull; the mission also fails on timeout. `Redeploy` resets health, targets, projectiles, timer, and presentation state.
- Camera: elevated, interpolated follow over the bounded arena.
- HUD: targets neutralized, hull, wave, mission time, and contextual mission status. Shooter copy replaces all inherited relay/dash terminology.
- Presentation: player, enemies, projectiles, and camera interpolate between fixed simulation steps. Reused projectiles snap their interpolation state at the muzzle so they never streak from an old pooled position.
- Release diagnostics: hooks and snapshots are enabled in development or when `VITE_ENABLE_GAME_DIAGNOSTICS=true`; production builds omit them by default.
- Evidence contract: kill score, target count, win/lose/pause/retry states, renderer diagnostics, seeded test states, and mobile controls remain compatible with the scaffold.

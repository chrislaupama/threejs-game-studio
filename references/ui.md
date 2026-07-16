# Game UI Patterns

## Contents

- UI principles, required states, and HUD composition
- Menus, touch controls, and responsive constraints
- Semantic DOM, accessibility, local art, state wiring, and verification

Use this when designing HUDs, menus, overlays, pause/fail/win states, touch controls, typography, responsive layout, and UI/world cohesion.

## UI Principles

- Build the game interface, not a web dashboard.
- Prioritize gameplay hierarchy: survival/status, objective/progress, immediate feedback, then flavor.
- Use meters, icons, reticles, badges, alert strips, cooldown rings, inventory slots, minimaps, diegetic labels, and compact clusters before generic stat cards.
- Keep UI outside the play path and away from threats, pickups, the player, and the next decision.
- UI should reinforce the world art direction through material cues, color roles, icon shapes, and motion language.
- Do not use visible text to explain obvious controls when an icon, affordance, or direct interaction can do the job.

## Required States

Inventory states before designing:

- Gameplay HUD.
- Pause/resume.
- Settings or audio/accessibility controls when useful.
- Fail/retry.
- Win/milestone/level complete when relevant.
- Loading/empty/error when async assets exist.
- Mobile/touch controls when target includes mobile.
- Debug/tuning UI gated separately from player UI.

Premium games should not have only one HUD state.

## Semantic DOM Overlay

Use HTML/CSS for most HUD and menus. It stays sharp at any DPR, supports text,
focus, screen readers and safe areas, and avoids spending GPU texture memory on
dynamic labels.

```html
<main id="game-shell">
  <canvas id="game-canvas" aria-label="Game view"></canvas>
  <section id="hud" aria-live="polite" aria-atomic="false">
    <div class="objective">
      <span id="objective-label">Crystals</span>
      <output id="objective-value" aria-labelledby="objective-label">0 / 8</output>
    </div>
    <button id="pause-button" type="button" aria-label="Pause game">Ⅱ</button>
  </section>
  <section id="pause-dialog" role="dialog" aria-modal="true" hidden>
    <h1>Paused</h1>
    <button id="resume-button" type="button">Resume</button>
    <button id="restart-button" type="button">Restart</button>
  </section>
</main>
```

Use `aria-live` only for sparse important updates. Do not announce a timer or
score every frame. Move focus into an opened modal and restore it to the control
that opened the modal on close. `hidden` elements must not remain keyboard
focusable.

```ts
const dialog = document.querySelector<HTMLElement>('#pause-dialog')!;
const pauseButton = document.querySelector<HTMLButtonElement>('#pause-button')!;
const resumeButton = document.querySelector<HTMLButtonElement>('#resume-button')!;

function renderPauseState(paused: boolean): void {
  dialog.hidden = !paused;
  pauseButton.setAttribute('aria-pressed', String(paused));
  if (paused) resumeButton.focus();
  else pauseButton.focus();
}
```

The button dispatches a `pause` intent. The state machine decides whether the
transition is legal; `renderPauseState` only reflects canonical state.

## HUD Composition

Use intentional zones:

- Top or top-left: objective, wave, distance, timer, route/progress.
- Top or top-right: score, currency, combo, inventory, pause.
- Bottom left/right: touch movement/action controls when needed.
- Center top or near player: short event banners, combo, warnings.
- Near-world labels: diegetic prompts, target markers, offscreen indicators.

Rules:

- Use fixed-width numeric containers for score, timer, ammo, speed, health, and best values.
- Use icons plus short labels for unfamiliar resources.
- Use meter fills for quantities the player must read quickly.
- Use alert colors consistently: danger, reward, shield, boost, objective, disabled.
- Animate state changes briefly: count-up, meter fill, pulse, slide/fade, snap, ring cooldown.
- Do not stack multiple large banners over the play path.

## Menus And Overlays

Pause/fail/win overlays should support quick action:

- Primary action first: resume, retry, continue, next.
- Secondary actions: settings, quit, restart, level select.
- Avoid marketing-page hero layouts inside a game.
- Keep menu panels stable and readable across desktop/mobile.
- Use icon buttons for pause, sound, restart, fullscreen, settings when familiar.
- Provide focus/hover/pressed/disabled states.
- Gate debug panels behind a dev flag or query param.

## Touch Controls

When mobile is in scope:

- Use pointer events where possible.
- Ensure controls emit the same game intents as keyboard/mouse.
- Handle `pointerup`, `pointercancel`, `lostpointercapture`, blur, and visibility change.
- Use safe-area insets.
- Avoid controls overlapping HUD warnings or the play path.
- Keep touch targets at least roughly 44 CSS pixels where practical.
- Separate adjacent controls enough to prevent accidental presses.
- Use `touch-action` to prevent unwanted page scrolling only in control regions or the game surface.

Use CSS safe-area variables and keep the canvas behind the overlay:

```css
#game-shell {
  position: fixed;
  inset: 0;
  overflow: hidden;
  background: #090b10;
}

#game-canvas {
  display: block;
  width: 100%;
  height: 100%;
}

#hud {
  position: absolute;
  inset:
    max(12px, env(safe-area-inset-top))
    max(12px, env(safe-area-inset-right))
    max(12px, env(safe-area-inset-bottom))
    max(12px, env(safe-area-inset-left));
  pointer-events: none;
}

#hud button,
.touch-control {
  pointer-events: auto;
  min-width: 44px;
  min-height: 44px;
  touch-action: none;
}
```

Do not put `pointer-events: none` on an ancestor of interactive descendants
without explicitly restoring it. Test a real touch sequence including cancel
and lost capture.

## Responsive Constraints

- Define stable dimensions with CSS variables, `clamp`, grid tracks, fixed icon slots, and fixed-width numbers.
- Do not scale text purely with viewport width.
- Avoid negative letter spacing.
- Check desktop, laptop, tablet/narrow, and phone viewports.
- Test longest likely values: high score, long labels, multi-digit timers, localized-ish text if relevant.
- No clipped text, overlapping controls, unreadably small labels, or layout shift from changing values.
- Menus must remain reachable without offscreen controls.

Separate UI scaling from renderer pixel ratio. CSS pixels define legibility and
hit areas; renderer DPR defines canvas cost. Raising DPR must not shrink the HUD.

## Visual Style

- Match the genre: arcade racers need speed/status readability; fighters need health/round/impact hierarchy; exploration games need inventory/objective clarity.
- Prefer restrained panels with meaningful geometry, borders, ticks, glow accents, and material cues over nested cards.
- Use a limited status palette plus neutral surfaces.
- Avoid one-note purple/blue gradient UI unless it is strongly justified by the game world.
- Connect UI motifs to world decals, faction marks, vehicle panels, pickups, or hazards.

## Local UI Art

Author interface assets with local SVG, Canvas, CSS, project-owned images, or
user-supplied files:

- Faction logos, team crests, title marks.
- Pickup, ability, weapon, inventory, achievement, and objective icons.
- Hazard signs, decals, lane glyphs, cockpit labels, item badges.
- Menu/loading/background plates, illustrated map panels, world-style UI textures.
- GUI material references: glass panels, metal frames, holographic strips, paper/parchment, tactical screens.

Use a project-local 3D model only when the UI genuinely needs a rotating
character preview, vehicle garage, weapon inspect view, trophy, diorama, or
diegetic menu prop. Ordinary HUD elements remain semantic HTML/CSS/SVG/Canvas.

## State Wiring

- UI reads game state from a single source of truth.
- UI events dispatch game intents; they should not mutate unrelated simulation internals directly.
- UI should update on pause, restart, resize, mobile orientation, mute, fail/win, score, health, boost, combo, inventory, and accessibility settings.
- Avoid stale values after restart.

Render only when view-model values change rather than writing DOM strings every
animation frame:

```ts
type HudModel = Readonly<{
  score: number;
  target: number;
  health: number;
  state: 'playing' | 'paused' | 'won' | 'lost';
}>;

const objectiveValue = document.querySelector<HTMLOutputElement>('#objective-value')!;
const healthMeter = document.querySelector<HTMLMeterElement>('#health-meter')!;
let previous: HudModel | undefined;

function renderHud(next: HudModel): void {
  if (!previous || next.score !== previous.score || next.target !== previous.target) {
    objectiveValue.value = `${next.score} / ${next.target}`;
  }
  if (!previous || next.health !== previous.health) {
    healthMeter.value = next.health;
  }
  if (!previous || next.state !== previous.state) {
    document.body.dataset.gameState = next.state;
  }
  previous = next;
}
```

Use a stable view model. Do not expose mutable entity objects to UI code.

## Accessibility And Motion

- Honor `prefers-reduced-motion` and provide an in-game setting when camera
  shake, flashes, parallax or animated menus materially affect comfort.
- Limit rapid full-screen luminance changes. Provide a reduced-flash path for
  impact effects.
- Keep status meaning in shape/icon/text as well as color.
- Provide visible keyboard focus and logical tab order for menus.
- Offer remapping when control complexity warrants it; at minimum document all
  controls and avoid hard-coding a primary action to one inaccessible input.
- Do not trap pointer lock or fullscreen. Escape must restore a usable menu and
  focus state.
- Keep essential state in DOM text or an equivalent accessible channel when the
  canvas visual alone cannot communicate it.

```ts
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
const motionScale = () => reducedMotion.matches ? 0 : 1;
```

Listen for changes only if the game supports live OS preference updates, and
remove that listener during disposal.

## Verification

Capture evidence:

- Gameplay HUD desktop screenshot.
- Gameplay HUD mobile screenshot when in scope.
- Pause/fail/retry state screenshot if changed.
- Text-fit and overlap check with high values.
- Touch target and safe-area check when mobile is in scope.
- Interaction test for UI buttons and touch controls.
- Console/page error check after UI events.
- Local UI asset paths and source/license notes when files were added.
- Imported local 3D preview path and renderer diagnostics when a 3D UI object
  was used.

## Common Failures

- Generic dashboard/stat-card HUD.
- Nested cards and oversized decorative panels.
- UI covers threats, pickups, player, or next decision.
- Text explains obvious controls instead of designing affordances.
- Mobile safe areas ignored.
- Touch controls look correct but do not emit intents.
- Values change width and shift layout during play.
- Debug UI ships as player UI.

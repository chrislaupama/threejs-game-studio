# Genre Completion Playbooks

Use the matching section after `game-design.md` when building or substantially
upgrading one of these genres. Treat each playbook as a completeness and QA
contract, then tune counts to the requested scope and intended session length.
Do not copy mechanics that conflict with the player's stated fantasy.

## Contents

- Shared completion contract
- Endless runner and arcade racer
- Dogfight/space shooter and tower defense
- Cue sports and mini golf
- Boss arena and spatial/physics puzzle

## Shared Completion Contract

Before art polish, define and implement:

- The primary decision repeated every few seconds.
- The objective arc from start through escalation to victory, ending, or an
  intentionally endless mastery loop.
- The pressure model, readable setback/failure, reward/progression, and fast
  retry path.
- The content families needed to create combinations rather than recolors.
- Camera and input rules that reveal the next decision in time.
- Difficulty parameters, seeded scenario data, and an active-play tuning loop.
- Genre-specific HUD state, local audio events, and visual telegraphs.
- A deterministic smoke route plus human play through the hardest expected
  active state.

For a game described as complete, do not stop at one mechanic demonstration.
Provide the promised session arc, required states, meaningful combinations,
and an ending/restart contract appropriate to the genre.

## Endless Runner

### Player Contract

- Define lane switching, free steering, jumping, sliding, boosting, or another
  small verb set with immediate response.
- Communicate upcoming safe paths before commitment becomes impossible.
- Alternate compression and release: threat combinations, then reward or
  visibility windows.

### Content Contract

- Author at least three mechanically distinct obstacle families for a polished
  run: low/over, high/under or gate, and moving/timed/special pressure.
- Author at least two reward/interactable roles beyond recoloring one pickup.
- Build reusable path and world modules with foreground, midground, background,
  route marks, landmarks, and speed cues.
- Give the player a readable chase-camera silhouette, collision footprint,
  state cue, and motion trail or equivalent speed feedback.

### Systems And Tuning

- Ramp speed, density, combinations, lane pressure, reward risk, and recovery
  spacing through named parameters.
- Prevent impossible seeded combinations with a reachability/lookahead rule.
- Pool segments, obstacles, rewards, and short-lived effects; recycle only
  after every gameplay and visual owner releases the object.
- Keep camera smoothing, FOV, roll, shake, and horizon stable enough to avoid
  nausea and preserve the next decision.

### Verification

- Play through teaching, ordinary collection, dense combinations, near miss,
  boost/power state, failure, and restart.
- Test at maximum designed speed for tunneling, unreadable telegraphs, spawn
  overlap, camera loss, and recycle seams.
- Confirm the HUD prioritizes distance/progress, score/streak, survival state,
  temporary power, then flavor.

## Arcade Racer

### Player Contract

- State the handling fantasy: grip, drift, hover, rally, traffic threading, or
  combat racing.
- Define steering response, acceleration/braking, traction or drift, boost,
  recovery, and collision consequence around that fantasy.
- Show route direction, apex/braking cues, rivals, and hazards early enough to
  support deliberate driving.

### Track And Race Contract

- Build a complete route with start, first safe turn, escalating tests,
  landmarks, recovery width, risk/reward line, final challenge, and finish.
- Include corners or sections that test distinct skills rather than repeating
  one radius and width.
- Own lap/checkpoint order, wrong-way detection, placement or target time,
  countdown, finish, result, and restart states.
- Keep shortcut validation spatially honest; crossing a later checkpoint must
  not silently complete skipped route sections.

### Systems And Tuning

- Use a fixed step for collision-sensitive vehicle dynamics and separate the
  authored handling model from render interpolation.
- Tune camera look-ahead, pitch/roll, speed FOV, occlusion recovery, and reset
  without stealing steering authority.
- Make collisions readable and recoverable unless harsh damage is an explicit
  rule; prevent wall impacts from trapping or launching the player unfairly.
- Add opponents only when their pathing, collisions, and race state are stable;
  a strong time-trial arc is better than decorative rivals.

### Verification

- Complete a clean run, miss a checkpoint, drive backward, collide at several
  angles, leave/rejoin the route, finish, and restart.
- Test the fastest section at low frame rate for tunneling and input instability.
- Verify track readability and HUD fit from desktop and mobile chase framing
  when mobile is in scope.

## Dogfight Or Space Shooter

### Player Contract

- Define movement space, turn/strafe/roll behavior, engagement range, weapon
  cadence, projectile speed, aiming assistance, and escape options.
- Keep target position, closing direction, incoming threat, weapon readiness,
  and objective state readable during rotation.
- Provide a reliable recenter/reacquire path after the player loses orientation.

### Encounter Contract

- Use objectives that force movement: defend, intercept, escort, destroy
  components, survive a wave, capture a zone, or reach an extraction point.
- Give enemy families distinct movement, attack, defense, and telegraph roles.
- Compose waves or phases that combine known roles, then include recovery and
  resupply beats.
- Define arena bounds or soft-return behavior without invisible, unexplained
  punishment.

### Systems And Tuning

- Keep authoritative forward/up bases consistent across ship motion, camera,
  weapons, target indicators, and imported local models.
- Use swept projectile tests or bounded substeps at maximum relative velocity.
- Pool projectiles and impact effects; cap voices and particles during dense
  combat.
- Separate aim intent, weapon rules, projectile simulation, damage, and VFX so
  visual effects cannot alter hit logic.

### Verification

- Test target acquisition on-screen and off-screen, close crossing shots,
  pursuit, escape, bounds, multi-enemy pressure, damage/failure, objective
  completion, and restart.
- Confirm indicators do not overlap the reticle or lie about depth/direction.
- Measure the densest wave, not an empty flight state.

## Tower Defense

### Player Contract

- Define path topology, build zones, tower roles, enemy roles, economy cadence,
  wave preview, base health, victory, and defeat.
- Make placement, targeting, upgrading, and selling understandable through one
  shared pointer/touch selection model.
- Reveal enough about the next wave to support planning before punishment.

### Content Contract

- Build maps with multiple useful positions, range/line-of-sight tradeoffs, or
  route pressure; avoid one obvious solved tile.
- Give towers distinct jobs such as sustained damage, burst, area control,
  slow/support, armor break, or anti-air rather than linear recolors.
- Give enemies complementary traits that test those roles and combine them in
  readable waves.
- Provide build, selected, valid/invalid placement, range, attack, upgrade, and
  disabled states.

### Systems And Tuning

- Keep deterministic path progress as the authoritative targeting sort key.
- Centralize economy transactions and reject invalid purchases atomically.
- Separate simulation range/line-of-sight from decorative meshes and particles.
- Pool projectiles/effects and cap target searches through spatial bucketing or
  staggered updates when unit counts grow.

### Verification

- Test every tower/enemy role, invalid and edge placement, upgrade/sell math,
  pause/speed controls, wave transition, leak/base damage, victory, defeat, and
  restart.
- Run at least one no-upgrade and one mixed-build route to expose dominant or
  nonfunctional choices.
- Measure the peak wave with ranges, particles, and HUD visible.

## Cue Sports

### Player Contract

- Treat rules and ball motion as the core game, not decoration around a table.
- Define aim, camera, cue elevation if supported, force, spin/english, legal
  target, turn order, foul, scoring, win, and reset.
- Show predicted information only to the precision promised by the design.

### Table And Physics Contract

- Use a fixed step, swept/substepped ball motion, sphere contacts, rail planes,
  pocket sensors, sleep thresholds, and deterministic turn settlement.
- Keep visual ball scale and collision radius identical at the authoritative
  boundary; do not use detailed rail/pocket meshes as collision geometry.
- Resolve simultaneous contacts consistently and defer rule adjudication until
  the shot's ordered event record is complete.
- Keep aim lines, legal-target cues, ball colors/marks, shadows, pockets, and
  rails readable from overhead and aiming cameras.

### Verification

- Test soft and maximum-force shots, rail rebounds, pocket jaws, near-tangent
  contacts, simultaneous hits, scratches/fouls, legal/illegal targets, turn
  change, win state, and rack/reset.
- Run identical seeded shots twice and compare settled positions within the
  declared tolerance.
- Test low-frame-rate spikes without allowing variable render delta to change
  the shot outcome materially.

## Mini Golf

### Player Contract

- Give every hole one clear read, one central trick, and an intentional
  risk/reward choice or mastery line.
- Expose aim, force, stroke count, par/target, reset, and camera framing without
  obscuring the ball or near path.
- Make the first shot's likely result understandable from the tee.

### Course Contract

- Build a complete ordered set of holes or explicitly scoped course with
  introduction, escalation, combination, and finale.
- Add ramps, banks, moving blockers, split paths, timing windows, surface
  changes, or other mechanics one at a time before combining them.
- Keep out-of-bounds, reset/drop, hole completion, scorecard, next-hole, course
  completion, and replay states explicit.

### Systems And Verification

- Use the cue-sport fixed-step and collision discipline where applicable;
  synchronize moving obstacles from one simulation owner.
- Test minimum/maximum force, banks, ramps, moving contacts, edge rests,
  out-of-bounds, hole sensor entry, reset penalty, hole transition, final
  score, and course restart.
- Confirm every hole is completable through normal input and has no camera or
  collision dead zone.

## Boss Arena

### Player Contract

- Define the player's damage/defense loop, resource or cooldown pressure,
  movement options, punish window, healing/recovery, and failure/retry.
- Give every boss attack a readable tell, avoid/defend response, active hazard
  shape, impact, and recovery window.
- Preserve the boss, player, hazards, and safe space in camera composition.

### Phase Contract

- Build phases that add attacks, combinations, positioning pressure, or arena
  changes; do not rely only on more health or damage.
- Introduce attacks individually before combining them under pressure.
- Define transition invulnerability, animation/state ownership, checkpoints if
  any, victory, reward, and restart cleanup.
- Keep arena hazards and boss hitboxes simpler and more honest than visuals.

### Verification

- Trigger every attack and phase, dodge/defend correctly and incorrectly,
  exploit arena edges, collide during transitions, deplete resources, fail,
  retry, win, and restart.
- Check that VFX, shake, UI, and audio never hide the next telegraph.
- Measure the densest multi-attack phase and soak repeated restarts for stale
  timers, listeners, effects, and colliders.

## Spatial Or Physics Puzzle

### Player Contract

- State the rule taught by each puzzle: introduce, confirm, twist, combine, and
  test mastery.
- Make object affordances and state changes visible without requiring source
  knowledge or arbitrary guessing.
- Let failure reveal information and provide a fast, complete reset.

### Puzzle Contract

- Keep puzzle state serializable or reconstructable from a small authoritative
  model; visuals observe that model.
- Define legal interactions, order dependencies, move/attempt count if used,
  completion predicate, hint policy, undo/reset, progression, and final state.
- Use deterministic collision and timing where physical outcomes are part of
  the solution; avoid frame-rate-dependent answers.
- Prevent accidental solutions caused by camera clipping, pointer ray misses,
  unbounded object motion, or stale completion checks.

### Verification

- Solve through the intended path, test plausible wrong orders, spam input,
  drag/select at edges, resize during interaction, undo/reset every intermediate
  state, complete, advance, and replay.
- Verify keyboard/pointer/touch parity when supported and ensure selection cues
  identify the same authoritative object.
- Record the intended solution invariant in a test hook without embedding a
  bot-only shortcut in player-facing rules.

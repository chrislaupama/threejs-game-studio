# Genre Completion Playbooks

Use the matching section after `game-design.md` when building or substantially
upgrading one of these genres. Treat each playbook as a completeness and QA
contract, then tune counts to the requested scope and intended session length.
Do not copy mechanics that conflict with the player's stated fantasy.

## Contents

- Shared completion contract
- Collect-and-avoid arcade arena
- Endless runner and arcade racer
- Dogfight/space shooter and tower defense
- Cue sports and mini golf
- Boss arena and spatial/physics puzzle
- 3D platformer and first/third-person action
- Top-down action/survival and adventure/RPG
- RTS/strategy and rhythm

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

## Collect-And-Avoid Arcade Arena

Use this for a small third-person, top-down, or isometric game whose primary
verb is movement, whose objective is gathering a bounded set of items, and
whose pressure comes from hazards rather than combat.

### Player Contract

- Movement must feel useful immediately on keyboard and every supported touch
  path; both feed the same semantic action vector.
- The objective names the remaining collection count and the ending condition.
- Contact has a readable consequence such as health, time, score, knockback,
  lost cargo, or combo loss—never an unexplained reset.
- Invulnerability/recovery time, if used, has visible and audio state cues.
- Win and fail states stop rule progression, preserve a readable final frame,
  and offer a fast retry.

### Arena And Content Contract

- Teach steering and the first pickup in a safe opening region.
- Use at least three landmarks or material/shape regions so the player can
  orient without a minimap in a short session.
- For a complete small game, provide at least two threat roles, such as a
  chaser plus a sweeping/rotating zone, and arrange them into combinations
  rather than recolors.
- Place pickups to create route choices: exposed short route, safer long route,
  moving pickup, sequence, or temporary risk/reward cluster.
- Reserve recovery space. Never spawn a hazard on the player or make the last
  collectible unreachable behind an active collision state.
- Keep render detail separate from simple player, hazard, pickup, and camera
  collision proxies.

### Systems And Tuning

- Tune acceleration, braking, turn response, dash/cooldown, camera lag, hazard
  speed, telegraph duration, contact recovery, and session timer as named
  constants.
- Use a seeded placement/director plan and validate spawn distance, line of
  sight, overlap, and reachability before committing an item or threat.
- A third-person camera follows one semantic actor root. Resolve camera
  blockers with a simple boom ray/sweep, snap inward, and smooth outward.
- Difficulty should add route pressure or combine learned threats before it
  merely increases speed or count.
- Route `pickup-collected`, `player-hit`, `danger-near`, `objective-complete`,
  and `run-failed` events to bounded UI, audio, VFX, and camera feedback.

### Verification

- Reach a pickup and a threat through real keyboard and touch input.
- Complete the full collection path, fail by every intended rule, pause/resume,
  and retry repeatedly without duplicate actors, listeners, or timers.
- Run at least two seeded layouts and prove all pickups are reachable, hazards
  do not overlap the spawn, and the last-item state always resolves.
- Inspect camera occlusion, arena edges, simultaneous hazard contacts, low-FPS
  spikes, pointer cancel/blur, mobile safe areas, and reduced motion.
- Play the full short session from a clean production-preview load; a screenshot
  of an arena with pickups is not completion evidence.

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

## 3D Platformer

### Player Contract

- Define ground acceleration, air control, jump height/time-to-apex, coyote
  time, input buffering, fall speed, landing recovery and camera-relative input.
- Decide whether the game emphasizes precision, momentum, exploration, combat,
  collection, or traversal abilities. Tune all movement around that promise.
- Make ground state, ledge risk, jump destination and collectible route readable
  from the normal camera, not only a debug view.

### Level And Systems Contract

- Teach one movement verb in safety, confirm it under mild pressure, combine it
  with a known verb, then test it with a recovery route nearby.
- Use simple character collision (capsule or sphere pair), stable ground probes,
  slope rules, step height, moving-platform delta and deterministic respawn.
- Add checkpoints before long repetition. Define kill volume, out-of-bounds,
  collectible permanence, enemy reset and camera recovery.
- Keep visual ledges aligned with collision. Avoid invisible lips, sloped
  surfaces that look flat, and jumps whose landing is camera-occluded.

### Verification

- Test late jump, buffered jump, running off edges, slope boundaries, wall
  contact, moving platforms, maximum fall speed, checkpoint restore and rapid
  retry at low and high frame rates.
- Complete the route without debug camera help; confirm the next landing stays
  visible and the camera does not pass through walls.
- Record jump constants, hardest gap dimensions and ground-probe diagnostics.

## First-Person Or Third-Person Action

For third-person play, also load **Third-Person Action Rig Contract** in
`interaction.md`. Load `ai-navigation.md` when opponents use perception,
pursuit, pathfinding, cover selection, or crowds.

### Player Contract

- Define locomotion, aim model, camera sensitivity, field of view, target range,
  attack cadence, reload/cooldown, defense/evasion and damage recovery.
- Declare the default camera/aim mode and all supported transitions before
  tuning weapons and encounters. First-person, over-shoulder aim, free
  third-person traversal, and lock-on may coexist; keep one active camera/input
  owner per mode and define entry, exit, target-loss, and fallback behavior.
- Decide hitscan, projectile, melee volume or hybrid attacks. Communicate range,
  hit confirmation, ammo/resource and incoming threat direction.

### Third-Person Camera And Aim Contract

- Follow one semantic actor root, never an animated bone. Collision resolves
  the actor pose first; the rig consumes that accepted or interpolated pose.
- Define target/pivot height, yaw/pitch limits, default side and distance,
  shoulder swap, FOV, look sensitivity, recentering, and reduced-motion limits.
- Query from the semantic target to the desired camera pose, move inward
  immediately around blockers, and smooth outward only after clearance.
- Aim from the camera/reticle to establish intent, then validate the path from
  the muzzle or attack origin so near cover cannot be shot through. State how
  parallax, out-of-range points, and blocked muzzle paths are communicated.
- Keep recoil, shake, lean, and lock-on framing as bounded presentation offsets
  owned by the rig. They must not rewrite the actor's authoritative transform.

### Combat And Encounter Contract

- Give each enemy a role: pressure, flank, area denial, ranged control, support,
  tank, ambush or objective disruption. Combine roles deliberately.
- Use perception, line-of-sight, hearing/alert, attack telegraphs, navigation,
  recovery and disengage rules. Keep AI decisions at a lower frequency than
  movement/animation when possible.
- Define health/armor, invulnerability windows, damage types, stagger, defeat,
  drops and encounter completion in authoritative game state.
- Build encounters with cover/space, approach, escalation, resource decision,
  recovery and a clear completion signal. More health alone is not escalation.

### Verification

- Test every weapon/action at minimum/maximum range, missed shots, friendly or
  blocked targets, reload/cooldown edges, simultaneous damage, defeat, retry and
  encounter completion.
- Test enemies losing sight, path obstruction, player elevation, camera
  collision, lock-on target loss, off-screen threats and controller/touch aim if
  supported.
- Measure maximum projectiles, enemies, effects, skinned meshes and shadowed
  lights in the densest encounter.

## Top-Down Action Or Survival

### Player Contract

- Choose twin-stick aim, movement-direction attacks, click-to-move, auto-fire or
  ability targeting. Define how keyboard, pointer, touch and gamepad express the
  same actions.
- Define the short survival loop: move/aim/attack, avoid pressure, collect a
  resource, choose an upgrade, face a stronger combination, repeat or finish.
- Keep enemy silhouettes, attack areas, pickups and player position readable at
  the intended zoom. Effects must not bury hazards.

### Director And Progression Contract

- Use a seeded encounter director with explicit budget, spawn regions, minimum
  distance, on-screen/off-screen policy, enemy-role weights and cooldown.
- Increase challenge through combinations, movement constraints, elite rules,
  objectives and resource tension—not an unbounded spawn-rate multiplier.
- Define upgrade offers, stacking rules, caps, rarity, reroll/skips, synergy and
  save scope. Keep numerical rules independent from UI cards.
- Pool projectiles, damage numbers, particles and short-lived enemies. Clear all
  pools, timers and contacts on a new run.

### Verification

- Run at least two seeds and two control paths. Test spawn overlap, arena edges,
  pause during an upgrade choice, maximum projectile density, defeat/retry,
  victory/endless transition and deterministic offer generation.
- Confirm an upgrade changes strategy or feel, not only a hidden percentage.
- Capture renderer, entity, pool and collision counts at the densest minute.

## Adventure Or RPG

### Player Contract

- Define exploration, conversation, quest/objective, interaction, combat or
  puzzle verbs and which one forms the repeated core loop.
- Give every interactable a visible affordance, range rule, prompt, state change
  and persistence decision. Avoid context buttons whose action is unpredictable.
- Decide whether progression is equipment, abilities, relationships, world
  state, knowledge, stats or authored story beats.

### World, Quest And Persistence Contract

- Model quests as explicit states and predicates, not UI text: unavailable,
  available, active, step states, complete, failed and rewarded as applicable.
- Store stable IDs and serializable data; never serialize Object3D instances,
  functions, GPU resources or live animation actions.
- Version save data and validate it before use. Keep a default/new-game path for
  missing, malformed or older data.
- Stream or activate world chunks by authored regions when scale demands it.
  Preserve quest entities, navigation links, audio and teardown ownership.
- Ensure dialogue choices, inventory/equipment and quest rewards update the
  same canonical model observed by UI and world visuals.

### Verification

- Test objectives in order and plausible wrong orders, repeated interaction,
  save/load in each important state, missing/corrupt save fallback, version
  migration, death/retry, scene/chunk re-entry and final completion.
- Confirm loaded state reconstructs visuals, colliders, clips, UI, audio and
  navigation without duplicated rewards or listeners.
- Report save schema version, storage scope and data deliberately excluded.

## RTS Or Strategy

### Player Contract

- Define selection, command, camera pan/zoom/rotate, build/place, production,
  resource, combat and objective actions. Provide keyboard modifiers and touch
  equivalents only when they can be made unambiguous.
- Keep selection ownership stable: click, box select, groups, deselect, command
  targeting and feedback must reference unit IDs, not transient meshes.
- Communicate command acceptance, path blockage, range, cooldown, production
  queue, resources and objective state without hiding the battlefield.

### Simulation Contract

- Use a fixed or deterministic-enough simulation model with stable entity IDs,
  command queues and seeded decisions. Separate simulation state from render
  interpolation and selection visuals.
- Choose navigation representation: authored waypoints, grid A*, flow field,
  lane graph or local steering. Bound path requests per frame and cache or
  invalidate routes deliberately.
- Use broadphase spatial queries, instanced/batched visuals and lower-frequency
  AI decisions. Avoid an independent raycast and full path search per unit per
  frame.
- Define victory/defeat, economy cadence, fog/visibility if used, reinforcement,
  production and teardown/restart semantics.

### Verification

- Test single/multi/box selection, command spam, unreachable targets, formation
  crowding, construction validation, resource limits, queue cancellation,
  destruction, victory/defeat and restart.
- Run the target maximum unit count with movement, combat, UI and camera motion.
  Report draw calls, visible/active units, path queue, query counts and frame
  time rather than only idle FPS.

## Rhythm

### Player Contract

- Define input lanes/actions, hit windows, scoring grades, combo, health/fail,
  calibration and visual anticipation. State whether the experience follows
  authored chart time, procedural events or reactive music.
- Treat the audio timeline as authoritative. Render visuals ahead of the hit
  time using scheduled event timestamps; do not advance chart time by counting
  animation frames.
- Support keyboard/gamepad/touch mappings with per-device calibration when the
  target experience requires precision.

### Timing And Content Contract

- Unlock and resume the audio context from a gesture before starting. Schedule
  audio and notes from `AudioContext.currentTime` with an explicit look-ahead.
- Store chart events as data: time, action/lane, duration, type and metadata.
  Keep judgement, scoring and effects separate from rendering.
- Define early/late windows, hold behavior, simultaneous notes, pause/resume,
  restart, seek policy and what happens after visibility loss.
- Provide calibration UX and record offset without changing the source chart.
  Visual latency compensation and input latency compensation are distinct.

### Verification

- Test exact/early/late/miss boundaries, chords, holds, rapid repeats, pause,
  visibility loss, audio-device resume, retry, completion and calibration.
- Compare judgement results across 60/120 Hz rendering and deliberate frame
  drops. Render rate must not change scoring.
- Report audio time, chart time, user offset, scheduled horizon and missed-frame
  recovery behavior in diagnostics.

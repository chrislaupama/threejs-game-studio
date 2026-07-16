# Local Web Audio For Games

## Contents

- Ownership and audio event matrix
- Bus graph, gesture unlock, and procedural cues
- Deterministic variation, spatial audio, and mixing
- Pause/restart/disposal and verification

Use this reference when implementing SFX, UI sounds, ambience, music playback,
spatial sound, mute/volume, or audio-related game feel. Use only browser Web
Audio and project-local files.

## Ownership

Create one audio system that owns:

- `AudioContext` creation and gesture unlock.
- Master, music/ambience, SFX, and UI gain buses.
- Voice limits and cleanup.
- Pause/resume, mute, volume, and visibility behavior.
- Local buffer loading and decode errors.
- Procedural oscillator/noise synthesis.

Gameplay emits semantic events such as `pickup`, `hit`, `boost`, `fail`, and
`menuConfirm`. The audio system translates events into sound. Never play a sound
directly from every entity's update loop.

## Audio Event Matrix

Plan coverage before authoring cues. Use procedural Web Audio or a
project-owned/user-supplied local file for every row; never leave a remote or
provider placeholder in the matrix.

| Event family | Local cue direction | Loop | Bus | Spatial | Voice/cooldown | Visual fallback |
| --- | --- | --- | --- | --- | --- | --- |
| Primary verb/movement | transient plus short tonal/noise body | no | sfx | when world-located | cap rapid repeats | motion/state response |
| Reward/interaction | distinct bright or rising confirmation | no | sfx | optional | small variant pool | pickup pulse/counter |
| Damage/threat | sharp attack plus low weight, scaled by severity | no | sfx | usually | priority + cooldown | flash/shape/camera cue |
| Failure/victory | unmistakable state-transition phrase | no | sfx | no | interrupt lower-priority cues | modal/world state |
| UI confirm/cancel | short contrasting intervals/clicks | no | ui | no | one per action | pressed/focus state |
| Ambience/machinery | quiet filtered noise/tones or local loop | yes | music/ambience | optional | one owned loop per layer | environment motion |

For broad game work, cover at least the primary verb, reward/progression,
damage or setback, failure/victory, UI confirm/cancel, and one ambience or world
motion layer when it benefits the design. A tiny complete cue set tied to real
events is better than many unattached files. Record trigger owner, bus, maximum
simultaneous voices, cooldown/variant rule, and equivalent visual information
for every critical cue.

## Minimal Bus Graph

```ts
const context = new AudioContext();
const master = context.createGain();
const music = context.createGain();
const sfx = context.createGain();
const ui = context.createGain();

music.connect(master);
sfx.connect(master);
ui.connect(master);
master.connect(context.destination);
```

Persist user volume preferences locally only when the project already has a
settings policy. Never send audio or settings to an external service.

## Gesture Unlock

Create/resume the context from the first relevant `pointerdown` or `keydown`.
Make unlock idempotent. If unlock or decode fails, keep the game playable and
surface a useful local error state rather than retrying against a remote source.

## Procedural SFX

Build compact effects from oscillators, noise buffers, filters, envelopes, and
pitch ramps:

- Pickup: short triangle/sine upward chirp plus light noise tick.
- Hit: low oscillator drop, band-passed noise burst, fast gain envelope.
- Boost: filtered noise or saw layer with pitch/filter rise and fall.
- UI confirm: short sine/triangle interval; cancel uses a lower interval.
- Failure: descending pitch with longer release; keep it distinct from damage.
- Ambience: quiet filtered noise or several slow oscillators with bounded gain.

Schedule with `context.currentTime`; never create or connect nodes every render
frame. Stop sources after their envelope and disconnect long-lived custom
graphs during disposal.

## Repetition And Determinism

Repeated sounds need slight pitch, timing, or gain variance. Route variation
through the game's seeded RNG so tests remain reproducible. Keep ranges subtle
and preserve semantic identity.

## Spatial Audio

Use `PannerNode`, `THREE.PositionalAudio`, or a small project wrapper only when
direction materially helps play. Update listener and source positions from the
same authoritative transforms as rendering. Do not spatialize UI or global
status cues.

## Mixing Rules

- Reserve headroom; several simultaneous voices must not clip.
- Duck ambience/music briefly for important hits or failure.
- Cap repeated voices by category; replace or steal the quietest/oldest voice.
- Pause or fade loops on pause and page visibility changes.
- Restart must not duplicate ambience, timers, or queued voices.
- Mute must affect every bus and survive scene changes.
- Provide visual equivalents for critical audio-only information.

## Verification

- First gesture unlocks audio without a console error.
- Core actions trigger once per event, not once per frame.
- Pause/resume and page visibility do not stack loops.
- Restart removes stale sources and restores intended ambience once.
- Mute and every exposed volume group work.
- Repeated cues vary without becoming inconsistent.
- Local files resolve under production `base` paths and decode visibly on error.
- No audio request targets a remote origin.

# Local Web Audio For Games

## Contents

- Ownership and audio event matrix
- Bus graph, gesture unlock, and procedural cues
- Deterministic variation, spatial audio, and mixing
- Local-buffer playback, voice ownership, and Three.js positional audio
- Pause/restart/disposal and verification

Use this reference when implementing SFX, UI sounds, ambience, music playback,
spatial sound, mute/volume, or audio-related game feel. Use only browser Web
Audio and project-local files.

Asset-loading examples use the project-owned `publicAssetUrl()` helper from
`local-assets.md`; import it from the local asset boundary in real code.

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

```ts
async function unlockAudio(context: AudioContext): Promise<boolean> {
  if (context.state === 'running') return true;
  try {
    await context.resume();
    return context.state === 'running';
  } catch (error) {
    console.warn('Audio could not be unlocked.', error);
    return false;
  }
}
```

Register the gesture handler once, remove it after success, and keep a visible
mute/sound setting. Never start a game timer only after an audio promise
resolves; audio failure must degrade silently or through a non-blocking status.

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

Three.js provides one listener, non-positional `Audio`, `PositionalAudio`, and
`AudioLoader`. Attach the listener to the active camera and an emitter to its
world object:

```ts
import * as THREE from 'three';

const listener = new THREE.AudioListener();
camera.add(listener);

const loader = new THREE.AudioLoader(loadingManager);
const engineBuffer = await loader.loadAsync(
  publicAssetUrl('audio/engine-loop.ogg'),
);

const engine = new THREE.PositionalAudio(listener);
engine.setBuffer(engineBuffer);
engine.setLoop(true);
engine.setVolume(0.35);
engine.setDistanceModel('inverse');
engine.setRefDistance(3);
engine.setMaxDistance(45);
engine.setRolloffFactor(1.2);
vehicle.add(engine);

// Call after a gesture has resumed listener.context.
engine.play();
```

Use one `AudioListener` for the active listening view. When cameras switch,
move the listener or reparent it deliberately; do not leave one listener on
each camera. Configure directional emitters only when orientation is meaningful:

```ts
engine.setDirectionalCone(70, 150, 0.15);
```

The angles are degrees. Visualize or audition the cone while tuning. Keep UI,
music and narrator/state cues non-positional.

Official API: [Audio](https://threejs.org/docs/pages/Audio.html),
[AudioListener](https://threejs.org/docs/pages/AudioListener.html),
[PositionalAudio](https://threejs.org/docs/pages/PositionalAudio.html), and
[AudioLoader](https://threejs.org/docs/pages/AudioLoader.html).

## Local Buffer Cache

Decode a local file once and share its `AudioBuffer`. Keep loading in the asset
system, not inside an impact callback:

```ts
class AudioBufferCache {
  private readonly loader: THREE.AudioLoader;
  private readonly buffers = new Map<string, Promise<AudioBuffer>>();

  constructor(manager: THREE.LoadingManager) {
    this.loader = new THREE.AudioLoader(manager);
  }

  load(url: string): Promise<AudioBuffer> {
    const existing = this.buffers.get(url);
    if (existing) return existing;
    const request = this.loader.loadAsync(url).catch((error) => {
      this.buffers.delete(url); // allow an explicit retry
      throw error;
    });
    this.buffers.set(url, request);
    return request;
  }

  clear(): void {
    this.buffers.clear();
  }
}
```

Audio buffers are CPU memory. Clearing references allows garbage collection;
playing sources still need explicit stop/disconnect ownership. Show loading or
failure when a cue is required for the experience, but keep gameplay usable.

## Bounded Voice Playback

For short non-positional SFX, create a source per playback, but cap active
voices and disconnect each graph when it ends:

```ts
type Voice = {
  source: AudioBufferSourceNode;
  gain: GainNode;
  startedAt: number;
};

class VoicePool {
  private readonly active: Voice[] = [];

  constructor(
    private readonly context: AudioContext,
    private readonly output: AudioNode,
    private readonly maximum = 16,
  ) {}

  play(buffer: AudioBuffer, volume: number, playbackRate: number): void {
    if (this.context.state !== 'running') return;
    while (this.active.length >= this.maximum) this.stop(this.active[0]);

    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
    gain.gain.value = volume;
    source.connect(gain).connect(this.output);

    const voice = { source, gain, startedAt: this.context.currentTime };
    this.active.push(voice);
    source.addEventListener('ended', () => this.release(voice), { once: true });
    source.start();
  }

  dispose(): void {
    for (const voice of [...this.active]) this.stop(voice);
  }

  private stop(voice: Voice): void {
    try { voice.source.stop(); } catch { /* already stopped */ }
    this.release(voice);
  }

  private release(voice: Voice): void {
    const index = this.active.indexOf(voice);
    if (index >= 0) this.active.splice(index, 1);
    voice.source.disconnect();
    voice.gain.disconnect();
  }
}
```

Choose stealing by category and priority in a production game: a critical fail
cue should replace an old footstep, not the reverse. Add per-event cooldowns so
collision jitter does not create a wall of duplicate sounds.

## Pause, Restart And Disposal

Define the distinction:

- **mute:** keep timelines running, set master gain toward zero
- **pause:** suspend or pause game-owned sources and resume consistently
- **restart:** stop transient/looping run voices, reset music/ambience by design
- **scene exit:** detach positional emitters and release scene-owned sources
- **application dispose:** stop all voices, disconnect buses/listeners, remove
  gesture/visibility handlers, clear caches, and close the owned context

Use short gain ramps to prevent clicks:

```ts
function rampGain(node: GainNode, value: number, context: AudioContext): void {
  const now = context.currentTime;
  node.gain.cancelScheduledValues(now);
  node.gain.setValueAtTime(node.gain.value, now);
  node.gain.linearRampToValueAtTime(value, now + 0.02);
}
```

Do not close a shared audio context when only one scene exits. Ownership must be
explicit, especially under hot reload.

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
- One listener follows the active camera; positional falloff and cones are
  audible from intended gameplay distances.
- Voice caps, collision spam, repeated restart and scene re-entry do not leak or
  duplicate sources.

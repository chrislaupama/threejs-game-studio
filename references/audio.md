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

Own the native context and Three.js's global audio context as one object. Create
the graph synchronously inside the first relevant user gesture, and call
`THREE.AudioContext.setContext()` **before** constructing an `AudioListener`,
loading with `AudioLoader`, or constructing any Three.js audio object. Replacing
the global context while audio objects are alive leaves nodes split across
incompatible graphs.

```ts
import * as THREE from 'three';

type AudioGraph = {
  context: AudioContext;
  master: GainNode;
  music: GainNode;
  sfx: GainNode;
  ui: GainNode;
  listener: THREE.AudioListener;
};

let audioGraph: AudioGraph | null = null;

function createAudioGraph(camera: THREE.Camera): AudioGraph {
  const context = new AudioContext();

  // This must happen before AudioListener, AudioLoader.load(), Audio, or
  // PositionalAudio causes Three.js to request its global context.
  THREE.AudioContext.setContext(context);

  const master = context.createGain();
  const music = context.createGain();
  const sfx = context.createGain();
  const ui = context.createGain();

  music.connect(master);
  sfx.connect(master);
  ui.connect(master);
  master.connect(context.destination);

  const listener = new THREE.AudioListener();

  // AudioListener connects directly to context.destination by default.
  // Reroute all THREE.Audio and THREE.PositionalAudio through the SFX bus.
  const threeInput = listener.getInput();
  threeInput.disconnect();
  threeInput.connect(sfx);
  camera.add(listener);

  return { context, master, music, sfx, ui, listener };
}

async function ensureAudio(camera: THREE.Camera): Promise<AudioGraph | null> {
  try {
    if (audioGraph === null) audioGraph = createAudioGraph(camera);
    if (audioGraph.context.state !== 'running') {
      await audioGraph.context.resume();
    }
    return audioGraph.context.state === 'running' ? audioGraph : null;
  } catch (error) {
    console.warn('Audio could not be created or unlocked.', error);
    return null;
  }
}
```

Send native one-shot sources to `sfx` or `ui`, and music/ambience sources to
`music`. Three.js audio objects share the listener input and therefore use the
`sfx` bus in this graph. Keep `listener` volume at `1` and use the project buses
for settings so `master` always mutes every route. After rerouting the listener,
put filters on project buses rather than calling `AudioListener.setFilter()` or
`removeFilter()`, whose built-in routing owns a listener-to-destination path.

Persist user volume preferences locally only when the project already has a
settings policy. Never send audio or settings to an external service.

## Gesture Unlock

Construct/resume the graph from the first relevant `pointerdown` or `keydown`.
Make unlock idempotent. If unlock or decode fails, keep the game playable and
surface a useful local error state rather than retrying against a remote source.

```ts
function installAudioUnlock(
  camera: THREE.Camera,
  onReady: (graph: AudioGraph) => void,
): () => void {
  let disposed = false;
  let ready = false;

  const remove = () => {
    window.removeEventListener('pointerdown', attempt);
    window.removeEventListener('keydown', attempt);
  };

  const attempt = async () => {
    if (disposed || ready) return;
    const graph = await ensureAudio(camera);
    if (disposed || ready || graph === null) return;
    ready = true;
    remove();
    onReady(graph);
  };

  window.addEventListener('pointerdown', attempt, { passive: true });
  window.addEventListener('keydown', attempt);

  return () => {
    disposed = true;
    remove();
  };
}
```

Keep the returned cleanup and call it if the application is disposed before
unlock succeeds. Keep a visible mute/sound setting. Never start a game timer
only after an audio promise resolves; audio failure must degrade silently or
through a non-blocking status.

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
`AudioLoader`. Reuse the listener owned by the unlocked graph and attach an
emitter to its world object. Creating an independent listener here would bypass
the project's bus ownership:

```ts
import * as THREE from 'three';

const audio = await ensureAudio(camera);
if (audio === null) throw new Error('Audio is unavailable.');

const loader = new THREE.AudioLoader(loadingManager);
const engineBuffer = await loader.loadAsync(
  publicAssetUrl('audio/engine-loop.ogg'),
);

const engine = new THREE.PositionalAudio(audio.listener);
engine.setBuffer(engineBuffer);
engine.setLoop(true);
engine.setVolume(0.35);
engine.setDistanceModel('inverse');
engine.setRefDistance(3);
engine.setRolloffFactor(1.2);
vehicle.add(engine);

// ensureAudio() has resumed this exact context from a user gesture.
engine.play();
```

With the `inverse` and `exponential` models, `maxDistance` is not a hard cutoff;
`setMaxDistance()` only affects the `linear` model. Stop or virtualize inaudible
loops by measured distance if they should consume no active voice beyond a
game-specific range.

Use one `AudioListener` for the active listening view. When cameras switch,
move the listener or reparent it deliberately; do not leave one listener on
each camera. Configure directional emitters only when orientation is meaningful:

```ts
engine.setDirectionalCone(70, 150, 0.15);
```

The angles are degrees, and a `PositionalAudio` emitter points along its local
positive Z axis. Visualize and audition the cone while tuning:

```ts
import {
  PositionalAudioHelper,
} from 'three/addons/helpers/PositionalAudioHelper.js';

const coneHelper = new PositionalAudioHelper(engine, 8);
engine.add(coneHelper);

// After changing the cone while the helper is visible:
engine.setDirectionalCone(60, 140, 0.1);
coneHelper.update();

// Debug teardown:
coneHelper.removeFromParent();
coneHelper.dispose();
```

The helper shows cone orientation and angles, not the audible distance falloff.
Keep it debug-only. Keep UI, music and narrator/state cues non-positional.

Official API: [Audio](https://threejs.org/docs/pages/Audio.html),
[AudioContext](https://threejs.org/docs/pages/AudioContext.html),
[AudioListener](https://threejs.org/docs/pages/AudioListener.html),
[PositionalAudio](https://threejs.org/docs/pages/PositionalAudio.html), and
[AudioLoader](https://threejs.org/docs/pages/AudioLoader.html). Addon API:
[PositionalAudioHelper](https://threejs.org/docs/pages/PositionalAudioHelper.html).

## Local Buffer Cache

Decode a local file once and share its `AudioBuffer`. Keep loading in the asset
system, not inside an impact callback. Construct/use this cache only after
`ensureAudio()` has installed the owned context; `AudioLoader` decodes through
`THREE.AudioContext.getContext()`:

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
  released: boolean;
};

class VoicePool {
  private readonly active: Voice[] = [];

  constructor(
    private readonly context: AudioContext,
    private readonly output: AudioNode,
    private readonly maximum = 16,
  ) {
    if (!Number.isInteger(maximum) || maximum < 1) {
      throw new RangeError('VoicePool maximum must be a positive integer.');
    }
    if (output.context !== context) {
      throw new Error('VoicePool output must belong to the owned context.');
    }
  }

  play(buffer: AudioBuffer, volume: number, playbackRate: number): void {
    if (this.context.state !== 'running') return;
    while (this.active.length >= this.maximum) this.stop(this.active[0]);

    const source = this.context.createBufferSource();
    const gain = this.context.createGain();
    source.buffer = buffer;
    source.playbackRate.value = playbackRate;
    gain.gain.value = volume;
    source.connect(gain).connect(this.output);

    const voice: Voice = {
      source,
      gain,
      startedAt: this.context.currentTime,
      released: false,
    };
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
    // stop() releases synchronously, then the source can still dispatch ended.
    if (voice.released) return;
    voice.released = true;

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

`THREE.Audio` and `THREE.PositionalAudio` do not have a `dispose()` method.
For buffer-backed sounds, stop playback, disconnect the current source graph,
disconnect the object's persistent gain from the listener, and detach it:

```ts
function releaseThreeAudio(sound: THREE.Audio): void {
  if (sound.isPlaying) sound.stop();
  sound.disconnect();
  sound.gain.disconnect();
  sound.removeFromParent();
}

async function disposeAudioGraph(graph: AudioGraph): Promise<void> {
  graph.listener.removeFromParent();
  graph.listener.getInput().disconnect();
  graph.music.disconnect();
  graph.sfx.disconnect();
  graph.ui.disconnect();
  graph.master.disconnect();

  if (graph.context.state !== 'closed') await graph.context.close();
  if (audioGraph === graph) audioGraph = null;
}
```

Dispose every Three.js sound and native voice pool before disposing the graph.
Media-element and media-stream sources also require their owner to pause the
element or stop stream tracks. Call the gesture-handler cleanup, dispose debug
helpers, clear buffer caches, then close the context. Three.js still holds the
closed global context after shutdown, so any later full audio-system restart
must call `THREE.AudioContext.setContext(newContext)` before creating or loading
new Three.js audio, as `createAudioGraph()` does above.

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
- Master mute affects native/procedural voices and every Three.js audio object;
  all nodes belong to the same `AudioContext`.
- Repeated cues vary without becoming inconsistent.
- Local files resolve under production `base` paths and decode visibly on error.
- No audio request targets a remote origin.
- One listener follows the active camera; positional falloff and cones are
  audible from intended gameplay distances.
- Voice caps, collision spam, repeated restart and scene re-entry do not leak or
  duplicate sources.

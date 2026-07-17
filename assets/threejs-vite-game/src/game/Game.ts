import * as THREE from 'three';
import { InputController } from '../core/InputController';
import { Loop } from '../core/Loop';
import { createRenderer, resizeRenderer } from '../core/Renderer';
import { Hazard } from '../entities/Hazard';
import { Pickup } from '../entities/Pickup';
import { Player, type ArenaBounds } from '../entities/Player';
import { AudioSystem } from '../systems/AudioSystem';
import { CameraRig } from '../systems/CameraRig';
import { CollisionSystem } from '../systems/CollisionSystem';
import { DebugTools, type DebugTuning } from '../systems/DebugTools';
import { Hud, type GameState } from '../systems/Hud';
import { disposeObject3D } from '../utils/dispose';
import { createSeededRandom } from '../utils/random';

const ARENA: ArenaBounds = { halfWidth: 11, halfDepth: 7 };
const TIME_LIMIT_SECONDS = 42;
const PLAYER_RADIUS = 0.55;
const ENABLE_GAME_DIAGNOSTICS =
  import.meta.env.DEV ||
  import.meta.env.VITE_ENABLE_GAME_DIAGNOSTICS === 'true';

function getToneMappingName(toneMapping: THREE.ToneMapping): string {
  switch (toneMapping) {
    case THREE.NoToneMapping:
      return 'NoToneMapping';
    case THREE.LinearToneMapping:
      return 'LinearToneMapping';
    case THREE.ReinhardToneMapping:
      return 'ReinhardToneMapping';
    case THREE.CineonToneMapping:
      return 'CineonToneMapping';
    case THREE.ACESFilmicToneMapping:
      return 'ACESFilmicToneMapping';
    case THREE.CustomToneMapping:
      return 'CustomToneMapping';
    case THREE.AgXToneMapping:
      return 'AgXToneMapping';
    case THREE.NeutralToneMapping:
      return 'NeutralToneMapping';
  }
}

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(48, 1, 0.1, 80);
  private readonly input: InputController;
  private readonly player = new Player();
  private readonly pickups: Pickup[] = [];
  private readonly hazards: Hazard[] = [];
  private readonly collision = new CollisionSystem();
  private readonly audio = new AudioSystem();
  private readonly hud = new Hud();
  private readonly cameraRig = new CameraRig(this.camera);
  private readonly loop: Loop;
  private readonly tuning: DebugTuning = {
    speed: 5.8,
    dashMultiplier: 1.75,
    acceleration: 13,
    cameraLag: 0.16,
    exposure: 1.05,
    maxDpr: 1.5,
  };
  private readonly debugTools: DebugTools | null;
  private readonly sun = new THREE.DirectionalLight('#fff1bf', 2.6);
  private readonly arena: THREE.Group;
  private readonly rendererStatus = document.createElement('section');

  private frame = 0;
  private score = 0;
  private elapsed = 0;
  private state: GameState = 'playing';
  private rng = createSeededRandom(1);
  private pausedForScreenshot = false;
  private reducedMotion = false;
  private contextLost = false;
  private resumeAfterContextRestore = false;
  private readonly publishDiagnostics: (() => void) | null;

  private readonly onContextLost = (event: Event) => {
    event.preventDefault();
    if (this.contextLost) return;
    this.contextLost = true;
    this.resumeAfterContextRestore = this.loop.isRunning;
    this.loop.stop();
    this.input.suspend();
    void this.audio.suspend();
    this.holdPresentation();
    this.rendererStatus.hidden = false;
    this.rendererStatus.textContent =
      'The graphics context was lost. Rendering is paused while recovery is attempted.';
  };

  private readonly onContextRestored = () => {
    if (!this.contextLost) return;
    this.contextLost = false;
    this.rendererStatus.hidden = true;
    this.rendererStatus.textContent = '';
    this.holdPresentation();
    if (this.resumeAfterContextRestore) this.loop.start();
    this.resumeAfterContextRestore = false;
    void this.audio.resume().catch(() => {
      // A browser may require another player gesture before audio can resume.
    });
  };

  constructor(private readonly canvas: HTMLCanvasElement) {
    this.renderer = createRenderer(canvas);
    this.loop = new Loop(
      this.renderer,
      (delta) => this.update(delta),
      (alpha) => this.render(alpha),
    );
    this.rendererStatus.className = 'renderer-status';
    this.rendererStatus.hidden = true;
    this.rendererStatus.setAttribute('role', 'alert');
    this.rendererStatus.setAttribute('aria-live', 'assertive');
    this.renderer.toneMappingExposure = this.tuning.exposure;

    this.input = new InputController(
      this.getElement('#touch-stick'),
      this.getElement('#touch-knob'),
      this.getElement('#dash-button'),
      this.getElement<HTMLButtonElement>('#pause-button'),
      this.getElement<HTMLButtonElement>('#retry-button'),
    );
    this.audio.bindMuteButton(this.getElement<HTMLButtonElement>('#mute-button'));
    this.debugTools = ENABLE_GAME_DIAGNOSTICS
      ? new DebugTools(this.tuning, () => {
          this.renderer.toneMappingExposure = this.tuning.exposure;
          resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);
        })
      : null;

    this.arena = this.createScene();
    this.resetRun();
    resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);
    if (ENABLE_GAME_DIAGNOSTICS) {
      const initialInfo = this.renderer.info;
      const dpr = this.renderer.getPixelRatio();
      const diagnostics: ThreeGameDiagnostics = {
        frame: this.frame,
        elapsed: this.elapsed,
        timeRemaining: Math.max(0, TIME_LIMIT_SECONDS - this.elapsed),
        state: this.state,
        score: this.score,
        targetScore: this.pickups.length,
        complete: this.state === 'won',
        hazards: this.hazards.length,
        player: {
          position: {
            x: this.player.group.position.x,
            y: this.player.group.position.y,
            z: this.player.group.position.z,
          },
          speed: this.player.velocity.length(),
        },
        renderer: {
          revision: THREE.REVISION,
          type: 'WebGLRenderer',
          backend: 'webgl',
          toneMapping: getToneMappingName(this.renderer.toneMapping),
          toneMappingExposure: this.renderer.toneMappingExposure,
          calls: initialInfo.render.calls,
          triangles: initialInfo.render.triangles,
          geometries: initialInfo.memory.geometries,
          textures: initialInfo.memory.textures,
          dpr,
        },
        camera: {
          aspect: this.camera.aspect,
        },
        canvas: {
          clientWidth: this.canvas.clientWidth,
          clientHeight: this.canvas.clientHeight,
          width: this.canvas.width,
          height: this.canvas.height,
          dpr,
        },
      };
      window.__THREE_GAME_DIAGNOSTICS__ = diagnostics;

      this.publishDiagnostics = () => {
        // WebGLRenderer replaces `renderer.info` after context restoration;
        // resolve it per frame instead of retaining a stale pre-loss object.
        const info = this.renderer.info;
        const currentDpr = this.renderer.getPixelRatio();
        diagnostics.frame = this.frame;
        diagnostics.elapsed = this.elapsed;
        diagnostics.timeRemaining = Math.max(0, TIME_LIMIT_SECONDS - this.elapsed);
        diagnostics.state = this.state;
        diagnostics.score = this.score;
        diagnostics.targetScore = this.pickups.length;
        diagnostics.complete = this.state === 'won';
        diagnostics.hazards = this.hazards.length;
        diagnostics.player.position.x = this.player.group.position.x;
        diagnostics.player.position.y = this.player.group.position.y;
        diagnostics.player.position.z = this.player.group.position.z;
        diagnostics.player.speed = this.player.velocity.length();
        diagnostics.renderer.toneMapping = getToneMappingName(this.renderer.toneMapping);
        diagnostics.renderer.toneMappingExposure = this.renderer.toneMappingExposure;
        diagnostics.renderer.calls = info.render.calls;
        diagnostics.renderer.triangles = info.render.triangles;
        diagnostics.renderer.geometries = info.memory.geometries;
        diagnostics.renderer.textures = info.memory.textures;
        diagnostics.renderer.dpr = currentDpr;
        diagnostics.camera.aspect = this.camera.aspect;
        diagnostics.canvas.clientWidth = this.canvas.clientWidth;
        diagnostics.canvas.clientHeight = this.canvas.clientHeight;
        diagnostics.canvas.width = this.canvas.width;
        diagnostics.canvas.height = this.canvas.height;
        diagnostics.canvas.dpr = currentDpr;
      };

      window.__THREE_GAME_TEST_HOOKS__ = {
        seed: (value: number) => {
          this.rng = createSeededRandom(value);
          return true;
        },
        setState: (name: string) => {
          if (name === 'active-play') this.resetRun();
          else if (name === 'complete') {
            this.resetRun();
            for (const pickup of this.pickups) pickup.collect();
            this.score = this.pickups.length;
            this.state = 'won';
            this.syncHud();
          } else if (name === 'failed') {
            this.resetRun();
            this.elapsed = TIME_LIMIT_SECONDS;
            this.state = 'lost';
            this.syncHud();
          } else if (name === 'paused') {
            this.resetRun();
            this.state = 'paused';
            this.syncHud();
          } else {
            console.warn(`Unknown test state: ${name}`);
            return false;
          }
          return true;
        },
        setPausedForScreenshot: (paused: boolean) => {
          this.pausedForScreenshot = paused;
          if (paused) this.holdPresentation();
        },
        setReducedMotion: (enabled: boolean) => {
          this.reducedMotion = enabled;
        },
        hideDebugUi: (hidden: boolean) => {
          this.debugTools?.setHidden(hidden);
        },
      };
    } else {
      this.publishDiagnostics = null;
    }
    document.querySelector('#app')?.append(this.rendererStatus);
    canvas.addEventListener('webglcontextlost', this.onContextLost);
    canvas.addEventListener('webglcontextrestored', this.onContextRestored);
  }

  start(): void {
    if (!this.contextLost) this.loop.start();
  }

  dispose(): void {
    this.canvas.removeEventListener('webglcontextlost', this.onContextLost);
    this.canvas.removeEventListener('webglcontextrestored', this.onContextRestored);
    this.rendererStatus.remove();
    this.loop.dispose();
    this.input.dispose();
    this.audio.dispose();
    this.debugTools?.dispose();
    for (const hazard of this.hazards) hazard.dispose();
    for (const pickup of this.pickups) pickup.dispose();
    this.player.dispose();
    disposeObject3D(this.arena);
    this.sun.dispose();
    this.renderer.dispose();
    if (ENABLE_GAME_DIAGNOSTICS) {
      delete window.__THREE_GAME_DIAGNOSTICS__;
      delete window.__THREE_GAME_TEST_HOOKS__;
    }
  }

  private update(delta: number): boolean {
    this.frame += 1;

    if (this.pausedForScreenshot) {
      this.holdPresentation();
      return false;
    }

    if (this.input.consumeRestartPressed()) {
      this.resetRun();
      return true;
    }
    if (this.input.consumePausePressed() && (this.state === 'playing' || this.state === 'paused')) {
      this.state = this.state === 'paused' ? 'playing' : 'paused';
    }

    if (this.state !== 'playing') {
      this.hud.update(this.score, this.pickups.length, this.elapsed, TIME_LIMIT_SECONDS, this.state);
      this.holdPresentation();
      return false;
    }

    this.elapsed += delta;
    const animationDelta = this.reducedMotion ? 0 : delta;
    const animationTime = this.reducedMotion ? 0 : this.elapsed;
    this.player.update(delta, animationTime, this.input, this.tuning, ARENA);
    for (const pickup of this.pickups) pickup.update(animationDelta, animationTime);
    for (const hazard of this.hazards) hazard.update(animationDelta, animationTime);

    for (const pickup of this.collision.collectPickups(this.player.group.position, this.pickups, PLAYER_RADIUS)) {
      this.score += 1;
      this.audio.pickup(pickup.index);
      this.hud.flashPickup();
    }

    if (this.score >= this.pickups.length) {
      this.state = 'won';
      this.audio.win();
    } else if (
      this.elapsed >= TIME_LIMIT_SECONDS ||
      this.collision.touchesHazard(this.player.group.position, this.hazards, PLAYER_RADIUS)
    ) {
      this.state = 'lost';
      this.audio.fail();
    }

    this.cameraRig.update(delta, this.player.group.position, this.tuning.cameraLag);
    this.hud.update(this.score, this.pickups.length, this.elapsed, TIME_LIMIT_SECONDS, this.state);
    return false;
  }

  private render(alpha: number): void {
    this.player.present(alpha);
    for (const pickup of this.pickups) pickup.present(alpha);
    for (const hazard of this.hazards) hazard.present(alpha);
    this.cameraRig.present(alpha);
    resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);
    this.renderer.render(this.scene, this.camera);
    if (ENABLE_GAME_DIAGNOSTICS) this.publishDiagnostics?.();
  }

  private createScene(): THREE.Group {
    this.scene.background = new THREE.Color('#151713');
    this.scene.fog = new THREE.Fog('#151713', 20, 44);

    const hemisphere = new THREE.HemisphereLight('#f6f1df', '#2b322d', 1.7);
    this.scene.add(hemisphere);

    const sun = this.sun;
    sun.position.set(-5, 9, 6);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 30;
    sun.shadow.camera.left = -14;
    sun.shadow.camera.right = 14;
    sun.shadow.camera.top = 12;
    sun.shadow.camera.bottom = -12;
    this.scene.add(sun);

    const arena = this.createArena();
    this.scene.add(arena, this.player.group);
    this.createPickups();
    this.createHazards();
    return arena;
  }

  private createArena(): THREE.Group {
    const arena = new THREE.Group();
    const floorTexture = this.createFloorTexture();
    floorTexture.wrapS = THREE.RepeatWrapping;
    floorTexture.wrapT = THREE.RepeatWrapping;
    floorTexture.repeat.set(ARENA.halfWidth / 2, ARENA.halfDepth / 2);

    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA.halfWidth * 2, ARENA.halfDepth * 2),
      new THREE.MeshStandardMaterial({
        color: '#2a2c25',
        map: floorTexture,
        roughness: 0.72,
        metalness: 0.02,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    arena.add(floor);

    const railMaterial = new THREE.MeshStandardMaterial({
      color: '#d94f35',
      roughness: 0.52,
      metalness: 0.08,
    });
    const longRailGeometry = new THREE.BoxGeometry(ARENA.halfWidth * 2 + 1, 0.55, 0.42);
    const shortRailGeometry = new THREE.BoxGeometry(0.42, 0.55, ARENA.halfDepth * 2 + 1);
    const rails = [
      new THREE.Mesh(longRailGeometry, railMaterial),
      new THREE.Mesh(longRailGeometry, railMaterial),
      new THREE.Mesh(shortRailGeometry, railMaterial),
      new THREE.Mesh(shortRailGeometry, railMaterial),
    ];
    rails[0].position.set(0, 0.28, -ARENA.halfDepth - 0.24);
    rails[1].position.set(0, 0.28, ARENA.halfDepth + 0.24);
    rails[2].position.set(-ARENA.halfWidth - 0.24, 0.28, 0);
    rails[3].position.set(ARENA.halfWidth + 0.24, 0.28, 0);
    for (const rail of rails) {
      rail.castShadow = true;
      rail.receiveShadow = true;
      arena.add(rail);
    }

    const centerMarker = new THREE.Mesh(
      new THREE.RingGeometry(0.68, 0.72, 48),
      new THREE.MeshBasicMaterial({ color: '#f5ba49' }),
    );
    centerMarker.rotation.x = -Math.PI / 2;
    centerMarker.position.y = 0.018;
    arena.add(centerMarker);
    return arena;
  }

  private createPickups(): void {
    const positions = [
      [-8, -4], [-3, -5], [3, -4.8], [8, -3],
      [-7.5, 3.5], [-1.5, 4.7], [4.5, 3.8], [8.2, 1.4],
    ];
    positions.forEach(([x, z], index) => {
      const pickup = new Pickup(index, new THREE.Vector3(x, 0.8, z));
      this.pickups.push(pickup);
      this.scene.add(pickup.group);
    });
  }

  private createHazards(): void {
    const hazards = [
      new Hazard(0, -2.3, 7.4, 0.8),
      new Hazard(0, 2.4, 7.1, 3.8),
    ];
    this.hazards.push(...hazards);
    for (const hazard of hazards) this.scene.add(hazard.group);
  }

  private createFloorTexture(): THREE.CanvasTexture {
    const size = 256;
    const textureCanvas = document.createElement('canvas');
    textureCanvas.width = size;
    textureCanvas.height = size;
    const context = textureCanvas.getContext('2d');
    if (!context) throw new Error('Could not create floor texture context.');

    context.fillStyle = '#282a24';
    context.fillRect(0, 0, size, size);
    context.strokeStyle = 'rgba(246, 241, 223, 0.08)';
    context.lineWidth = 1;
    for (let i = 0; i <= size; i += 32) {
      context.beginPath();
      context.moveTo(i, 0);
      context.lineTo(i, size);
      context.moveTo(0, i);
      context.lineTo(size, i);
      context.stroke();
    }
    context.strokeStyle = 'rgba(245, 186, 73, 0.24)';
    context.lineWidth = 2;
    context.strokeRect(8, 8, size - 16, size - 16);

    const texture = new THREE.CanvasTexture(textureCanvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  private resetRun(): void {
    this.score = 0;
    this.elapsed = 0;
    this.state = 'playing';
    this.player.reset();
    for (const pickup of this.pickups) {
      pickup.reset(this.rng() * Math.PI * 2);
    }
    for (const hazard of this.hazards) hazard.reset();
    this.cameraRig.snapTo(this.player.group.position);
    // A restart/teleport is a presentation discontinuity. Collapse every
    // interpolation pair so any render alpha displays the authoritative pose.
    this.holdPresentation();
    this.syncHud();
  }

  private holdPresentation(): void {
    this.player.holdPresentation();
    for (const pickup of this.pickups) pickup.holdPresentation();
    for (const hazard of this.hazards) hazard.holdPresentation();
    this.cameraRig.holdPresentation();
  }

  private syncHud(): void {
    this.hud.update(this.score, this.pickups.length, this.elapsed, TIME_LIMIT_SECONDS, this.state);
  }

  private getElement<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Missing element: ${selector}`);
    return element;
  }
}

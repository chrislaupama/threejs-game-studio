import * as THREE from 'three';
import { InputController } from '../core/InputController';
import { Loop } from '../core/Loop';
import { createRenderer, resizeRenderer } from '../core/Renderer';
import { Player } from '../entities/Player';
import { AudioSystem } from '../systems/AudioSystem';
import { CameraRig } from '../systems/CameraRig';
import { DebugTools, type DebugTuning } from '../systems/DebugTools';
import { Hud, type GameState } from '../systems/Hud';
import { disposeObject3D } from '../utils/dispose';
import { InterpolatedTransform } from '../utils/InterpolatedTransform';
import { createSeededRandom } from '../utils/random';

const ENABLE_GAME_DIAGNOSTICS =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_GAME_DIAGNOSTICS === 'true';
const TARGET_SCORE = 1;
const TIME_LIMIT_SECONDS = 120;
const GRAVITY = -28;
const JUMP_VELOCITY = 10.5;
const COYOTE_TIME_SECONDS = 0.1;
const JUMP_BUFFER_SECONDS = 0.12;
const LANDING_SLOP = 0.08;
const PLAYER_RADIUS = 0.45;
const FALL_KILL_Y = -4;
const MOVE_SPEED = 6.2;

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

type Platform = {
  mesh: THREE.Mesh;
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  topY: number;
};

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  private readonly input: InputController;
  private readonly player = new Player();
  private readonly playerPresentation = new InterpolatedTransform(this.player.group);
  private readonly platforms: Platform[] = [];
  private readonly audio = new AudioSystem();
  private readonly hud = new Hud();
  private readonly cameraRig = new CameraRig(this.camera, new THREE.Vector3(0, 6.5, 11));
  private readonly loop: Loop;
  private readonly tuning: DebugTuning = {
    speed: MOVE_SPEED,
    // The scaffold reserves this field for its generic action. Platformer speed
    // is intentionally independent from the jump button.
    dashMultiplier: 1,
    acceleration: 16,
    cameraLag: 0.13,
    exposure: 1.05,
    maxDpr: 1.5,
  };
  private readonly debugTools: DebugTools;
  private readonly sun = new THREE.DirectionalLight('#fff1bf', 2.6);
  private readonly arena: THREE.Group;
  private readonly rendererStatus = document.createElement('section');
  private readonly move = new THREE.Vector2();
  private readonly flag = new THREE.Group();
  private readonly platformMaterial = new THREE.MeshStandardMaterial({
    color: '#3a4238',
    roughness: 0.7,
    metalness: 0.05,
  });
  private readonly accentPlatformMaterial = new THREE.MeshStandardMaterial({
    color: '#48baa7',
    roughness: 0.45,
    metalness: 0.1,
    emissive: '#0f3f39',
    emissiveIntensity: 0.35,
  });

  private frame = 0;
  private score = 0;
  private elapsed = 0;
  private state: GameState = 'playing';
  private rng = createSeededRandom(1);
  private pausedForScreenshot = false;
  private reducedMotion = false;
  private contextLost = false;
  private resumeAfterContextRestore = false;
  private verticalVelocity = 0;
  private onGround = false;
  private jumpWasHeld = false;
  private coyoteTimeRemaining = 0;
  private jumpBufferRemaining = 0;
  private flagReached = false;

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
    this.debugTools = new DebugTools(this.tuning, () => {
      this.renderer.toneMappingExposure = this.tuning.exposure;
      resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);
    });

    this.arena = this.createScene();
    this.resetRun();
    resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);
    if (ENABLE_GAME_DIAGNOSTICS) {
      window.__THREE_GAME_TEST_HOOKS__ = {
        seed: (value: number) => {
          this.rng = createSeededRandom(value);
          return true;
        },
        setState: (name: string) => {
          if (name === 'active-play') this.resetRun();
          else if (name === 'complete') this.completeRun();
          else if (name === 'failed') this.failRun();
          else if (name === 'paused') {
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
        },
        setReducedMotion: (enabled: boolean) => {
          this.reducedMotion = enabled;
        },
        hideDebugUi: (hidden: boolean) => {
          this.debugTools.setHidden(hidden);
        },
      };
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
    this.debugTools.dispose();
    this.player.dispose();
    this.platformMaterial.dispose();
    this.accentPlatformMaterial.dispose();
    disposeObject3D(this.arena);
    disposeObject3D(this.flag);
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
      this.hud.update(this.score, TARGET_SCORE, this.elapsed, TIME_LIMIT_SECONDS, this.state);
      this.holdPresentation();
      return false;
    }

    this.elapsed += delta;
    const animationTime = this.reducedMotion ? 0 : this.elapsed;
    this.updatePlatformerPlayer(delta, animationTime);

    if (this.player.group.position.y < FALL_KILL_Y) {
      this.state = 'lost';
      this.audio.fail();
    } else if (this.reachedFlag()) {
      this.score = TARGET_SCORE;
      this.flagReached = true;
      this.state = 'won';
      this.audio.win();
      this.hud.flashPickup();
    }

    this.cameraRig.update(delta, this.player.group.position, this.tuning.cameraLag);
    this.hud.update(this.score, TARGET_SCORE, this.elapsed, TIME_LIMIT_SECONDS, this.state);
    return false;
  }

  private updatePlatformerPlayer(delta: number, elapsed: number): void {
    this.playerPresentation.beginStep();
    this.input.readMovement(this.move);
    const jumpHeld = this.input.isDashHeld();
    if (jumpHeld && !this.jumpWasHeld) this.jumpBufferRemaining = JUMP_BUFFER_SECONDS;
    else this.jumpBufferRemaining = Math.max(0, this.jumpBufferRemaining - delta);
    this.jumpWasHeld = jumpHeld;

    this.coyoteTimeRemaining = this.onGround
      ? COYOTE_TIME_SECONDS
      : Math.max(0, this.coyoteTimeRemaining - delta);

    const targetX = this.move.x * this.tuning.speed;
    const targetZ = this.move.y * this.tuning.speed;
    const smoothing = 1 - Math.exp(-this.tuning.acceleration * delta);
    this.player.velocity.x = THREE.MathUtils.lerp(this.player.velocity.x, targetX, smoothing);
    this.player.velocity.z = THREE.MathUtils.lerp(this.player.velocity.z, targetZ, smoothing);

    if (this.jumpBufferRemaining > 0 && this.coyoteTimeRemaining > 0) {
      this.verticalVelocity = JUMP_VELOCITY;
      this.onGround = false;
      this.coyoteTimeRemaining = 0;
      this.jumpBufferRemaining = 0;
    }

    const previousFeetY = this.player.group.position.y;
    this.verticalVelocity += GRAVITY * delta;
    this.player.group.position.x += this.player.velocity.x * delta;
    this.player.group.position.z += this.player.velocity.z * delta;
    this.player.group.position.y += this.verticalVelocity * delta;

    this.resolvePlatformCollision(previousFeetY);

    const horizontalSpeedSq =
      this.player.velocity.x * this.player.velocity.x +
      this.player.velocity.z * this.player.velocity.z;
    if (horizontalSpeedSq > 0.05) {
      // Player art faces local -Z. Negating X keeps rightward travel facing +X.
      this.player.group.rotation.y = Math.atan2(-this.player.velocity.x, -this.player.velocity.z);
    }
    if (this.onGround && !this.reducedMotion) {
      this.player.group.position.y += Math.sin(elapsed * 8) * 0.01;
    }
    this.player.velocity.y = this.verticalVelocity;
    this.playerPresentation.endStep();
  }

  private resolvePlatformCollision(previousFeetY: number): void {
    const feetY = this.player.group.position.y;
    const bodyX = this.player.group.position.x;
    const bodyZ = this.player.group.position.z;
    this.onGround = false;

    if (this.verticalVelocity > 0) return;

    for (const platform of this.platforms) {
      const withinX = bodyX >= platform.minX - PLAYER_RADIUS && bodyX <= platform.maxX + PLAYER_RADIUS;
      const withinZ = bodyZ >= platform.minZ - PLAYER_RADIUS && bodyZ <= platform.maxZ + PLAYER_RADIUS;
      if (!withinX || !withinZ) continue;

      if (previousFeetY >= platform.topY - LANDING_SLOP && feetY <= platform.topY) {
        this.player.group.position.y = platform.topY;
        this.verticalVelocity = 0;
        this.onGround = true;
        break;
      }
    }
  }

  private reachedFlag(): boolean {
    if (this.flagReached) return true;
    const dx = this.player.group.position.x - this.flag.position.x;
    const dz = this.player.group.position.z - this.flag.position.z;
    const dy = this.player.group.position.y - this.flag.position.y;
    return dx * dx + dz * dz < 1.1 * 1.1 && Math.abs(dy) < 2.2;
  }

  private render(alpha: number): void {
    this.playerPresentation.present(alpha);
    this.cameraRig.present(alpha);
    resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);
    this.renderer.render(this.scene, this.camera);
    if (ENABLE_GAME_DIAGNOSTICS) {
      const info = this.renderer.info;
      const dpr = this.renderer.getPixelRatio();
      const toneMappingName = getToneMappingName(this.renderer.toneMapping);

      window.__THREE_GAME_DIAGNOSTICS__ = {
        frame: this.frame,
        elapsed: this.elapsed,
        timeRemaining: Math.max(0, TIME_LIMIT_SECONDS - this.elapsed),
        state: this.state,
        score: this.score,
        targetScore: TARGET_SCORE,
        complete: this.state === 'won',
        hazards: 0,
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
          toneMapping: toneMappingName,
          toneMappingExposure: this.renderer.toneMappingExposure,
          calls: info.render.calls,
          triangles: info.render.triangles,
          geometries: info.memory.geometries,
          textures: info.memory.textures,
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
    }
  }

  private createScene(): THREE.Group {
    this.scene.background = new THREE.Color('#161914');
    this.scene.fog = new THREE.Fog('#161914', 28, 70);

    const hemisphere = new THREE.HemisphereLight('#f6f1df', '#2a3228', 1.55);
    this.scene.add(hemisphere);

    const sun = this.sun;
    sun.position.set(6, 12, -4);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 50;
    sun.shadow.camera.left = -20;
    sun.shadow.camera.right = 20;
    sun.shadow.camera.top = 24;
    sun.shadow.camera.bottom = -10;
    this.scene.add(sun);

    const arena = new THREE.Group();
    this.createPlatforms(arena);
    this.createFlag();
    this.scene.add(arena, this.player.group, this.flag);
    return arena;
  }

  private createPlatforms(arena: THREE.Group): void {
    const specs: Array<{ x: number; y: number; z: number; w: number; d: number; accent?: boolean }> = [
      // Give first-time touch players enough runway to learn steering,
      // release the stick, and queue a jump without drifting off spawn.
      { x: 0, y: 0, z: 0, w: 9, d: 7 },
      { x: 0.5, y: 0.4, z: -7, w: 4.2, d: 3.2 },
      { x: -1.2, y: 1.1, z: -13, w: 3.6, d: 3 },
      { x: 1.4, y: 1.8, z: -19, w: 3.4, d: 2.8 },
      { x: -0.6, y: 2.4, z: -25, w: 3.8, d: 3 },
      { x: 0.2, y: 3.0, z: -32, w: 4.5, d: 4, accent: true },
    ];

    for (const spec of specs) {
      const height = 0.55;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(spec.w, height, spec.d),
        spec.accent ? this.accentPlatformMaterial : this.platformMaterial,
      );
      mesh.position.set(spec.x, spec.y - height / 2, spec.z);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      arena.add(mesh);
      this.platforms.push({
        mesh,
        minX: spec.x - spec.w / 2,
        maxX: spec.x + spec.w / 2,
        minZ: spec.z - spec.d / 2,
        maxZ: spec.z + spec.d / 2,
        topY: spec.y,
      });
    }
  }

  private createFlag(): void {
    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.08, 2.4, 8),
      new THREE.MeshStandardMaterial({ color: '#d8d2c2', roughness: 0.4, metalness: 0.2 }),
    );
    pole.position.y = 1.2;
    pole.castShadow = true;
    this.flag.add(pole);

    const banner = new THREE.Mesh(
      new THREE.PlaneGeometry(1.1, 0.7),
      new THREE.MeshStandardMaterial({
        color: '#f5ba49',
        emissive: '#6a4a10',
        emissiveIntensity: 0.4,
        side: THREE.DoubleSide,
      }),
    );
    banner.position.set(0.55, 2.0, 0);
    this.flag.add(banner);

    const last = this.platforms[this.platforms.length - 1]!;
    this.flag.position.set((last.minX + last.maxX) / 2, last.topY, (last.minZ + last.maxZ) / 2 - 0.4);
  }

  private resetRun(): void {
    this.score = 0;
    this.elapsed = 0;
    this.state = 'playing';
    this.verticalVelocity = 0;
    this.onGround = true;
    this.jumpWasHeld = false;
    this.coyoteTimeRemaining = COYOTE_TIME_SECONDS;
    this.jumpBufferRemaining = 0;
    this.flagReached = false;
    this.player.reset();
    const spawnJitter = (this.rng() - 0.5) * 0.4;
    this.player.group.position.set(spawnJitter, this.platforms[0]?.topY ?? 0, 0);
    this.player.velocity.set(0, 0, 0);
    this.playerPresentation.snap();
    this.cameraRig.snapTo(this.player.group.position);
    this.syncHud();
  }

  private holdPresentation(): void {
    this.playerPresentation.hold();
    this.cameraRig.holdPresentation();
  }

  private completeRun(): void {
    this.resetRun();
    const last = this.platforms[this.platforms.length - 1]!;
    this.player.group.position.set(this.flag.position.x, last.topY, this.flag.position.z);
    this.score = TARGET_SCORE;
    this.flagReached = true;
    this.state = 'won';
    this.playerPresentation.snap();
    this.cameraRig.snapTo(this.player.group.position);
    this.syncHud();
  }

  private failRun(): void {
    this.resetRun();
    this.player.group.position.y = FALL_KILL_Y - 0.5;
    this.state = 'lost';
    this.playerPresentation.snap();
    this.cameraRig.snapTo(this.player.group.position);
    this.syncHud();
  }

  private syncHud(): void {
    this.hud.update(this.score, TARGET_SCORE, this.elapsed, TIME_LIMIT_SECONDS, this.state);
  }

  private getElement<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Missing element: ${selector}`);
    return element;
  }
}

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
import { createSeededRandom } from '../utils/random';

const WIN_DISTANCE = 120;
const FORWARD_SPEED = 14;
const LANE_HALF_WIDTH = 4.2;
const PLAYER_RADIUS = 0.55;
const OBSTACLE_COUNT = 8;
const RECYCLE_AHEAD = 48;
const RECYCLE_BEHIND = 12;
/** Soft timer ceiling so the HUD countdown stays readable; win is distance-based. */
const TIME_LIMIT_SECONDS = 180;

type Obstacle = {
  mesh: THREE.Mesh;
  radius: number;
};

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(52, 1, 0.1, 120);
  private readonly input: InputController;
  private readonly player = new Player();
  private readonly obstacles: Obstacle[] = [];
  private readonly audio = new AudioSystem();
  private readonly hud = new Hud();
  private readonly cameraRig = new CameraRig(this.camera, new THREE.Vector3(0, 5.5, 11));
  private readonly loop: Loop;
  private readonly tuning: DebugTuning = {
    speed: 7.2,
    dashMultiplier: 1.35,
    acceleration: 14,
    cameraLag: 0.12,
    exposure: 1.05,
    maxDpr: 1.5,
  };
  private readonly debugTools: DebugTools;
  private readonly sun = new THREE.DirectionalLight('#fff1bf', 2.6);
  private readonly arena: THREE.Group;
  private readonly rendererStatus = document.createElement('section');
  private readonly move = new THREE.Vector2();
  private readonly scratch = new THREE.Vector3();
  private readonly obstacleMaterial = new THREE.MeshStandardMaterial({
    color: '#d94f35',
    roughness: 0.48,
    metalness: 0.12,
    emissive: '#4a120c',
    emissiveIntensity: 0.45,
  });
  private readonly obstacleGeometry = new THREE.BoxGeometry(1.1, 1.2, 1.1);

  private frame = 0;
  private score = 0;
  private elapsed = 0;
  private distance = 0;
  private state: GameState = 'playing';
  private rng = createSeededRandom(1);
  private pausedForScreenshot = false;
  private reducedMotion = false;
  private contextLost = false;
  private resumeAfterContextRestore = false;
  private startZ = 0;

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
    this.installTestHooks();
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
    this.obstacleGeometry.dispose();
    this.obstacleMaterial.dispose();
    disposeObject3D(this.arena);
    this.sun.dispose();
    this.renderer.dispose();
    window.__THREE_GAME_DIAGNOSTICS__ = undefined;
    window.__THREE_GAME_TEST_HOOKS__ = undefined;
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
      this.hud.update(this.score, WIN_DISTANCE, this.elapsed, TIME_LIMIT_SECONDS, this.state);
      this.holdPresentation();
      return false;
    }

    this.elapsed += delta;
    const animationTime = this.reducedMotion ? 0 : this.elapsed;
    this.updateRunnerPlayer(delta, animationTime);
    this.recycleObstacles();

    this.distance = Math.max(0, this.startZ - this.player.group.position.z);
    this.score = Math.floor(this.distance);

    if (this.hitsObstacle()) {
      this.state = 'lost';
      this.audio.fail();
    } else if (this.distance >= WIN_DISTANCE) {
      this.score = WIN_DISTANCE;
      this.state = 'won';
      this.audio.win();
    }

    this.cameraRig.update(delta, this.player.group.position, this.tuning.cameraLag);
    this.hud.update(this.score, WIN_DISTANCE, this.elapsed, TIME_LIMIT_SECONDS, this.state);
    return false;
  }

  private updateRunnerPlayer(delta: number, elapsed: number): void {
    this.input.readMovement(this.move);
    const dash = this.input.isDashHeld() ? this.tuning.dashMultiplier : 1;
    const lateralTarget = this.move.x * this.tuning.speed * dash;
    const smoothing = 1 - Math.exp(-this.tuning.acceleration * delta);
    this.player.velocity.x = THREE.MathUtils.lerp(this.player.velocity.x, lateralTarget, smoothing);
    this.player.velocity.y = 0;
    this.player.velocity.z = -FORWARD_SPEED * dash;

    this.player.group.position.x += this.player.velocity.x * delta;
    this.player.group.position.z += this.player.velocity.z * delta;
    this.player.group.position.x = THREE.MathUtils.clamp(
      this.player.group.position.x,
      -LANE_HALF_WIDTH,
      LANE_HALF_WIDTH,
    );
    this.player.group.rotation.y = Math.atan2(this.player.velocity.x * 0.15, -this.player.velocity.z);
    this.player.group.position.y =
      0.06 + Math.sin(elapsed * 9) * Math.min(Math.abs(this.player.velocity.z) / 80, 0.06);
  }

  private recycleObstacles(): void {
    const playerZ = this.player.group.position.z;
    for (const obstacle of this.obstacles) {
      if (obstacle.mesh.position.z > playerZ + RECYCLE_BEHIND) {
        this.placeObstacle(obstacle, playerZ - RECYCLE_AHEAD - this.rng() * 18);
      }
    }
  }

  private placeObstacle(obstacle: Obstacle, z: number): void {
    const lane = (this.rng() * 2 - 1) * (LANE_HALF_WIDTH - 0.6);
    obstacle.mesh.position.set(lane, 0.6, z);
    obstacle.mesh.visible = true;
  }

  private hitsObstacle(): boolean {
    const playerPos = this.player.group.position;
    for (const obstacle of this.obstacles) {
      if (!obstacle.mesh.visible) continue;
      this.scratch.copy(playerPos).sub(obstacle.mesh.position);
      this.scratch.y = 0;
      const radius = PLAYER_RADIUS + obstacle.radius;
      if (this.scratch.lengthSq() <= radius * radius) return true;
    }
    return false;
  }

  private render(_alpha: number): void {
    this.cameraRig.present(_alpha);
    resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);
    this.renderer.render(this.scene, this.camera);
    this.publishDiagnostics();
  }

  private createScene(): THREE.Group {
    this.scene.background = new THREE.Color('#12161a');
    this.scene.fog = new THREE.Fog('#12161a', 24, 70);

    const hemisphere = new THREE.HemisphereLight('#f6f1df', '#1c2428', 1.5);
    this.scene.add(hemisphere);

    const sun = this.sun;
    sun.position.set(-4, 10, 8);
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024);
    sun.shadow.camera.near = 0.5;
    sun.shadow.camera.far = 40;
    sun.shadow.camera.left = -16;
    sun.shadow.camera.right = 16;
    sun.shadow.camera.top = 20;
    sun.shadow.camera.bottom = -10;
    this.scene.add(sun);

    const arena = this.createTrack();
    this.scene.add(arena, this.player.group);
    this.createObstacles();
    return arena;
  }

  private createTrack(): THREE.Group {
    const arena = new THREE.Group();
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(LANE_HALF_WIDTH * 2 + 2, 220),
      new THREE.MeshStandardMaterial({
        color: '#2a3034',
        roughness: 0.78,
        metalness: 0.04,
      }),
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.z = -90;
    floor.receiveShadow = true;
    arena.add(floor);

    const railMaterial = new THREE.MeshStandardMaterial({
      color: '#48baa7',
      roughness: 0.5,
      metalness: 0.1,
    });
    for (const x of [-LANE_HALF_WIDTH - 0.35, LANE_HALF_WIDTH + 0.35]) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.5, 220), railMaterial);
      rail.position.set(x, 0.25, -90);
      rail.castShadow = true;
      arena.add(rail);
    }

    const finish = new THREE.Mesh(
      new THREE.BoxGeometry(LANE_HALF_WIDTH * 2 + 1.2, 0.12, 0.6),
      new THREE.MeshStandardMaterial({ color: '#f5ba49', emissive: '#6a4a10', emissiveIntensity: 0.5 }),
    );
    finish.position.set(0, 0.08, -WIN_DISTANCE);
    arena.add(finish);
    return arena;
  }

  private createObstacles(): void {
    for (let index = 0; index < OBSTACLE_COUNT; index += 1) {
      const mesh = new THREE.Mesh(this.obstacleGeometry, this.obstacleMaterial);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      const obstacle: Obstacle = { mesh, radius: 0.78 };
      this.obstacles.push(obstacle);
      this.scene.add(mesh);
      this.placeObstacle(obstacle, -18 - index * 14 - this.rng() * 6);
    }
  }

  private installTestHooks(): void {
    window.__THREE_GAME_TEST_HOOKS__ = {
      seed: (value: number) => {
        this.rng = createSeededRandom(value);
      },
      setState: (name: string) => {
        if (name === 'active-play') this.resetRun();
        else if (name === 'complete') this.completeRun();
        else if (name === 'failed') this.failRun();
        else if (name === 'paused') {
          this.resetRun();
          this.state = 'paused';
          this.syncHud();
        } else console.warn(`Unknown test state: ${name}`);
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

  private resetRun(): void {
    this.score = 0;
    this.elapsed = 0;
    this.distance = 0;
    this.state = 'playing';
    this.player.reset();
    this.startZ = this.player.group.position.z;
    this.player.velocity.set(0, 0, -FORWARD_SPEED);
    for (let index = 0; index < this.obstacles.length; index += 1) {
      this.placeObstacle(this.obstacles[index]!, -16 - index * 14 - this.rng() * 5);
    }
    this.cameraRig.snapTo(this.player.group.position);
    this.syncHud();
  }

  private holdPresentation(): void {
    this.cameraRig.holdPresentation();
  }

  private completeRun(): void {
    this.resetRun();
    this.player.group.position.z = this.startZ - WIN_DISTANCE;
    this.distance = WIN_DISTANCE;
    this.score = WIN_DISTANCE;
    this.state = 'won';
    this.cameraRig.snapTo(this.player.group.position);
    this.syncHud();
  }

  private failRun(): void {
    this.resetRun();
    this.state = 'lost';
    this.syncHud();
  }

  private syncHud(): void {
    this.hud.update(this.score, WIN_DISTANCE, this.elapsed, TIME_LIMIT_SECONDS, this.state);
  }

  private publishDiagnostics(): void {
    const info = this.renderer.info;
    const dpr = this.renderer.getPixelRatio();
    const toneMappingName =
      Object.entries(THREE)
        .find(
          ([key, value]) =>
            key.endsWith('ToneMapping') && value === this.renderer.toneMapping,
        )?.[0] ?? String(this.renderer.toneMapping);

    window.__THREE_GAME_DIAGNOSTICS__ = {
      frame: this.frame,
      elapsed: this.elapsed,
      timeRemaining: Math.max(0, TIME_LIMIT_SECONDS - this.elapsed),
      state: this.state,
      score: this.score,
      targetScore: WIN_DISTANCE,
      complete: this.state === 'won',
      hazards: this.obstacles.length,
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
        type: this.renderer.constructor.name,
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

  private getElement<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Missing element: ${selector}`);
    return element;
  }
}

import * as THREE from 'three';
import { InputController } from '../core/InputController';
import { Loop } from '../core/Loop';
import { createRenderer, resizeRenderer } from '../core/Renderer';
import { Hazard } from '../entities/Hazard';
import { Player, type ArenaBounds } from '../entities/Player';
import { AudioSystem } from '../systems/AudioSystem';
import { CameraRig } from '../systems/CameraRig';
import { DebugTools, type DebugTuning } from '../systems/DebugTools';
import { Hud, type GameState } from '../systems/Hud';
import { disposeObject3D } from '../utils/dispose';
import { InterpolatedTransform } from '../utils/InterpolatedTransform';
import { createSeededRandom } from '../utils/random';

const ARENA: ArenaBounds = { halfWidth: 11, halfDepth: 7 };
const TIME_LIMIT_SECONDS = 45;
const MAX_HEALTH = 1;
const WAVE = 1;
const TOTAL_WAVES = 1;
const PLAYER_RADIUS = 0.55;
const ENEMY_COUNT = 6;
const FIRE_COOLDOWN = 0.22;
const PROJECTILE_SPEED = 22;
const PROJECTILE_RADIUS = 0.28;
const PROJECTILE_LIFETIME = 1.6;
const ENABLE_GAME_DIAGNOSTICS =
  import.meta.env.DEV || import.meta.env.VITE_ENABLE_GAME_DIAGNOSTICS === 'true';

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

type Projectile = {
  mesh: THREE.Mesh;
  presentation: InterpolatedTransform;
  velocity: THREE.Vector3;
  alive: boolean;
  age: number;
};

export class Game {
  private readonly renderer: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(48, 1, 0.1, 80);
  private readonly input: InputController;
  private readonly player = new Player();
  private readonly enemies: Hazard[] = [];
  private readonly enemyAlive: boolean[] = [];
  private readonly projectiles: Projectile[] = [];
  private readonly audio = new AudioSystem();
  private readonly hud = new Hud();
  private readonly cameraRig = new CameraRig(this.camera);
  private readonly loop: Loop;
  private readonly tuning: DebugTuning = {
    speed: 6.4,
    dashMultiplier: 1.2,
    acceleration: 14,
    cameraLag: 0.14,
    exposure: 1.05,
    maxDpr: 1.5,
  };
  private readonly debugTools: DebugTools;
  private readonly sun = new THREE.DirectionalLight('#fff1bf', 2.6);
  private readonly arena: THREE.Group;
  private readonly rendererStatus = document.createElement('section');
  private readonly scratch = new THREE.Vector3();
  private readonly aim = new THREE.Vector3();
  private readonly projectileGeometry = new THREE.SphereGeometry(0.22, 10, 10);
  private readonly projectileMaterial = new THREE.MeshStandardMaterial({
    color: '#f5ba49',
    emissive: '#8a5a10',
    emissiveIntensity: 0.85,
    roughness: 0.35,
    metalness: 0.15,
  });

  private frame = 0;
  private score = 0;
  private elapsed = 0;
  private health = MAX_HEALTH;
  private state: GameState = 'playing';
  private rng = createSeededRandom(1);
  private pausedForScreenshot = false;
  private reducedMotion = false;
  private contextLost = false;
  private resumeAfterContextRestore = false;
  private fireCooldown = 0;

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
          if (paused) this.holdPresentation();
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
    for (const enemy of this.enemies) enemy.dispose();
    this.player.dispose();
    this.projectileGeometry.dispose();
    this.projectileMaterial.dispose();
    disposeObject3D(this.arena);
    this.sun.dispose();
    this.renderer.dispose();
    if (ENABLE_GAME_DIAGNOSTICS) {
      window.__THREE_GAME_DIAGNOSTICS__ = undefined;
      window.__THREE_GAME_TEST_HOOKS__ = undefined;
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
      this.syncHud();
      this.holdPresentation();
      return false;
    }

    this.elapsed += delta;
    this.fireCooldown = Math.max(0, this.fireCooldown - delta);
    const animationDelta = this.reducedMotion ? 0 : delta;
    const animationTime = this.reducedMotion ? 0 : this.elapsed;

    this.player.update(delta, animationTime, this.input, this.tuning, ARENA);
    for (let index = 0; index < this.enemies.length; index += 1) {
      if (!this.enemyAlive[index]) continue;
      this.enemies[index]!.update(animationDelta, animationTime);
    }

    if (this.input.isDashHeld() && this.fireCooldown <= 0) {
      this.fireProjectile();
      this.fireCooldown = FIRE_COOLDOWN;
    }

    this.updateProjectiles(delta);
    this.resolveCombat();

    if (this.score >= ENEMY_COUNT) {
      this.state = 'won';
      this.audio.win();
    } else if (this.playerHitByEnemy()) {
      this.health = 0;
      this.state = 'lost';
      this.audio.fail();
    } else if (this.elapsed >= TIME_LIMIT_SECONDS) {
      this.state = 'lost';
      this.audio.fail();
    }

    this.cameraRig.update(delta, this.player.group.position, this.tuning.cameraLag);
    this.syncHud();
    return false;
  }

  private fireProjectile(): void {
    // The player model's authored forward axis is local -Z.
    this.aim.set(0, 0, -1).applyQuaternion(this.player.group.quaternion);
    if (this.aim.lengthSq() < 0.001) this.aim.set(0, 0, -1);
    this.aim.normalize();

    let projectile = this.projectiles.find((entry) => !entry.alive);
    if (!projectile) {
      const mesh = new THREE.Mesh(this.projectileGeometry, this.projectileMaterial);
      mesh.castShadow = true;
      projectile = {
        mesh,
        presentation: new InterpolatedTransform(mesh),
        velocity: new THREE.Vector3(),
        alive: false,
        age: 0,
      };
      this.projectiles.push(projectile);
      this.scene.add(mesh);
    }

    projectile.alive = true;
    projectile.age = 0;
    projectile.mesh.visible = true;
    projectile.mesh.position.copy(this.player.group.position);
    projectile.mesh.position.y = 0.85;
    projectile.mesh.position.addScaledVector(this.aim, 0.9);
    projectile.velocity.copy(this.aim).multiplyScalar(PROJECTILE_SPEED);
    projectile.presentation.snap();
    this.audio.pickup(this.score);
  }

  private updateProjectiles(delta: number): void {
    for (const projectile of this.projectiles) {
      if (!projectile.alive) continue;
      projectile.presentation.beginStep();
      projectile.age += delta;
      projectile.mesh.position.addScaledVector(projectile.velocity, delta);
      if (
        projectile.age >= PROJECTILE_LIFETIME ||
        Math.abs(projectile.mesh.position.x) > ARENA.halfWidth + 2 ||
        Math.abs(projectile.mesh.position.z) > ARENA.halfDepth + 2
      ) {
        projectile.alive = false;
        projectile.mesh.visible = false;
      }
      projectile.presentation.endStep();
    }
  }

  private resolveCombat(): void {
    for (const projectile of this.projectiles) {
      if (!projectile.alive) continue;
      for (let index = 0; index < this.enemies.length; index += 1) {
        if (!this.enemyAlive[index]) continue;
        const enemy = this.enemies[index]!;
        this.scratch.copy(projectile.mesh.position).sub(enemy.group.position);
        const radius = PROJECTILE_RADIUS + enemy.radius;
        if (this.scratch.lengthSq() <= radius * radius) {
          projectile.alive = false;
          projectile.mesh.visible = false;
          this.enemyAlive[index] = false;
          enemy.group.visible = false;
          this.score += 1;
          this.audio.pickup(this.score);
          this.hud.flashPickup();
          break;
        }
      }
    }
  }

  private playerHitByEnemy(): boolean {
    const playerPos = this.player.group.position;
    for (let index = 0; index < this.enemies.length; index += 1) {
      if (!this.enemyAlive[index]) continue;
      const enemy = this.enemies[index]!;
      this.scratch.copy(playerPos).sub(enemy.group.position);
      this.scratch.y = 0;
      const radius = PLAYER_RADIUS + enemy.radius;
      if (this.scratch.lengthSq() <= radius * radius) return true;
    }
    return false;
  }

  private render(alpha: number): void {
    this.player.present(alpha);
    for (let index = 0; index < this.enemies.length; index += 1) {
      if (!this.enemyAlive[index]) continue;
      this.enemies[index]!.present(alpha);
    }
    for (const projectile of this.projectiles) {
      if (projectile.alive) projectile.presentation.present(alpha);
    }
    this.cameraRig.present(alpha);
    resizeRenderer(this.renderer, this.camera, this.tuning.maxDpr);
    this.renderer.render(this.scene, this.camera);
    if (ENABLE_GAME_DIAGNOSTICS) {
      const info = this.renderer.info;
      const dpr = this.renderer.getPixelRatio();
      const aliveHazards = this.enemyAlive.filter(Boolean).length;

      window.__THREE_GAME_DIAGNOSTICS__ = {
        frame: this.frame,
        elapsed: this.elapsed,
        timeRemaining: Math.max(0, TIME_LIMIT_SECONDS - this.elapsed),
        state: this.state,
        score: this.score,
        targetScore: ENEMY_COUNT,
        complete: this.state === 'won',
        hazards: aliveHazards,
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
    this.scene.background = new THREE.Color('#141820');
    this.scene.fog = new THREE.Fog('#141820', 22, 48);

    const hemisphere = new THREE.HemisphereLight('#f6f1df', '#222833', 1.6);
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
    this.createEnemies();
    return arena;
  }

  private createArena(): THREE.Group {
    const arena = new THREE.Group();
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(ARENA.halfWidth * 2, ARENA.halfDepth * 2),
      new THREE.MeshStandardMaterial({
        color: '#262b33',
        roughness: 0.74,
        metalness: 0.05,
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
    rails[0]!.position.set(0, 0.28, -ARENA.halfDepth - 0.24);
    rails[1]!.position.set(0, 0.28, ARENA.halfDepth + 0.24);
    rails[2]!.position.set(-ARENA.halfWidth - 0.24, 0.28, 0);
    rails[3]!.position.set(ARENA.halfWidth + 0.24, 0.28, 0);
    for (const rail of rails) {
      rail.castShadow = true;
      rail.receiveShadow = true;
      arena.add(rail);
    }
    return arena;
  }

  private createEnemies(): void {
    const slots: Array<[number, number, number, number]> = [
      [-7.5, -4.2, 0.4, 0.2],
      [-3.2, -5.1, 0.5, 1.1],
      [3.4, -4.6, 0.35, 2.0],
      [7.2, -3.3, 0.45, 2.8],
      [-6.4, 3.8, 0.4, 3.6],
      [5.8, 4.2, 0.5, 4.4],
    ];
    for (let index = 0; index < ENEMY_COUNT; index += 1) {
      const [x, z, travel, phase] = slots[index]!;
      const enemy = new Hazard(x, z, travel, phase);
      this.enemies.push(enemy);
      this.enemyAlive.push(true);
      this.scene.add(enemy.group);
    }
  }

  private resetRun(): void {
    this.score = 0;
    this.elapsed = 0;
    this.health = MAX_HEALTH;
    this.state = 'playing';
    this.fireCooldown = 0;
    this.player.reset();
    for (let index = 0; index < this.enemies.length; index += 1) {
      this.enemyAlive[index] = true;
      this.enemies[index]!.group.visible = true;
      this.enemies[index]!.reset();
      // Seeded jitter keeps layouts reproducible via __THREE_GAME_TEST_HOOKS__.seed.
      this.enemies[index]!.group.position.x += (this.rng() - 0.5) * 0.35;
      this.enemies[index]!.group.position.z += (this.rng() - 0.5) * 0.35;
    }
    for (const projectile of this.projectiles) {
      projectile.alive = false;
      projectile.age = 0;
      projectile.velocity.set(0, 0, 0);
      projectile.mesh.visible = false;
      projectile.presentation.snap();
    }
    this.cameraRig.snapTo(this.player.group.position);
    this.syncHud();
  }

  private holdPresentation(): void {
    this.player.holdPresentation();
    for (let index = 0; index < this.enemies.length; index += 1) {
      if (!this.enemyAlive[index]) continue;
      this.enemies[index]!.holdPresentation();
    }
    for (const projectile of this.projectiles) {
      if (projectile.alive) projectile.presentation.hold();
    }
    this.cameraRig.holdPresentation();
  }

  private completeRun(): void {
    this.resetRun();
    for (let index = 0; index < this.enemies.length; index += 1) {
      this.enemyAlive[index] = false;
      this.enemies[index]!.group.visible = false;
    }
    this.score = ENEMY_COUNT;
    this.state = 'won';
    this.syncHud();
  }

  private failRun(): void {
    this.resetRun();
    this.elapsed = TIME_LIMIT_SECONDS;
    this.state = 'lost';
    this.syncHud();
  }

  private syncHud(): void {
    this.hud.update(
      this.score,
      ENEMY_COUNT,
      this.health,
      MAX_HEALTH,
      WAVE,
      TOTAL_WAVES,
      this.elapsed,
      TIME_LIMIT_SECONDS,
      this.state,
    );
  }

  private getElement<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Missing element: ${selector}`);
    return element;
  }
}

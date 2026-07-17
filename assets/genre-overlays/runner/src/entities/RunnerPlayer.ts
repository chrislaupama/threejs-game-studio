import * as THREE from 'three';
import type { InputController } from '../core/InputController';
import { InterpolatedTransform } from '../utils/InterpolatedTransform';

export type RunnerPlayerTuning = {
  lateralSpeed: number;
  forwardSpeed: number;
  boostMultiplier: number;
  acceleration: number;
  laneHalfWidth: number;
};

/**
 * Auto-runner controller with a fixed-step authoritative transform and a
 * separately interpolated rendered pose. The vehicle's local forward axis is
 * -Z, matching Three.js camera/object conventions used by the scaffold.
 */
export class RunnerPlayer {
  readonly group = new THREE.Group();
  readonly velocity = new THREE.Vector3();

  private readonly movement = new THREE.Vector2();
  private readonly presentation: InterpolatedTransform;
  private readonly bodyMaterial = new THREE.MeshStandardMaterial({
    color: '#f5ba49',
    roughness: 0.42,
    metalness: 0.18,
  });
  private readonly accentMaterial = new THREE.MeshStandardMaterial({
    color: '#48baa7',
    roughness: 0.28,
    metalness: 0.22,
    emissive: '#123f39',
    emissiveIntensity: 0.45,
  });
  private readonly engineMaterial = new THREE.MeshStandardMaterial({
    color: '#dffcf6',
    roughness: 0.18,
    metalness: 0.12,
    emissive: '#48baa7',
    emissiveIntensity: 1.2,
  });
  private readonly bodyGeometry = new THREE.CapsuleGeometry(0.38, 0.58, 6, 12);
  private readonly noseGeometry = new THREE.ConeGeometry(0.22, 0.5, 4);
  private readonly finGeometry = new THREE.BoxGeometry(0.24, 0.12, 0.68);
  private readonly engineGeometry = new THREE.CylinderGeometry(0.1, 0.14, 0.16, 10);

  private boosting = false;

  constructor() {
    const body = new THREE.Mesh(this.bodyGeometry, this.bodyMaterial);
    body.castShadow = true;
    body.receiveShadow = true;
    body.position.y = 0.68;
    this.group.add(body);

    const nose = new THREE.Mesh(this.noseGeometry, this.accentMaterial);
    nose.castShadow = true;
    nose.position.set(0, 0.68, -0.58);
    // ConeGeometry points along +Y. Rotate its tip toward local -Z.
    nose.rotation.x = -Math.PI / 2;
    this.group.add(nose);

    for (const side of [-1, 1]) {
      const fin = new THREE.Mesh(this.finGeometry, this.accentMaterial);
      fin.castShadow = true;
      fin.position.set(side * 0.42, 0.5, 0.08);
      fin.rotation.z = side * -0.12;
      this.group.add(fin);

      const engine = new THREE.Mesh(this.engineGeometry, this.engineMaterial);
      engine.castShadow = true;
      engine.position.set(side * 0.2, 0.58, 0.43);
      engine.rotation.x = Math.PI / 2;
      this.group.add(engine);
    }

    this.presentation = new InterpolatedTransform(this.group);
  }

  get isBoosting(): boolean {
    return this.boosting;
  }

  update(
    delta: number,
    elapsed: number,
    input: InputController,
    tuning: RunnerPlayerTuning,
  ): void {
    this.presentation.beginStep();
    input.readMovement(this.movement);
    this.boosting = input.isDashHeld();
    const boost = this.boosting ? tuning.boostMultiplier : 1;
    const lateralTarget = this.movement.x * tuning.lateralSpeed * boost;
    const smoothing = 1 - Math.exp(-tuning.acceleration * delta);

    this.velocity.x = THREE.MathUtils.lerp(this.velocity.x, lateralTarget, smoothing);
    this.velocity.y = 0;
    this.velocity.z = -tuning.forwardSpeed * boost;
    this.group.position.addScaledVector(this.velocity, delta);
    this.group.position.x = THREE.MathUtils.clamp(
      this.group.position.x,
      -tuning.laneHalfWidth,
      tuning.laneHalfWidth,
    );

    // A local -Z vehicle needs a negative yaw to face a positive-X velocity.
    const visualLateralVelocity = this.velocity.x * 0.24;
    this.group.rotation.y = Math.atan2(-visualLateralVelocity, -this.velocity.z);
    this.group.position.y =
      0.06 + Math.sin(elapsed * 9) * Math.min(Math.abs(this.velocity.z) / 80, 0.06);
    this.engineMaterial.emissiveIntensity = this.boosting ? 2.2 : 1.2;
    this.presentation.endStep();
  }

  reset(forwardSpeed: number): void {
    this.group.position.set(0, 0.06, 0);
    this.group.rotation.set(0, 0, 0);
    this.velocity.set(0, 0, -forwardSpeed);
    this.boosting = false;
    this.engineMaterial.emissiveIntensity = 1.2;
    this.presentation.snap();
  }

  teleportTo(x: number, z: number): void {
    this.group.position.set(x, 0.06, z);
    this.presentation.snap();
  }

  present(alpha: number): void {
    this.presentation.present(alpha);
  }

  holdPresentation(): void {
    this.presentation.hold();
  }

  dispose(): void {
    this.bodyGeometry.dispose();
    this.noseGeometry.dispose();
    this.finGeometry.dispose();
    this.engineGeometry.dispose();
    this.bodyMaterial.dispose();
    this.accentMaterial.dispose();
    this.engineMaterial.dispose();
  }
}

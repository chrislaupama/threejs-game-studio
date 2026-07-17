import * as THREE from 'three';
import type { InputController } from '../core/InputController';
import { InterpolatedTransform } from '../utils/InterpolatedTransform';

export type PlayerTuning = {
  speed: number;
  /** Retained for scaffold/debug-tool compatibility; fire never boosts movement. */
  dashMultiplier: number;
  acceleration: number;
};

export type ArenaBounds = {
  halfWidth: number;
  halfDepth: number;
};

/**
 * Arena-shooter player whose authored and gameplay forward axis is local -Z.
 * The fire intent deliberately does not modify locomotion speed.
 */
export class Player {
  readonly group = new THREE.Group();
  readonly velocity = new THREE.Vector3();

  private readonly move = new THREE.Vector2();
  private readonly targetVelocity = new THREE.Vector3();
  private readonly bodyMaterial = new THREE.MeshStandardMaterial({
    color: '#f5ba49',
    roughness: 0.48,
    metalness: 0.12,
  });
  private readonly accentMaterial = new THREE.MeshStandardMaterial({
    color: '#48baa7',
    roughness: 0.32,
    metalness: 0.18,
    emissive: '#123f39',
    emissiveIntensity: 0.35,
  });
  private readonly bodyGeometry = new THREE.CapsuleGeometry(0.38, 0.58, 6, 12);
  private readonly noseGeometry = new THREE.ConeGeometry(0.22, 0.5, 4);
  private readonly presentation: InterpolatedTransform;

  constructor() {
    const body = new THREE.Mesh(this.bodyGeometry, this.bodyMaterial);
    body.castShadow = true;
    body.receiveShadow = true;
    body.position.y = 0.68;
    this.group.add(body);

    const nose = new THREE.Mesh(this.noseGeometry, this.accentMaterial);
    nose.castShadow = true;
    nose.position.set(0, 0.68, -0.58);
    // ConeGeometry's tip starts on +Y; rotate it so the tip points along local -Z.
    nose.rotation.x = -Math.PI / 2;
    this.group.add(nose);

    this.presentation = new InterpolatedTransform(this.group);
  }

  update(
    delta: number,
    elapsed: number,
    input: InputController,
    tuning: PlayerTuning,
    bounds: ArenaBounds,
  ): void {
    this.presentation.beginStep();
    input.readMovement(this.move);
    this.targetVelocity
      .set(this.move.x, 0, this.move.y)
      .multiplyScalar(tuning.speed);

    const smoothing = 1 - Math.exp(-tuning.acceleration * delta);
    this.velocity.lerp(this.targetVelocity, smoothing);
    this.group.position.addScaledVector(this.velocity, delta);

    this.group.position.x = THREE.MathUtils.clamp(
      this.group.position.x,
      -bounds.halfWidth + 0.8,
      bounds.halfWidth - 0.8,
    );
    this.group.position.z = THREE.MathUtils.clamp(
      this.group.position.z,
      -bounds.halfDepth + 0.8,
      bounds.halfDepth - 0.8,
    );

    if (this.velocity.lengthSq() > 0.001) {
      // A yaw of -PI / 2 turns local -Z toward world +X (move right).
      this.group.rotation.y = Math.atan2(-this.velocity.x, -this.velocity.z);
    }

    this.group.position.y =
      0.06 + Math.sin(elapsed * 9) * Math.min(this.velocity.length() / 40, 0.08);
    this.presentation.endStep();
  }

  reset(): void {
    this.group.position.set(0, 0.06, 0);
    this.group.rotation.set(0, 0, 0);
    this.velocity.set(0, 0, 0);
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
    this.bodyMaterial.dispose();
    this.accentMaterial.dispose();
  }
}

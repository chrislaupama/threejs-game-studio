import * as THREE from 'three';

/** Keeps authoritative fixed-step transforms separate from rendered poses. */
export class InterpolatedTransform {
  private readonly previousPosition = new THREE.Vector3();
  private readonly currentPosition = new THREE.Vector3();
  private readonly previousQuaternion = new THREE.Quaternion();
  private readonly currentQuaternion = new THREE.Quaternion();
  private readonly previousScale = new THREE.Vector3();
  private readonly currentScale = new THREE.Vector3();

  constructor(private readonly object: THREE.Object3D) {
    this.snap();
  }

  beginStep(): void {
    this.restoreCurrent();
    this.previousPosition.copy(this.currentPosition);
    this.previousQuaternion.copy(this.currentQuaternion);
    this.previousScale.copy(this.currentScale);
  }

  endStep(): void {
    this.currentPosition.copy(this.object.position);
    this.currentQuaternion.copy(this.object.quaternion);
    this.currentScale.copy(this.object.scale);
  }

  present(alpha: number): void {
    const t = THREE.MathUtils.clamp(alpha, 0, 1);
    this.object.position.lerpVectors(
      this.previousPosition,
      this.currentPosition,
      t,
    );
    this.object.quaternion.slerpQuaternions(
      this.previousQuaternion,
      this.currentQuaternion,
      t,
    );
    this.object.scale.lerpVectors(this.previousScale, this.currentScale, t);
  }

  snap(): void {
    this.currentPosition.copy(this.object.position);
    this.currentQuaternion.copy(this.object.quaternion);
    this.currentScale.copy(this.object.scale);
    this.previousPosition.copy(this.currentPosition);
    this.previousQuaternion.copy(this.currentQuaternion);
    this.previousScale.copy(this.currentScale);
  }

  hold(): void {
    this.restoreCurrent();
    this.snap();
  }

  private restoreCurrent(): void {
    this.object.position.copy(this.currentPosition);
    this.object.quaternion.copy(this.currentQuaternion);
    this.object.scale.copy(this.currentScale);
  }
}

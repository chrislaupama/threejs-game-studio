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

  /**
   * Capture the authoritative pose after simulation. Pass `true` when the
   * step teleported/reset the object so presentation does not sweep from the
   * old pose to the new one.
   */
  endStep(discontinuity = false): void {
    this.currentPosition.copy(this.object.position);
    this.currentQuaternion.copy(this.object.quaternion);
    this.currentScale.copy(this.object.scale);
    if (discontinuity) this.collapseHistoryToCurrent();
  }

  present(alpha: number): void {
    const t = Number.isFinite(alpha)
      ? THREE.MathUtils.clamp(alpha, 0, 1)
      : 1;
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
    this.collapseHistoryToCurrent();
  }

  /** Freeze the last authoritative pose without capturing an interpolated pose. */
  hold(): void {
    this.restoreCurrent();
    this.collapseHistoryToCurrent();
  }

  private collapseHistoryToCurrent(): void {
    this.previousPosition.copy(this.currentPosition);
    this.previousQuaternion.copy(this.currentQuaternion);
    this.previousScale.copy(this.currentScale);
  }

  private restoreCurrent(): void {
    this.object.position.copy(this.currentPosition);
    this.object.quaternion.copy(this.currentQuaternion);
    this.object.scale.copy(this.currentScale);
  }
}

import * as THREE from 'three';
import { InterpolatedTransform } from '../utils/InterpolatedTransform';

export class CameraRig {
  private readonly desiredPosition = new THREE.Vector3();
  private readonly lookTarget = new THREE.Vector3();
  private readonly snapLookOffset = new THREE.Vector3(0, 0.4, 0);
  private readonly followLookOffset = new THREE.Vector3(0, 0.35, -1.2);
  private readonly presentation: InterpolatedTransform;

  constructor(
    private readonly camera: THREE.PerspectiveCamera,
    private readonly offset = new THREE.Vector3(0, 9.5, 9.5),
  ) {
    this.presentation = new InterpolatedTransform(camera);
  }

  snapTo(target: THREE.Vector3): void {
    this.desiredPosition.copy(target).add(this.offset);
    this.camera.position.copy(this.desiredPosition);
    this.lookTarget.copy(target).add(this.snapLookOffset);
    this.camera.lookAt(this.lookTarget);
    this.presentation.snap();
  }

  update(delta: number, target: THREE.Vector3, lag: number): void {
    this.presentation.beginStep();
    this.desiredPosition.copy(target).add(this.offset);
    const factor = 1 - Math.exp(-delta / Math.max(0.001, lag));
    this.camera.position.lerp(this.desiredPosition, factor);
    this.lookTarget.copy(target).add(this.followLookOffset);
    this.camera.lookAt(this.lookTarget);
    this.presentation.endStep();
  }

  present(alpha: number): void {
    this.presentation.present(alpha);
  }

  holdPresentation(): void {
    this.presentation.hold();
  }
}

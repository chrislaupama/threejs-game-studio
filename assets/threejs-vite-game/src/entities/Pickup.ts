import * as THREE from 'three';
import { InterpolatedTransform } from '../utils/InterpolatedTransform';

type PickupResources = {
  references: number;
  coreGeometry: THREE.IcosahedronGeometry;
  ringGeometry: THREE.TorusGeometry;
  coreMaterial: THREE.MeshStandardMaterial;
  ringMaterial: THREE.MeshBasicMaterial;
};

let sharedResources: PickupResources | null = null;

function acquireResources(): PickupResources {
  if (!sharedResources) {
    sharedResources = {
      references: 0,
      coreGeometry: new THREE.IcosahedronGeometry(0.42, 1),
      ringGeometry: new THREE.TorusGeometry(0.58, 0.028, 8, 32),
      coreMaterial: new THREE.MeshStandardMaterial({
        color: '#48baa7',
        emissive: '#0f5249',
        emissiveIntensity: 0.8,
        roughness: 0.28,
        metalness: 0.1,
      }),
      ringMaterial: new THREE.MeshBasicMaterial({ color: '#f6f1df' }),
    };
  }
  sharedResources.references += 1;
  return sharedResources;
}

function releaseResources(resources: PickupResources): void {
  if (resources !== sharedResources || resources.references <= 0) return;
  resources.references -= 1;
  if (resources.references > 0) return;
  resources.coreGeometry.dispose();
  resources.ringGeometry.dispose();
  resources.coreMaterial.dispose();
  resources.ringMaterial.dispose();
  sharedResources = null;
}

export class Pickup {
  readonly group = new THREE.Group();
  readonly radius = 0.62;
  active = true;

  private readonly resources = acquireResources();
  private readonly rootPresentation: InterpolatedTransform;
  private readonly corePresentation: InterpolatedTransform;
  private disposed = false;

  constructor(
    readonly index: number,
    position: THREE.Vector3,
  ) {
    const core = new THREE.Mesh(
      this.resources.coreGeometry,
      this.resources.coreMaterial,
    );
    core.castShadow = true;
    this.group.add(core);

    const ring = new THREE.Mesh(
      this.resources.ringGeometry,
      this.resources.ringMaterial,
    );
    ring.rotation.x = Math.PI / 2;
    this.group.add(ring);

    this.group.position.copy(position);
    this.rootPresentation = new InterpolatedTransform(this.group);
    this.corePresentation = new InterpolatedTransform(core);
  }

  update(delta: number, elapsed: number): void {
    if (!this.active) return;
    this.rootPresentation.beginStep();
    this.corePresentation.beginStep();
    this.group.rotation.y += delta * 1.8;
    this.group.children[0].rotation.x -= delta * 1.2;
    this.group.position.y = 0.78 + Math.sin(elapsed * 2.6 + this.index) * 0.16;
    this.rootPresentation.endStep();
    this.corePresentation.endStep();
  }

  collect(): void {
    this.active = false;
    this.group.visible = false;
  }

  reset(rotationY = 0): void {
    this.active = true;
    this.group.visible = true;
    this.group.position.y = 0.78 + Math.sin(this.index) * 0.16;
    this.group.rotation.set(0, rotationY, 0);
    this.group.children[0].rotation.set(0, 0, 0);
    this.rootPresentation.snap();
    this.corePresentation.snap();
  }

  present(alpha: number): void {
    this.rootPresentation.present(alpha);
    this.corePresentation.present(alpha);
  }

  holdPresentation(): void {
    this.rootPresentation.hold();
    this.corePresentation.hold();
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    releaseResources(this.resources);
  }
}

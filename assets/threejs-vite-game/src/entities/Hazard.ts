import * as THREE from 'three';
import { InterpolatedTransform } from '../utils/InterpolatedTransform';

type HazardResources = {
  references: number;
  coreGeometry: THREE.OctahedronGeometry;
  ringGeometry: THREE.TorusGeometry;
  coreMaterial: THREE.MeshStandardMaterial;
  ringMaterial: THREE.MeshBasicMaterial;
};

let sharedResources: HazardResources | null = null;

function acquireResources(): HazardResources {
  if (!sharedResources) {
    sharedResources = {
      references: 0,
      coreGeometry: new THREE.OctahedronGeometry(0.56, 0),
      ringGeometry: new THREE.TorusGeometry(0.82, 0.045, 8, 36),
      coreMaterial: new THREE.MeshStandardMaterial({
        color: '#d94f35',
        emissive: '#6d160d',
        emissiveIntensity: 0.9,
        roughness: 0.38,
        metalness: 0.2,
      }),
      ringMaterial: new THREE.MeshBasicMaterial({ color: '#ff8a66' }),
    };
  }
  sharedResources.references += 1;
  return sharedResources;
}

function releaseResources(resources: HazardResources): void {
  if (resources !== sharedResources || resources.references <= 0) return;
  resources.references -= 1;
  if (resources.references > 0) return;
  resources.coreGeometry.dispose();
  resources.ringGeometry.dispose();
  resources.coreMaterial.dispose();
  resources.ringMaterial.dispose();
  sharedResources = null;
}

export class Hazard {
  readonly group = new THREE.Group();
  readonly radius = 0.72;

  private readonly resources = acquireResources();
  private readonly rootPresentation: InterpolatedTransform;
  private readonly corePresentation: InterpolatedTransform;
  private disposed = false;

  constructor(
    private readonly centerX: number,
    private readonly centerZ: number,
    private readonly travel: number,
    private readonly phase: number,
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
    this.rootPresentation = new InterpolatedTransform(this.group);
    this.corePresentation = new InterpolatedTransform(core);
    this.reset();
  }

  update(delta: number, elapsed: number): void {
    this.rootPresentation.beginStep();
    this.corePresentation.beginStep();
    this.group.position.x = this.centerX + Math.sin(elapsed * 0.78 + this.phase) * this.travel;
    this.group.position.z = this.centerZ + Math.sin(elapsed * 0.42 + this.phase * 1.7) * 0.75;
    this.group.rotation.y += delta * 1.9;
    this.group.children[0].rotation.x += delta * 1.35;
    this.rootPresentation.endStep();
    this.corePresentation.endStep();
  }

  reset(): void {
    this.group.position.set(
      this.centerX + Math.sin(this.phase) * this.travel,
      0.7,
      this.centerZ + Math.sin(this.phase * 1.7) * 0.75,
    );
    this.group.rotation.set(0, 0, 0);
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

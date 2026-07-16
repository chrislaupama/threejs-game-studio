import * as THREE from 'three';

export class Hazard {
  readonly group = new THREE.Group();
  readonly radius = 0.72;

  private readonly coreGeometry = new THREE.OctahedronGeometry(0.56, 0);
  private readonly ringGeometry = new THREE.TorusGeometry(0.82, 0.045, 8, 36);
  private readonly coreMaterial = new THREE.MeshStandardMaterial({
    color: '#d94f35',
    emissive: '#6d160d',
    emissiveIntensity: 0.9,
    roughness: 0.38,
    metalness: 0.2,
  });
  private readonly ringMaterial = new THREE.MeshBasicMaterial({ color: '#ff8a66' });

  constructor(
    private readonly centerX: number,
    private readonly centerZ: number,
    private readonly travel: number,
    private readonly phase: number,
  ) {
    const core = new THREE.Mesh(this.coreGeometry, this.coreMaterial);
    core.castShadow = true;
    this.group.add(core);

    const ring = new THREE.Mesh(this.ringGeometry, this.ringMaterial);
    ring.rotation.x = Math.PI / 2;
    this.group.add(ring);
    this.reset();
  }

  update(delta: number, elapsed: number): void {
    this.group.position.x = this.centerX + Math.sin(elapsed * 0.78 + this.phase) * this.travel;
    this.group.position.z = this.centerZ + Math.sin(elapsed * 0.42 + this.phase * 1.7) * 0.75;
    this.group.rotation.y += delta * 1.9;
    this.group.children[0].rotation.x += delta * 1.35;
  }

  reset(): void {
    this.group.position.set(
      this.centerX + Math.sin(this.phase) * this.travel,
      0.7,
      this.centerZ + Math.sin(this.phase * 1.7) * 0.75,
    );
    this.group.rotation.set(0, 0, 0);
  }

  dispose(): void {
    this.coreGeometry.dispose();
    this.ringGeometry.dispose();
    this.coreMaterial.dispose();
    this.ringMaterial.dispose();
  }
}

import * as THREE from 'three';

export function disposeObject3D(root: THREE.Object3D): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const materials = new Set<THREE.Material>();
  const skeletons = new Set<THREE.Skeleton>();
  const textures = new Set<THREE.Texture>();
  const imageBitmaps = new Set<ImageBitmap>();
  root.traverse((object: THREE.Object3D) => {
    const renderable = object as THREE.Object3D & {
      geometry?: THREE.BufferGeometry;
      material?: THREE.Material | THREE.Material[];
      skeleton?: THREE.Skeleton;
    };
    if (renderable.geometry?.isBufferGeometry) {
      geometries.add(renderable.geometry);
    }
    if (renderable.skeleton instanceof THREE.Skeleton) {
      skeletons.add(renderable.skeleton);
    }

    const owned = Array.isArray(renderable.material)
      ? renderable.material
      : renderable.material
        ? [renderable.material]
        : [];
    for (const material of owned) materials.add(material);
  });
  for (const geometry of geometries) geometry.dispose();
  for (const skeleton of skeletons) skeleton.dispose();
  for (const material of materials) {
    for (const value of Object.values(
      material as unknown as Record<string, unknown>,
    )) {
      if (isThreeTexture(value)) textures.add(value);
    }
    material.dispose();
  }
  for (const texture of textures) {
    texture.dispose();
    const sourceData: unknown = texture.source.data;
    if (
      typeof ImageBitmap !== 'undefined' &&
      sourceData instanceof ImageBitmap
    ) {
      imageBitmaps.add(sourceData);
    }
  }
  for (const imageBitmap of imageBitmaps) imageBitmap.close();
}

function isThreeTexture(value: unknown): value is THREE.Texture {
  return Boolean(value && typeof value === 'object' && (value as { isTexture?: boolean }).isTexture);
}

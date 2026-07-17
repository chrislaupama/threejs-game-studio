import * as THREE from 'three';

type PreservableResource =
  | THREE.BufferGeometry
  | THREE.BatchedMesh
  | THREE.InstancedMesh
  | THREE.Light
  | THREE.Material
  | THREE.Skeleton
  | THREE.Texture;

export type DisposeObject3DOptions = {
  /** Resources in this set are shared or externally owned and remain alive. */
  preserve?: ReadonlySet<PreservableResource>;
  /** Close exclusively owned ImageBitmap sources. Defaults to false. */
  closeImageBitmaps?: boolean;
};

/**
 * Dispose GPU resources exclusively owned by an Object3D subtree.
 *
 * Three.js cannot infer ownership. Put shared resources in `preserve`, and opt
 * into ImageBitmap closure only when no other texture or application uses it.
 * Preserve a BatchedMesh owner (not only its packed geometry) when retaining
 * any of its internally owned GPU resources.
 */
export function disposeObject3D(
  root: THREE.Object3D,
  options: DisposeObject3DOptions = {},
): void {
  const geometries = new Set<THREE.BufferGeometry>();
  const batchedMeshes = new Set<THREE.BatchedMesh>();
  const instancedMeshes = new Set<THREE.InstancedMesh>();
  const lights = new Set<THREE.Light>();
  const materials = new Set<THREE.Material>();
  const skeletons = new Set<THREE.Skeleton>();
  const textures = new Set<THREE.Texture>();
  const imageBitmaps = new Set<ImageBitmap>();
  const visited = new WeakSet<object>();
  root.traverse((object: THREE.Object3D) => {
    if (options.preserve?.has(object as PreservableResource)) return;
    const renderable = object as THREE.Object3D & {
      geometry?: THREE.BufferGeometry;
      isBatchedMesh?: boolean;
      isInstancedMesh?: boolean;
      isLight?: boolean;
      material?: THREE.Material | THREE.Material[];
      skeleton?: THREE.Skeleton;
    };

    if (renderable.isBatchedMesh === true) {
      // BatchedMesh owns and disposes its packed geometry and internal data
      // textures. Do not also add that geometry to the generic set.
      batchedMeshes.add(object as THREE.BatchedMesh);
    } else if (renderable.geometry?.isBufferGeometry) {
      geometries.add(renderable.geometry);
    }
    if (renderable.isInstancedMesh === true) {
      instancedMeshes.add(object as THREE.InstancedMesh);
    }
    if (renderable.isLight === true) lights.add(object as THREE.Light);
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
  for (const batchedMesh of batchedMeshes) batchedMesh.dispose();
  for (const instancedMesh of instancedMeshes) instancedMesh.dispose();
  for (const light of lights) light.dispose();
  for (const geometry of geometries) {
    if (!options.preserve?.has(geometry)) geometry.dispose();
  }
  for (const skeleton of skeletons) {
    if (!options.preserve?.has(skeleton)) skeleton.dispose();
  }
  for (const material of materials) {
    if (options.preserve?.has(material)) continue;
    collectTextures(material, textures, visited);
    material.dispose();
  }
  for (const texture of textures) {
    if (options.preserve?.has(texture)) continue;
    texture.dispose();
    const sourceData: unknown = texture.source.data;
    if (options.closeImageBitmaps === true) {
      collectImageBitmaps(sourceData, imageBitmaps);
    }
  }
  for (const imageBitmap of imageBitmaps) imageBitmap.close();
}

function isThreeTexture(value: unknown): value is THREE.Texture {
  return Boolean(value && typeof value === 'object' && (value as { isTexture?: boolean }).isTexture);
}

function collectTextures(
  value: unknown,
  textures: Set<THREE.Texture>,
  visited: WeakSet<object>,
): void {
  if (isThreeTexture(value)) {
    textures.add(value);
    return;
  }
  if (!value || typeof value !== 'object' || visited.has(value)) return;
  visited.add(value);

  if (Array.isArray(value)) {
    for (const entry of value) collectTextures(entry, textures, visited);
    return;
  }
  if (value instanceof Map || value instanceof Set) {
    for (const entry of value.values()) collectTextures(entry, textures, visited);
    return;
  }

  for (const entry of Object.values(value as Record<string, unknown>)) {
    collectTextures(entry, textures, visited);
  }
}

function collectImageBitmaps(
  value: unknown,
  imageBitmaps: Set<ImageBitmap>,
): void {
  if (typeof ImageBitmap === 'undefined') return;
  if (value instanceof ImageBitmap) {
    imageBitmaps.add(value);
    return;
  }
  if (Array.isArray(value)) {
    for (const entry of value) collectImageBitmaps(entry, imageBitmaps);
  }
}

import * as THREE from 'three';

const currentSize = new THREE.Vector2();
const DEFAULT_MAX_DRAWING_BUFFER_PIXELS = 1920 * 1080;

export function createRenderer(canvas: HTMLCanvasElement): THREE.WebGLRenderer {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    antialias: true,
    alpha: false,
    powerPreference: 'high-performance',
  });
  renderer.setClearColor(0x0b1020, 1);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  return renderer;
}

export function resizeRenderer(
  renderer: THREE.WebGLRenderer,
  camera: THREE.PerspectiveCamera,
  maxDpr = 1.5,
  maxDrawingBufferPixels = DEFAULT_MAX_DRAWING_BUFFER_PIXELS,
): boolean {
  const canvas = renderer.domElement;
  const width = Math.max(1, Math.floor(canvas.clientWidth));
  const height = Math.max(1, Math.floor(canvas.clientHeight));
  const requestedDpr = Math.min(window.devicePixelRatio || 1, maxDpr);
  const budgetDpr = Math.sqrt(
    Math.max(1, maxDrawingBufferPixels) / Math.max(1, width * height),
  );
  const dpr = Math.min(requestedDpr, budgetDpr);
  renderer.getSize(currentSize);
  const needsResize =
    currentSize.x !== width ||
    currentSize.y !== height ||
    renderer.getPixelRatio() !== dpr;

  if (needsResize) {
    renderer.setPixelRatio(dpr);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  }

  return needsResize;
}

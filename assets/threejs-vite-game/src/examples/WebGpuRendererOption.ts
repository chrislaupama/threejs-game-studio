import * as THREE from 'three/webgpu';
import { pass } from 'three/tsl';
import { ClusteredLighting } from 'three/addons/lighting/ClusteredLighting.js';

const FIXED_STEP_SECONDS = 1 / 60;
const MAX_FRAME_DELTA_SECONDS = 0.1;
const MAX_STEPS_PER_FRAME = 5;

export type WebGpuBackendName =
  | 'webgpu'
  | 'webgl2-fallback'
  | 'unknown';

export interface WebGpuRendererOptionConfig {
  canvas: HTMLCanvasElement;
  scene: THREE.Scene;
  camera: THREE.PerspectiveCamera;
  update: (fixedDeltaSeconds: number) => void;
  present?: (interpolationAlpha: number) => void;
  forceWebGL?: boolean;
  useClusteredLighting?: boolean;
  lowBandwidthOutput?: boolean;
  maxDevicePixelRatio?: number;
  maxDrawingBufferPixels?: number;
  onBackendError?: (message: string) => void;
  onDeviceLost?: (message: string) => void;
}

export interface WebGpuRendererStats {
  backend: WebGpuBackendName;
  drawCalls: number;
  triangles: number;
  computeCalls: number;
  geometries: number;
  textures: number;
  textureBytes: number;
  renderTargets: number;
  totalTrackedBytes: number;
}

export function getWebGpuBackendName(
  renderer: THREE.WebGPURenderer,
): WebGpuBackendName {
  const backend = renderer.backend;
  if ('isWebGPUBackend' in backend && backend.isWebGPUBackend === true) {
    return 'webgpu';
  }
  if ('isWebGLBackend' in backend && backend.isWebGLBackend === true) {
    return 'webgl2-fallback';
  }
  return 'unknown';
}

function backendErrorMessage(error: unknown): string {
  if (typeof error === 'string') return error;
  if (error && typeof error === 'object') {
    const detail = error as {
      api?: unknown;
      type?: unknown;
      message?: unknown;
    };
    const tags = [detail.api, detail.type]
      .filter((value): value is string => typeof value === 'string')
      .join('/');
    const message = typeof detail.message === 'string'
      ? detail.message
      : 'Unknown backend error';
    return tags ? `${tags}: ${message}` : message;
  }
  return String(error);
}

/**
 * Optional r185 WebGPU renderer family for a new project that has committed to
 * node materials/TSL. It is intentionally not wired into the WebGL starter at
 * runtime: choose one renderer family at boot instead of mixing GPU objects.
 */
export class WebGpuRendererOption {
  readonly renderer: THREE.WebGPURenderer;
  readonly pipeline: THREE.RenderPipeline;

  private readonly timer = new THREE.Timer();
  private readonly scenePass: ReturnType<typeof pass>;
  private readonly maxDevicePixelRatio: number;
  private readonly maxDrawingBufferPixels: number;
  private accumulator = 0;
  private running = false;
  private disposed = false;
  private lastWidth = 0;
  private lastHeight = 0;
  private lastDevicePixelRatio = 0;

  private constructor(private readonly config: WebGpuRendererOptionConfig) {
    this.renderer = new THREE.WebGPURenderer({
      canvas: config.canvas,
      antialias: true,
      alpha: false,
      depth: true,
      stencil: false,
      forceWebGL: config.forceWebGL ?? false,
      powerPreference: 'high-performance',
      outputBufferType: config.lowBandwidthOutput
        ? THREE.UnsignedByteType
        : THREE.HalfFloatType,
    });

    if (config.useClusteredLighting) {
      this.renderer.lighting = new ClusteredLighting();
    }

    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1;
    this.renderer.onError = (error) => {
      const message = backendErrorMessage(error);
      config.onBackendError?.(message);
      console.error(`Three.js backend error: ${message}`);
    };
    const defaultDeviceLost = this.renderer.onDeviceLost.bind(this.renderer);
    this.renderer.onDeviceLost = (info) => {
      defaultDeviceLost(info);
      this.stop();
      const message = `${info.api} device/context lost: ${info.message}`;
      config.onDeviceLost?.(message);
      console.error(message);
    };

    this.scenePass = pass(config.scene, config.camera);
    this.pipeline = new THREE.RenderPipeline(this.renderer);
    this.pipeline.outputNode = this.scenePass;
    this.maxDevicePixelRatio = Math.max(
      0.5,
      config.maxDevicePixelRatio ?? 1.5,
    );
    this.maxDrawingBufferPixels = Math.max(
      1,
      config.maxDrawingBufferPixels ?? 1920 * 1080,
    );
    this.timer.connect(document);
  }

  static async create(
    config: WebGpuRendererOptionConfig,
  ): Promise<WebGpuRendererOption> {
    const option = new WebGpuRendererOption(config);
    try {
      await option.renderer.init();
      option.resize();
      return option;
    } catch (error) {
      option.disposeAfterFailedInitialization();
      throw error;
    }
  }

  get backend(): WebGpuBackendName {
    return getWebGpuBackendName(this.renderer);
  }

  start(): void {
    this.assertUsable();
    if (this.running) return;
    this.running = true;
    this.accumulator = 0;
    this.timer.reset();
    void this.renderer.setAnimationLoop(this.tick);
  }

  stop(): void {
    this.running = false;
    void this.renderer.setAnimationLoop(null);
  }

  resize(): void {
    this.assertUsable();
    const { canvas } = this.config;
    const width = Math.max(1, Math.floor(canvas.clientWidth));
    const height = Math.max(1, Math.floor(canvas.clientHeight));
    const requestedDevicePixelRatio = Math.min(
      window.devicePixelRatio || 1,
      this.maxDevicePixelRatio,
    );
    const budgetDevicePixelRatio = Math.sqrt(
      this.maxDrawingBufferPixels / Math.max(1, width * height),
    );
    const devicePixelRatio = Math.min(
      requestedDevicePixelRatio,
      budgetDevicePixelRatio,
    );
    if (
      width === this.lastWidth &&
      height === this.lastHeight &&
      devicePixelRatio === this.lastDevicePixelRatio
    ) return;

    this.lastWidth = width;
    this.lastHeight = height;
    this.lastDevicePixelRatio = devicePixelRatio;
    this.renderer.setPixelRatio(devicePixelRatio);
    this.renderer.setSize(width, height, false);
    this.config.camera.aspect = width / height;
    this.config.camera.updateProjectionMatrix();
  }

  readStats(): WebGpuRendererStats {
    const { render, compute, memory } = this.renderer.info;
    return {
      backend: getWebGpuBackendName(this.renderer),
      drawCalls: render.drawCalls,
      triangles: render.triangles,
      computeCalls: compute.frameCalls,
      geometries: memory.geometries,
      textures: memory.textures,
      textureBytes: memory.texturesSize,
      renderTargets: memory.renderTargets,
      totalTrackedBytes: memory.total,
    };
  }

  dispose(): void {
    if (this.disposed) return;
    this.stop();
    this.timer.dispose();
    this.pipeline.dispose();
    this.scenePass.dispose();
    this.renderer.dispose();
    this.disposed = true;
  }

  private readonly tick = (timestamp: number) => {
    if (!this.running || this.disposed) return;
    this.timer.update(timestamp);
    this.accumulator += Math.min(
      this.timer.getDelta(),
      MAX_FRAME_DELTA_SECONDS,
    );

    let steps = 0;
    while (
      this.accumulator >= FIXED_STEP_SECONDS &&
      steps < MAX_STEPS_PER_FRAME
    ) {
      this.config.update(FIXED_STEP_SECONDS);
      this.accumulator -= FIXED_STEP_SECONDS;
      steps += 1;
    }

    if (
      steps === MAX_STEPS_PER_FRAME &&
      this.accumulator >= FIXED_STEP_SECONDS
    ) {
      this.accumulator = 0;
    }

    this.resize();
    this.config.present?.(
      THREE.MathUtils.clamp(this.accumulator / FIXED_STEP_SECONDS, 0, 1),
    );

    if (this.renderer.xr.isPresenting) {
      // r185 RenderPipeline temporarily disables XR while it renders. Keep
      // headset presentation correct and omit desktop post for the XR frame.
      this.renderer.render(this.config.scene, this.config.camera);
    } else {
      this.pipeline.render();
    }
  };

  private assertUsable(): void {
    if (this.disposed) {
      throw new Error('WebGpuRendererOption is already disposed');
    }
  }

  private disposeAfterFailedInitialization(): void {
    this.timer.dispose();
    this.pipeline.dispose();
    this.scenePass.dispose();
    this.disposed = true;
  }
}

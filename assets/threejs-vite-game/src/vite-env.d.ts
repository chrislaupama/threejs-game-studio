/// <reference types="vite/client" />

interface ImportMetaEnv {
  /**
   * Build-time, non-secret opt-in for diagnostics, deterministic test hooks,
   * and the `?debug` tuning panel outside Vite development mode.
   */
  readonly VITE_ENABLE_GAME_DIAGNOSTICS?: 'true' | 'false';
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

interface ThreeGameDiagnostics {
  frame: number;
  elapsed: number;
  timeRemaining: number;
  state: 'playing' | 'paused' | 'won' | 'lost';
  score: number;
  targetScore: number;
  complete: boolean;
  hazards: number;
  player: {
    position: { x: number; y: number; z: number };
    speed: number;
  };
  renderer: {
    revision: string;
    type: 'WebGLRenderer';
    backend: 'webgl' | 'webgpu';
    toneMapping: string;
    toneMappingExposure: number;
    calls: number;
    triangles: number;
    geometries: number;
    textures: number;
    dpr: number;
  };
  camera: {
    aspect: number;
  };
  canvas: {
    clientWidth: number;
    clientHeight: number;
    width: number;
    height: number;
    dpr: number;
  };
}

interface ThreeGameTestHooks {
  /** Re-seed the game RNG; all gameplay randomness must flow through it. */
  seed(value: number): boolean;
  /** Jump to a named state for baselines: active-play, paused, complete, or failed. */
  setState(name: string): boolean;
  /** Freeze the simulation while continuing to render the current frame. */
  setPausedForScreenshot(paused: boolean): void;
  /** Freeze ambient/idle animation time so screenshots are stable. */
  setReducedMotion(enabled: boolean): void;
  /** Hide the built-in local debug panel before capturing. */
  hideDebugUi(hidden: boolean): void;
}

interface Window {
  __THREE_GAME_DIAGNOSTICS__?: ThreeGameDiagnostics;
  __THREE_GAME_TEST_HOOKS__?: ThreeGameTestHooks;
}

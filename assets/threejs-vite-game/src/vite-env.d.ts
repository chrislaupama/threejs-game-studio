/// <reference types="vite/client" />

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
    calls: number;
    triangles: number;
    geometries: number;
    textures: number;
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
  seed(value: number): void;
  /** Jump to a named state for baselines: active-play, paused, complete, or failed. */
  setState(name: string): void;
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

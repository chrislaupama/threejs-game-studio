import * as THREE from 'three';

const FIXED_STEP_SECONDS = 1 / 60;
const MAX_FRAME_DELTA_SECONDS = 0.1;
// The cap covers the complete accepted frame delta. Coupling these constants
// prevents a slow frame from silently discarding valid simulation time.
const MAX_STEPS_PER_FRAME = Math.ceil(
  MAX_FRAME_DELTA_SECONDS / FIXED_STEP_SECONDS,
);

export class Loop {
  private readonly timer = new THREE.Timer();
  private running = false;
  private accumulator = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly update: (fixedDeltaSeconds: number) => boolean | void,
    private readonly render: (interpolationAlpha: number) => void,
  ) {
    this.timer.connect(document);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.accumulator = 0;
    this.timer.reset();
    this.renderer.setAnimationLoop(this.tick);
  }

  get isRunning(): boolean {
    return this.running;
  }

  stop(): void {
    this.running = false;
    this.renderer.setAnimationLoop(null);
  }

  dispose(): void {
    this.stop();
    this.timer.dispose();
  }

  private readonly tick = (time: number) => {
    if (!this.running) return;
    this.timer.update(time);
    this.accumulator += Math.min(
      this.timer.getDelta(),
      MAX_FRAME_DELTA_SECONDS,
    );

    let steps = 0;
    while (
      this.accumulator >= FIXED_STEP_SECONDS &&
      steps < MAX_STEPS_PER_FRAME
    ) {
      const discontinuity = this.update(FIXED_STEP_SECONDS) === true;
      this.accumulator -= FIXED_STEP_SECONDS;
      steps += 1;
      if (discontinuity) {
        this.accumulator = 0;
        break;
      }
    }

    this.render(
      THREE.MathUtils.clamp(this.accumulator / FIXED_STEP_SECONDS, 0, 1),
    );
  };
}

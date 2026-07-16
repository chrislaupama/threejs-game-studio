import * as THREE from 'three';

const FIXED_STEP_SECONDS = 1 / 60;
const MAX_FRAME_DELTA_SECONDS = 0.1;
const MAX_STEPS_PER_FRAME = 5;

export class Loop {
  private readonly timer = new THREE.Timer();
  private running = false;
  private accumulator = 0;

  constructor(
    private readonly renderer: THREE.WebGLRenderer,
    private readonly update: (fixedDeltaSeconds: number) => void,
    private readonly render: () => void,
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
      this.update(FIXED_STEP_SECONDS);
      this.accumulator -= FIXED_STEP_SECONDS;
      steps += 1;
    }

    if (
      steps === MAX_STEPS_PER_FRAME &&
      this.accumulator >= FIXED_STEP_SECONDS
    ) {
      this.accumulator = 0;
    }
    this.render();
  };
}

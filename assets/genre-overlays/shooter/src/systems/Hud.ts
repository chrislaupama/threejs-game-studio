export type GameState = 'playing' | 'paused' | 'won' | 'lost';

export class Hud {
  private readonly targetsMetric = this.getElement('#targets-metric');
  private readonly healthMetric = this.getElement('#health-metric');
  private readonly waveMetric = this.getElement('#wave-metric');
  private readonly scoreValue = this.getElement('#score-value');
  private readonly targetValue = this.getElement('#target-value');
  private readonly healthValue = this.getElement('#health-value');
  private readonly maxHealthValue = this.getElement('#max-health-value');
  private readonly waveValue = this.getElement('#wave-value');
  private readonly totalWavesValue = this.getElement('#total-waves-value');
  private readonly timerValue = this.getElement('#timer-value');
  private readonly statusLine = this.getElement('#status-line');
  private readonly statePanel = this.getElement('#state-panel');
  private readonly stateTitle = this.getElement('#state-title');
  private readonly stateCopy = this.getElement('#state-copy');
  private readonly retryButton = this.getElement<HTMLButtonElement>('#retry-button');
  private readonly pauseButton = this.getElement<HTMLButtonElement>('#pause-button');

  update(
    score: number,
    target: number,
    health: number,
    maxHealth: number,
    wave: number,
    totalWaves: number,
    elapsed: number,
    timeLimit: number,
    state: GameState,
  ): void {
    const targetsRemaining = Math.max(0, target - score);
    const remaining = Math.max(0, timeLimit - elapsed);
    this.setText(this.scoreValue, String(score));
    this.setText(this.targetValue, String(target));
    this.setText(this.healthValue, String(health));
    this.setText(this.maxHealthValue, String(maxHealth));
    this.setText(this.waveValue, String(wave));
    this.setText(this.totalWavesValue, String(totalWaves));
    this.setText(this.timerValue, `${Math.ceil(remaining)}s`);

    this.targetsMetric.setAttribute(
      'aria-label',
      `${score} of ${target} targets neutralized; ${targetsRemaining} remaining`,
    );
    this.healthMetric.setAttribute('aria-label', `Hull integrity ${health} of ${maxHealth}`);
    this.waveMetric.setAttribute('aria-label', `Wave ${wave} of ${totalWaves}`);

    this.setText(this.pauseButton, state === 'paused' ? 'Resume' : 'Pause');
    this.pauseButton.setAttribute('aria-pressed', String(state === 'paused'));
    this.pauseButton.disabled = state === 'won' || state === 'lost';
    this.statePanel.hidden = state === 'playing';
    this.retryButton.hidden = !(state === 'won' || state === 'lost');

    if (state === 'won') {
      this.setText(this.statusLine, `Sector clear · Wave ${wave} secured`);
      this.setText(this.stateTitle, 'Wave secured');
      this.setText(
        this.stateCopy,
        `All ${target} targets neutralized. Redeploy and beat your clear time.`,
      );
    } else if (state === 'lost') {
      const hullBreached = health <= 0;
      this.setText(this.statusLine, hullBreached ? 'Hull breached' : 'Time expired');
      this.setText(this.stateTitle, hullBreached ? 'Ship down' : 'Sector lost');
      this.setText(
        this.stateCopy,
        hullBreached
          ? 'Keep moving, preserve your hull, and fire along your facing direction.'
          : 'Neutralize every target before the mission clock reaches zero.',
      );
    } else if (state === 'paused') {
      this.setText(this.statusLine, `Wave ${wave} paused · ${targetsRemaining} targets remain`);
      // Preserve the scaffold's cross-genre pause-state assertion.
      this.setText(this.stateTitle, 'Game paused');
      this.setText(this.stateCopy, 'Press P, Escape, or Resume to return to the fight.');
    } else {
      this.setText(
        this.statusLine,
        `Wave ${wave} · ${targetsRemaining} targets remain · Hold Fire`,
      );
    }
  }

  flashPickup(): void {
    this.statusLine.animate(
      [{ borderLeftColor: '#f5ba49' }, { borderLeftColor: '#48baa7' }, { borderLeftColor: '#f5ba49' }],
      { duration: 160, easing: 'ease-out' },
    );
  }

  private getElement<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Missing HUD element: ${selector}`);
    return element;
  }

  private setText(element: HTMLElement, value: string): void {
    if (element.textContent !== value) element.textContent = value;
  }
}

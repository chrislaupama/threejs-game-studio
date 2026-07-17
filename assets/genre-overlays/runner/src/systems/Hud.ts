export type GameState = 'playing' | 'paused' | 'won' | 'lost';

export class Hud {
  private readonly scoreValue = this.getElement('#score-value');
  private readonly targetValue = this.getElement('#target-value');
  private readonly timerValue = this.getElement('#timer-value');
  private readonly statusLine = this.getElement('#status-line');
  private readonly statePanel = this.getElement('#state-panel');
  private readonly stateTitle = this.getElement('#state-title');
  private readonly stateCopy = this.getElement('#state-copy');
  private readonly retryButton = this.getElement<HTMLButtonElement>('#retry-button');
  private readonly pauseButton = this.getElement<HTMLButtonElement>('#pause-button');

  update(score: number, target: number, elapsed: number, _timeLimit: number, state: GameState): void {
    this.scoreValue.textContent = String(score);
    this.targetValue.textContent = String(target);
    this.timerValue.textContent = `${elapsed.toFixed(1)}s`;

    this.pauseButton.textContent = state === 'paused' ? 'Resume' : 'Pause';
    this.pauseButton.setAttribute('aria-pressed', String(state === 'paused'));
    this.pauseButton.disabled = state === 'won' || state === 'lost';

    const terminal = state === 'won' || state === 'lost';
    this.statePanel.hidden = state === 'playing';
    this.retryButton.hidden = !terminal;

    if (state === 'won') {
      this.statusLine.textContent = 'Run cleared';
      this.stateTitle.textContent = 'Distance locked';
      this.stateCopy.textContent = 'You held the lane to the finish. Run again for a cleaner line.';
    } else if (state === 'lost') {
      this.statusLine.textContent = 'Wrecked';
      this.stateTitle.textContent = 'Obstacle hit';
      this.stateCopy.textContent = 'Steer between crates and dash for speed. Press retry.';
    } else if (state === 'paused') {
      this.statusLine.textContent = 'Paused';
      this.stateTitle.textContent = 'Game paused';
      this.stateCopy.textContent = 'Press P or Escape to resume.';
    } else {
      this.statusLine.textContent = 'Endless runner · dodge · reach distance';
    }
  }

  flashPickup(): void {
    this.statusLine.animate(
      [{ borderLeftColor: '#f5ba49' }, { borderLeftColor: '#48baa7' }, { borderLeftColor: '#f5ba49' }],
      { duration: 180, easing: 'ease-out' },
    );
  }

  private getElement<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Missing HUD element: ${selector}`);
    return element;
  }
}

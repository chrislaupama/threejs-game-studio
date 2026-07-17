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
    this.statePanel.hidden = state === 'playing';
    this.retryButton.hidden = !(state === 'won' || state === 'lost');

    if (state === 'won') {
      this.statusLine.textContent = 'Flag reached';
      this.stateTitle.textContent = 'Course clear';
      this.stateCopy.textContent = 'Jump with dash/Space. Try a cleaner route next run.';
    } else if (state === 'lost') {
      this.statusLine.textContent = 'Fell';
      this.stateTitle.textContent = 'Off the platforms';
      this.stateCopy.textContent = 'Land on pads and reach the flag without falling.';
    } else if (state === 'paused') {
      this.statusLine.textContent = 'Paused';
      this.stateTitle.textContent = 'Game paused';
      this.stateCopy.textContent = 'Press P or Escape to resume.';
    } else {
      this.statusLine.textContent = 'Platformer · jump · reach the flag';
    }
  }

  flashPickup(): void {}

  private getElement<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Missing HUD element: ${selector}`);
    return element;
  }
}

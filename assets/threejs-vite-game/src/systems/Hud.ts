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

  update(score: number, target: number, elapsed: number, timeLimit: number, state: GameState): void {
    this.scoreValue.textContent = String(score);
    this.targetValue.textContent = String(target);
    const remaining = Math.max(0, timeLimit - elapsed);
    const minutes = Math.floor(remaining / 60).toString().padStart(2, '0');
    const seconds = Math.ceil(remaining % 60).toString().padStart(2, '0');
    this.timerValue.textContent = `${minutes}:${seconds}`;

    this.pauseButton.textContent = state === 'paused' ? 'Resume' : 'Pause';
    this.pauseButton.setAttribute('aria-pressed', String(state === 'paused'));
    this.pauseButton.disabled = state === 'won' || state === 'lost';

    const terminal = state === 'won' || state === 'lost';
    this.statePanel.hidden = state === 'playing';
    this.retryButton.hidden = !terminal;

    if (state === 'won') {
      this.statusLine.textContent = 'Relay grid online';
      this.stateTitle.textContent = 'Grid restored';
      this.stateCopy.textContent = 'All relays linked. Run it again and beat your time.';
    } else if (state === 'lost') {
      this.statusLine.textContent = 'Signal lost';
      this.stateTitle.textContent = 'Run interrupted';
      this.stateCopy.textContent = 'Avoid the sweepers and restore every relay before time expires.';
    } else if (state === 'paused') {
      this.statusLine.textContent = 'Paused';
      this.stateTitle.textContent = 'Game paused';
      this.stateCopy.textContent = 'Press P or Escape to resume.';
    } else {
      this.statusLine.textContent = 'Collect relays · avoid sweepers';
    }
  }

  flashPickup(): void {
    this.statusLine.animate(
      [
        { transform: 'translateY(0)', borderLeftColor: '#f5ba49' },
        { transform: 'translateY(-3px)', borderLeftColor: '#48baa7' },
        { transform: 'translateY(0)', borderLeftColor: '#f5ba49' },
      ],
      { duration: 220, easing: 'ease-out' },
    );
  }

  private getElement<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Missing HUD element: ${selector}`);
    return element;
  }
}

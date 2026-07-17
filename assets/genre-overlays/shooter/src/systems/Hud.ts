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
    this.timerValue.textContent = `${Math.ceil(remaining)}s`;

    this.pauseButton.textContent = state === 'paused' ? 'Resume' : 'Pause';
    this.pauseButton.setAttribute('aria-pressed', String(state === 'paused'));
    this.pauseButton.disabled = state === 'won' || state === 'lost';
    this.statePanel.hidden = state === 'playing';
    this.retryButton.hidden = !(state === 'won' || state === 'lost');

    if (state === 'won') {
      this.statusLine.textContent = 'Sector cleared';
      this.stateTitle.textContent = 'All hostiles down';
      this.stateCopy.textContent = 'Move, aim with facing, fire with dash/Space. Try a faster clear.';
    } else if (state === 'lost') {
      this.statusLine.textContent = 'Downed';
      this.stateTitle.textContent = 'Run failed';
      this.stateCopy.textContent = 'Avoid contact and clear every target before time expires.';
    } else if (state === 'paused') {
      this.statusLine.textContent = 'Paused';
      this.stateTitle.textContent = 'Game paused';
      this.stateCopy.textContent = 'Press P or Escape to resume.';
    } else {
      this.statusLine.textContent = 'Shooter · move · fire · clear targets';
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
}

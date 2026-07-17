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
    this.timerValue.textContent = this.formatElapsed(elapsed);
    this.pauseButton.textContent = state === 'paused' ? 'Resume' : 'Pause';
    this.pauseButton.setAttribute('aria-pressed', String(state === 'paused'));
    this.pauseButton.disabled = state === 'won' || state === 'lost';
    this.statePanel.hidden = state === 'playing';
    this.retryButton.hidden = !(state === 'won' || state === 'lost');

    if (state === 'won') {
      this.statusLine.textContent = 'Summit flag reached';
      this.stateTitle.textContent = 'Course clear';
      this.stateCopy.textContent = `Finished in ${this.formatElapsed(elapsed)}. Try for a cleaner line.`;
    } else if (state === 'lost') {
      this.statusLine.textContent = 'Run ended · you fell';
      this.stateTitle.textContent = 'Missed the landing';
      this.stateCopy.textContent = 'Use short direction changes in the air, then jump again after landing.';
    } else if (state === 'paused') {
      this.statusLine.textContent = 'Paused';
      this.stateTitle.textContent = 'Game paused';
      this.stateCopy.textContent = 'Press P or Escape to resume.';
    } else {
      this.statusLine.textContent = 'Run and jump · reach the summit flag';
    }
  }

  flashPickup(): void {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    this.statusLine.animate(
      [
        { transform: 'translateY(0) scale(1)', borderLeftColor: '#f5ba49' },
        { transform: 'translateY(-3px) scale(1.02)', borderLeftColor: '#48baa7' },
        { transform: 'translateY(0) scale(1)', borderLeftColor: '#f5ba49' },
      ],
      { duration: 240, easing: 'ease-out' },
    );
  }

  private formatElapsed(elapsed: number): string {
    const totalTenths = Math.max(0, Math.floor(elapsed * 10));
    const minutes = Math.floor(totalTenths / 600).toString().padStart(2, '0');
    const seconds = Math.floor((totalTenths % 600) / 10).toString().padStart(2, '0');
    return `${minutes}:${seconds}.${totalTenths % 10}`;
  }

  private getElement<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Missing HUD element: ${selector}`);
    return element;
  }
}

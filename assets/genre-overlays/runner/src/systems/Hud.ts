export type GameState = 'playing' | 'paused' | 'won' | 'lost';

export class Hud {
  private readonly scoreValue = this.getElement('#score-value');
  private readonly targetValue = this.getElement('#target-value');
  private readonly timerValue = this.getElement('#timer-value');
  private readonly paceValue = this.getElement('#pace-value');
  private readonly statusLine = this.getElement('#status-line');
  private readonly statePanel = this.getElement('#state-panel');
  private readonly stateTitle = this.getElement('#state-title');
  private readonly stateCopy = this.getElement('#state-copy');
  private readonly retryButton = this.getElement<HTMLButtonElement>('#retry-button');
  private readonly pauseButton = this.getElement<HTMLButtonElement>('#pause-button');

  update(
    score: number,
    target: number,
    elapsed: number,
    _timeLimit: number,
    state: GameState,
    speed: number,
    boosting: boolean,
    startDelayRemaining: number,
  ): void {
    this.setText(this.scoreValue, String(Math.min(score, target)));
    this.setText(this.targetValue, String(target));
    this.setText(this.timerValue, `${elapsed.toFixed(1)} s`);
    this.setText(this.paceValue, `${Math.round(speed)} m/s`);
    const boostState = String(boosting);
    if (this.paceValue.dataset.boosting !== boostState) {
      this.paceValue.dataset.boosting = boostState;
    }

    this.setText(this.pauseButton, state === 'paused' ? 'Resume' : 'Pause');
    this.pauseButton.setAttribute('aria-pressed', String(state === 'paused'));
    this.pauseButton.disabled = state === 'won' || state === 'lost';

    const terminal = state === 'won' || state === 'lost';
    this.statePanel.hidden = state === 'playing';
    this.retryButton.hidden = !terminal;

    if (state === 'won') {
      this.setText(this.statusLine, 'Sprint complete');
      this.setText(this.stateTitle, 'Finish line crossed');
      this.setText(
        this.stateCopy,
        'You cleared 120 metres. Sprint again for a faster, cleaner line.',
      );
    } else if (state === 'lost') {
      this.setText(this.statusLine, 'Impact detected');
      this.setText(this.stateTitle, 'Runner down');
      this.setText(
        this.stateCopy,
        'Read the open lane, steer clear of barriers, then boost through safe gaps.',
      );
    } else if (state === 'paused') {
      this.setText(this.statusLine, 'Paused');
      this.setText(this.stateTitle, 'Game paused');
      this.setText(this.stateCopy, 'Press P or Escape to resume.');
    } else if (startDelayRemaining > 0) {
      this.setText(this.statusLine, 'Ready · choose your opening lane');
    } else if (boosting) {
      this.setText(this.statusLine, 'Boost engaged · hold your line');
    } else {
      this.setText(this.statusLine, 'Steer · dodge · reach 120 m');
    }
  }

  private setText(element: HTMLElement, value: string): void {
    if (element.textContent !== value) element.textContent = value;
  }

  private getElement<T extends HTMLElement = HTMLElement>(selector: string): T {
    const element = document.querySelector<T>(selector);
    if (!element) throw new Error(`Missing HUD element: ${selector}`);
    return element;
  }
}

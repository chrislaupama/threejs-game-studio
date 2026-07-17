import type { PlayerTuning } from '../entities/Player';

export type DebugTuning = PlayerTuning & {
  cameraLag: number;
  exposure: number;
  maxDpr: number;
};

type NumericKey = keyof DebugTuning;

const CONTROLS: Array<{ key: NumericKey; min: number; max: number; step: number }> = [
  { key: 'speed', min: 2, max: 14, step: 0.1 },
  { key: 'dashMultiplier', min: 1, max: 3, step: 0.05 },
  { key: 'acceleration', min: 4, max: 22, step: 0.1 },
  { key: 'cameraLag', min: 0.02, max: 0.8, step: 0.01 },
  { key: 'maxDpr', min: 0.75, max: 2, step: 0.25 },
  { key: 'exposure', min: 0.6, max: 1.8, step: 0.01 },
];

const ENABLE_GAME_DIAGNOSTICS =
  import.meta.env.DEV ||
  import.meta.env.VITE_ENABLE_GAME_DIAGNOSTICS === 'true';

export class DebugTools {
  private panel: HTMLElement | null = null;

  constructor(tuning: DebugTuning, onChange: () => void) {
    if (
      !ENABLE_GAME_DIAGNOSTICS ||
      !new URLSearchParams(window.location.search).has('debug')
    ) return;

    const panel = document.createElement('aside');
    panel.className = 'debug-panel';
    panel.setAttribute('aria-label', 'Local game tuning');
    const title = document.createElement('strong');
    title.textContent = 'Game tuning';
    panel.append(title);

    for (const control of CONTROLS) {
      const label = document.createElement('label');
      const name = document.createElement('span');
      const value = document.createElement('output');
      const input = document.createElement('input');
      name.textContent = control.key;
      value.textContent = String(tuning[control.key]);
      input.type = 'range';
      input.min = String(control.min);
      input.max = String(control.max);
      input.step = String(control.step);
      input.value = String(tuning[control.key]);
      input.addEventListener('input', () => {
        tuning[control.key] = Number(input.value);
        value.textContent = input.value;
        onChange();
      });
      label.append(name, value, input);
      panel.append(label);
    }

    document.body.append(panel);
    this.panel = panel;
  }

  setHidden(hidden: boolean): void {
    if (this.panel) this.panel.hidden = hidden;
  }

  dispose(): void {
    this.panel?.remove();
    this.panel = null;
  }
}

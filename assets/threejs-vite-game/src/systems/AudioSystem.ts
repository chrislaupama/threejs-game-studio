export class AudioSystem {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private ui: GainNode | null = null;
  private muteButton: HTMLButtonElement | null = null;
  private readonly voices: Array<{ oscillator: OscillatorNode; gain: GainNode }> = [];
  private unlocked = false;
  private muted = false;
  private unavailable = false;

  private readonly onUnlock = () => {
    void this.unlock().catch(() => {
      this.unavailable = true;
      this.cleanupGraph();
      this.syncMuteUi();
    });
  };

  private readonly onMuteClick = () => {
    this.setMuted(!this.muted);
  };

  constructor() {
    window.addEventListener('pointerdown', this.onUnlock, { once: true });
    window.addEventListener('keydown', this.onUnlock, { once: true });
  }

  async unlock(): Promise<void> {
    if (this.unlocked) return;
    const AudioContextClass =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextClass) throw new Error('Web Audio is unavailable.');
    this.context = new AudioContextClass();
    this.master = this.context.createGain();
    this.sfx = this.context.createGain();
    this.ui = this.context.createGain();
    this.master.gain.value = this.muted ? 0 : 0.72;
    this.sfx.connect(this.master);
    this.ui.connect(this.master);
    this.master.connect(this.context.destination);
    await this.context.resume();
    this.unlocked = true;
  }

  pickup(index: number): void {
    this.tone(320 + index * 22, 680 + index * 24, 0.18, 'triangle', 0.08);
  }

  win(): void {
    this.tone(420, 880, 0.42, 'sine', 0.1);
  }

  fail(): void {
    this.tone(180, 62, 0.36, 'sawtooth', 0.075);
  }

  bindMuteButton(button: HTMLButtonElement): void {
    this.muteButton?.removeEventListener('click', this.onMuteClick);
    this.muteButton = button;
    this.muteButton.addEventListener('click', this.onMuteClick);
    this.syncMuteUi();
  }

  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master && this.context) {
      this.master.gain.setTargetAtTime(muted ? 0 : 0.72, this.context.currentTime, 0.015);
    }
    this.syncMuteUi();
  }

  dispose(): void {
    window.removeEventListener('pointerdown', this.onUnlock);
    window.removeEventListener('keydown', this.onUnlock);
    this.muteButton?.removeEventListener('click', this.onMuteClick);
    for (const voice of this.voices.splice(0)) {
      try {
        voice.oscillator.stop();
      } catch {
        // A voice that already ended needs no further action.
      }
      voice.oscillator.disconnect();
      voice.gain.disconnect();
    }
    this.cleanupGraph();
    this.muteButton = null;
    this.unlocked = false;
  }

  private cleanupGraph(): void {
    this.sfx?.disconnect();
    this.ui?.disconnect();
    this.master?.disconnect();
    void this.context?.close();
    this.master = null;
    this.sfx = null;
    this.ui = null;
    this.context = null;
  }

  private tone(start: number, end: number, duration: number, type: OscillatorType, volume: number): void {
    if (!this.context || !this.sfx || this.context.state !== 'running') return;
    if (this.voices.length >= 12) {
      const oldest = this.voices.shift();
      if (oldest) {
        try {
          oldest.oscillator.stop();
        } catch {
          // It may have ended between the length check and cleanup.
        }
      }
    }
    const oscillator = this.context.createOscillator();
    const gain = this.context.createGain();
    const now = this.context.currentTime;
    oscillator.type = type;
    oscillator.frequency.setValueAtTime(start, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(1, end), now + duration * 0.72);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(volume, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
    oscillator.connect(gain).connect(this.sfx);
    const voice = { oscillator, gain };
    this.voices.push(voice);
    oscillator.addEventListener('ended', () => {
      const index = this.voices.indexOf(voice);
      if (index >= 0) this.voices.splice(index, 1);
      oscillator.disconnect();
      gain.disconnect();
    }, { once: true });
    oscillator.start(now);
    oscillator.stop(now + duration + 0.02);
  }

  private syncMuteUi(): void {
    if (!this.muteButton) return;
    if (this.unavailable) {
      this.muteButton.textContent = 'Sound unavailable';
      this.muteButton.disabled = true;
      return;
    }
    this.muteButton.disabled = false;
    this.muteButton.textContent = this.muted ? 'Sound off' : 'Sound on';
    this.muteButton.setAttribute('aria-pressed', String(this.muted));
  }
}

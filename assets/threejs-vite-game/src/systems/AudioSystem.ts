export class AudioSystem {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private sfx: GainNode | null = null;
  private ui: GainNode | null = null;
  private muteButton: HTMLButtonElement | null = null;
  private readonly voices: Array<{ oscillator: OscillatorNode; gain: GainNode }> = [];
  private unlockPromise: Promise<void> | null = null;
  private unlocked = false;
  private muted = false;
  private unavailable = false;
  private disposed = false;

  private readonly onUnlock = () => {
    void this.unlock().catch(() => {
      this.unavailable = !this.getAudioContextClass();
      this.syncMuteUi();
    });
  };

  private readonly onMuteClick = () => {
    this.setMuted(!this.muted);
  };

  constructor() {
    // Keep both listeners until a graph is actually running. A rejected resume
    // can then recover on a later user gesture instead of disabling audio.
    window.addEventListener('pointerdown', this.onUnlock);
    window.addEventListener('keydown', this.onUnlock);
  }

  async unlock(): Promise<void> {
    if (this.unlocked) return;
    if (this.disposed) throw new Error('AudioSystem is disposed.');
    if (this.unlockPromise) return this.unlockPromise;

    const AudioContextClass = this.getAudioContextClass();
    if (!AudioContextClass) throw new Error('Web Audio is unavailable.');

    const pending = this.createAndResumeGraph(AudioContextClass);
    this.unlockPromise = pending;
    try {
      await pending;
    } finally {
      if (this.unlockPromise === pending) this.unlockPromise = null;
    }
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

  async suspend(): Promise<void> {
    if (this.unlockPromise) await this.unlockPromise.catch(() => undefined);
    if (this.context?.state === 'running') await this.context.suspend();
  }

  async resume(): Promise<void> {
    if (this.unlockPromise) await this.unlockPromise;
    if (this.unlocked && this.context?.state === 'suspended') {
      await this.context.resume();
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
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

  private async createAndResumeGraph(
    AudioContextClass: typeof AudioContext,
  ): Promise<void> {
    const context = new AudioContextClass();
    const master = context.createGain();
    const sfx = context.createGain();
    const ui = context.createGain();
    master.gain.value = this.muted ? 0 : 0.72;
    sfx.connect(master);
    ui.connect(master);
    master.connect(context.destination);

    try {
      await context.resume();
      if (this.disposed) {
        sfx.disconnect();
        ui.disconnect();
        master.disconnect();
        await context.close();
        return;
      }
      // Mute may have changed while resume() was pending.
      master.gain.value = this.muted ? 0 : 0.72;
      this.context = context;
      this.master = master;
      this.sfx = sfx;
      this.ui = ui;
      this.unlocked = true;
      this.unavailable = false;
      window.removeEventListener('pointerdown', this.onUnlock);
      window.removeEventListener('keydown', this.onUnlock);
      this.syncMuteUi();
    } catch (error) {
      sfx.disconnect();
      ui.disconnect();
      master.disconnect();
      if (context.state !== 'closed') await context.close().catch(() => undefined);
      throw error;
    }
  }

  private getAudioContextClass(): typeof AudioContext | undefined {
    return (
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext })
        .webkitAudioContext
    );
  }

  private cleanupGraph(): void {
    const context = this.context;
    this.sfx?.disconnect();
    this.ui?.disconnect();
    this.master?.disconnect();
    this.master = null;
    this.sfx = null;
    this.ui = null;
    this.context = null;
    if (context?.state !== 'closed') void context?.close().catch(() => undefined);
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

export class RacingAudio {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private engineOsc: OscillatorNode | null = null;
  private engineSubOsc: OscillatorNode | null = null;
  private engineGain: GainNode | null = null;
  private driftNoise: AudioBufferSourceNode | null = null;
  private driftFilter: BiquadFilterNode | null = null;
  private driftGain: GainNode | null = null;
  private muted = false;
  private started = false;
  private paused = false;

  public unlock(): void {
    if (this.started) {
      if (this.ctx && this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }
      return;
    }
    const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AudioCtx) return;

    try {
      const ctx = new AudioCtx();
      this.ctx = ctx;

      const master = ctx.createGain();
      master.gain.value = this.muted ? 0 : 0.35;
      master.connect(ctx.destination);
      this.masterGain = master;

      // Engine harmonic pair
      const engGain = ctx.createGain();
      engGain.gain.value = 0.0;
      const engFilter = ctx.createBiquadFilter();
      engFilter.type = 'lowpass';
      engFilter.frequency.value = 650;

      const osc1 = ctx.createOscillator();
      osc1.type = 'sawtooth';
      osc1.frequency.value = 72;

      const osc2 = ctx.createOscillator();
      osc2.type = 'triangle';
      osc2.frequency.value = 144;

      osc1.connect(engFilter);
      osc2.connect(engFilter);
      engFilter.connect(engGain);
      engGain.connect(master);
      osc1.start();
      osc2.start();

      this.engineOsc = osc1;
      this.engineSubOsc = osc2;
      this.engineGain = engGain;

      // Drift tire screech noise loop
      const bufferSize = ctx.sampleRate * 2;
      const noiseBuffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
      const output = noiseBuffer.getChannelData(0);
      for (let i = 0; i < bufferSize; i++) {
        output[i] = Math.random() * 2 - 1;
      }
      const noise = ctx.createBufferSource();
      noise.buffer = noiseBuffer;
      noise.loop = true;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.value = 1650;
      filter.Q.value = 4.5;

      const dGain = ctx.createGain();
      dGain.gain.value = 0;

      noise.connect(filter);
      filter.connect(dGain);
      dGain.connect(master);
      noise.start();

      this.driftNoise = noise;
      this.driftFilter = filter;
      this.driftGain = dGain;

      this.started = true;
    } catch {
      // Headless or restricted audio environment
    }
  }

  public setMuted(mute: boolean): void {
    this.muted = mute;
    if (this.masterGain && this.ctx) {
      this.masterGain.gain.setTargetAtTime(mute ? 0 : 0.35, this.ctx.currentTime, 0.03);
    }
  }

  public isMuted(): boolean {
    return this.muted;
  }

  public setPaused(paused: boolean): void {
    this.paused = paused;
    if (!this.ctx || !this.engineGain || !this.driftGain) return;
    if (paused) {
      this.engineGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.04);
      this.driftGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.04);
    }
  }

  public updateLoop(speedAbs: number, drifting: boolean, nitroActive: boolean, active: boolean): void {
    if (!this.ctx || !this.engineOsc || !this.engineSubOsc || !this.engineGain || !this.driftGain || !this.driftFilter) {
      return;
    }
    const now = this.ctx.currentTime;
    if (!active || this.paused || this.muted) {
      this.engineGain.gain.setTargetAtTime(0, now, 0.05);
      this.driftGain.gain.setTargetAtTime(0, now, 0.05);
      return;
    }

    const rpmRatio = Math.min(1.4, speedAbs / 62);
    const baseFreq = 68 + rpmRatio * 145 + (nitroActive ? 45 : 0);
    this.engineOsc.frequency.setTargetAtTime(baseFreq, now, 0.05);
    this.engineSubOsc.frequency.setTargetAtTime(baseFreq * 1.98, now, 0.05);
    this.engineGain.gain.setTargetAtTime(0.08 + Math.min(0.14, rpmRatio * 0.1), now, 0.06);

    const driftVol = drifting && speedAbs > 14 ? 0.16 : 0;
    this.driftGain.gain.setTargetAtTime(driftVol, now, 0.04);
    this.driftFilter.frequency.setTargetAtTime(1400 + rpmRatio * 750, now, 0.05);
  }

  public playTone(freq: number, duration: number, type: OscillatorType = 'sine', volume = 0.22, slideTo?: number): void {
    if (!this.ctx || !this.masterGain || this.muted) return;
    const now = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, now);
    if (slideTo) {
      osc.frequency.exponentialRampToValueAtTime(slideTo, now + duration);
    }
    gain.gain.setValueAtTime(volume, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + duration);
    osc.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + duration + 0.02);
  }

  public playCountdown(go: boolean): void {
    if (go) {
      this.playTone(880, 0.35, 'triangle', 0.3, 1320);
    } else {
      this.playTone(440, 0.16, 'triangle', 0.24);
    }
  }

  public playMiniBoost(): void {
    const jitter = 0.94 + Math.random() * 0.12;
    this.playTone(320 * jitter, 0.22, 'sawtooth', 0.22, 760 * jitter);
  }

  public playNitro(cww: boolean): void {
    this.playTone(cww ? 260 : 210, 0.55, 'sawtooth', 0.28, cww ? 980 : 720);
    this.playTone(cww ? 520 : 420, 0.45, 'triangle', 0.22, cww ? 1240 : 880);
  }

  public playBoostPad(): void {
    this.playTone(420, 0.28, 'triangle', 0.26, 1080);
  }

  public playWallHit(): void {
    this.playTone(135, 0.16, 'square', 0.26, 48);
  }

  public playLapComplete(finalFinish: boolean): void {
    if (finalFinish) {
      this.playTone(523.25, 0.16, 'triangle', 0.26);
      setTimeout(() => this.playTone(659.25, 0.16, 'triangle', 0.26), 110);
      setTimeout(() => this.playTone(783.99, 0.18, 'triangle', 0.28), 220);
      setTimeout(() => this.playTone(1046.5, 0.42, 'triangle', 0.3), 340);
    } else {
      this.playTone(587.33, 0.14, 'triangle', 0.24);
      setTimeout(() => this.playTone(880, 0.26, 'triangle', 0.26), 100);
    }
  }

  public dispose(): void {
    try {
      this.engineOsc?.stop();
      this.engineSubOsc?.stop();
      this.driftNoise?.stop();
      void this.ctx?.close();
    } catch {
      // Ignore cleanup errors
    }
    this.ctx = null;
    this.started = false;
  }
}

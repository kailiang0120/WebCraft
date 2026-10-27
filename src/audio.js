// Procedural sound effects with the Web Audio API (no audio files).

const MATERIAL = {
  stone: { freq: 1800, q: 0.9, dur: 0.12, gain: 0.5 },
  wood: { freq: 700, q: 1.6, dur: 0.14, gain: 0.6 },
  grass: { freq: 2600, q: 0.5, dur: 0.16, gain: 0.35 },
  gravel: { freq: 1200, q: 0.6, dur: 0.16, gain: 0.45 },
  sand: { freq: 3200, q: 0.4, dur: 0.18, gain: 0.3 },
  snow: { freq: 2400, q: 0.4, dur: 0.15, gain: 0.25 },
  glass: { freq: 4000, q: 2, dur: 0.1, gain: 0.4 },
  metal: { freq: 2400, q: 4, dur: 0.18, gain: 0.4 },
};

export class Sound {
  constructor() {
    this.ctx = null;
    this.volume = 0.5;
  }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      const len = this.ctx.sampleRate;
      this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.master.gain.value = this.volume;
    return this.ctx;
  }

  burst(m, scale = 1, pitch = 1) {
    const ctx = this.ensure();
    if (!ctx) return;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.playbackRate.value = 0.8 + Math.random() * 0.4;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = m.freq * pitch * (0.85 + Math.random() * 0.3);
    f.Q.value = m.q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(m.gain * scale, t + 0.006);
    g.gain.exponentialRampToValueAtTime(0.001, t + m.dur);
    src.connect(f).connect(g).connect(this.master);
    src.start(t, Math.random() * 0.5, m.dur + 0.05);
  }

  tone(type, f0, f1, dur, gain, delay = 0) {
    const ctx = this.ensure();
    if (!ctx || gain <= 0) return;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  dig(material) { this.burst(MATERIAL[material] || MATERIAL.stone, 0.45, 0.9); }
  place(material) { this.burst(MATERIAL[material] || MATERIAL.stone, 0.8, 0.8); }
  step(material) { this.burst(MATERIAL[material] || MATERIAL.stone, 0.22, 0.7); }

  breakBlock(material) {
    const m = MATERIAL[material] || MATERIAL.stone;
    this.burst(m, 1, 0.7);
    setTimeout(() => this.burst(m, 0.6, 1.1), 40);
    if (material === 'glass') {
      for (let i = 0; i < 4; i++) setTimeout(() => this.tone('sine', 2500 + Math.random() * 2500, 1800, 0.15, 0.08), i * 30);
    }
  }

  hurt() { this.tone('sawtooth', 420, 140, 0.25, 0.15); }
  fizz() {
    this.burst({ freq: 4500, q: 0.4, dur: 0.5, gain: 0.35 });
    this.tone('sine', 1800, 700, 0.3, 0.03);
  }
  // Fire: a few dry snaps over a soft roar.
  crackle(v = 1) {
    if (v <= 0.02) return;
    this.burst({ freq: 700, q: 0.4, dur: 0.9, gain: 0.1 * v });
    const n = 3 + Math.floor(Math.random() * 5);
    for (let i = 0; i < n; i++) {
      setTimeout(() => this.burst({ freq: 2500 + Math.random() * 3500, q: 2, dur: 0.025, gain: (0.25 + Math.random() * 0.3) * v }),
        Math.random() * 900);
    }
  }
  lavaPop(v = 1) {
    if (v <= 0.02) return;
    this.tone('sine', 320 + Math.random() * 200, 90, 0.09, 0.18 * v);
    this.burst({ freq: 1400, q: 1, dur: 0.05, gain: 0.3 * v });
  }
  // Slow, thick bubbling.
  lavaAmbient(v = 1) {
    if (v <= 0.02) return;
    this.burst({ freq: 220, q: 0.5, dur: 1.4, gain: 0.35 * v });
    for (let i = 0; i < 3; i++) this.tone('sine', 140 + Math.random() * 80, 60, 0.14, 0.08 * v, 0.2 + i * 0.3 + Math.random() * 0.2);
  }
  flint() {
    this.burst({ freq: 3600, q: 3, dur: 0.09, gain: 0.5 });
    this.burst({ freq: 900, q: 0.6, dur: 0.35, gain: 0.25 }); // whoosh of the flame catching
  }
  hit() { this.burst({ freq: 500, q: 0.7, dur: 0.12, gain: 0.7 }); }
  bow(v = 1) { this.tone('triangle', 520, 180, 0.15, 0.12 * v); this.burst({ freq: 2500, q: 0.6, dur: 0.12, gain: 0.25 * v }); }
  eat() { this.burst({ freq: 1400, q: 0.8, dur: 0.08, gain: 0.35 }, 1, 0.8 + Math.random() * 0.4); }
  burp() { this.tone('sawtooth', 210, 110, 0.35, 0.08); }

  explosion(v = 1) {
    this.burst({ freq: 180, q: 0.3, dur: 1.6, gain: 1.4 * v });
    this.burst({ freq: 700, q: 0.4, dur: 0.6, gain: 0.8 * v });
    this.tone('sine', 90, 28, 1.0, 0.5 * v);
  }

  // Simple synthesized voices. kind: 'say' | 'hurt' | 'death' | 'fuse'.
  mob(type, kind = 'say', v = 1) {
    if (v <= 0.01) return;
    const hurt = kind === 'hurt' || kind === 'death';
    const p = hurt ? 1.35 : 1;
    switch (type) {
      case 'pig':
        this.tone('square', 330 * p, 220 * p, 0.14, 0.05 * v);
        this.tone('square', 300 * p, 200 * p, 0.12, 0.04 * v, 0.16);
        break;
      case 'cow':
        this.tone('sawtooth', 165 * p, 115 * p, hurt ? 0.3 : 0.8, 0.07 * v);
        break;
      case 'sheep':
        for (let i = 0; i < 4; i++) this.tone('sawtooth', 430 * p, 400 * p, 0.09, 0.04 * v, i * 0.09);
        break;
      case 'chicken':
        for (let i = 0; i < 3; i++) this.tone('square', 1300 * p, 900 * p, 0.05, 0.035 * v, i * 0.08);
        break;
      case 'zombie':
        this.tone('sawtooth', 120 * p, 70 * p, hurt ? 0.3 : 0.9, 0.09 * v);
        break;
      case 'skeleton':
        for (let i = 0; i < 4; i++) setTimeout(() => this.burst(MATERIAL.wood, 0.4 * v, 2.2), i * 55);
        break;
      case 'creeper':
        if (kind === 'fuse') this.burst({ freq: 5200, q: 0.3, dur: 1.4, gain: 0.35 * v });
        else if (hurt) this.burst({ freq: 3000, q: 0.5, dur: 0.25, gain: 0.3 * v });
        break;
      case 'spider':
        this.burst({ freq: 3400 * p, q: 1, dur: 0.3, gain: 0.25 * v });
        break;
      case 'rock_golem':
        this.burst({ freq: 260, q: 0.6, dur: 0.6, gain: 0.9 * v });
        this.tone('square', 70 * p, 45 * p, 0.5, 0.06 * v);
        break;
      case 'wisp':
        for (let i = 0; i < 3; i++) this.tone('sine', (1500 + i * 400) * p, (1800 + i * 300) * p, 0.25, 0.04 * v, i * 0.07);
        break;
    }
  }
  pop() { this.tone('sine', 900, 1600, 0.06, 0.12); }
  click() { this.tone('square', 1200, 900, 0.03, 0.05); }
  splash() { this.burst({ freq: 900, q: 0.5, dur: 0.35, gain: 0.4 }); }
}

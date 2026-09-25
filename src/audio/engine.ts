/**
 * Procedural audio: every sound is synthesised with WebAudio (no samples).
 * Positional one-shots, continuous machine loops (engines, rotors, servos), ambience and music.
 */
import * as THREE from 'three';
import type { AudioAPI } from '../core/context';
import type { Game } from '../core/game';
import type { Machine } from '../machines/machine';
import { clamp, lerp } from '../core/math';

type Ctx = AudioContext;

interface Voice {
  gain: GainNode;
  end: number;
  priority: number;
}

export class AudioEngine implements AudioAPI {
  listener = new THREE.Vector3();
  ctx: Ctx | null = null;
  private master!: GainNode;
  private sfx!: GainNode;
  private musicBus!: GainNode;
  private reverb!: ConvolverNode;
  private reverbSend!: GainNode;
  private noiseBuf!: AudioBuffer;
  private brownBuf!: AudioBuffer;
  private voices: Voice[] = [];
  private volume = 0.8;
  private musicVol = 0.5;
  private loops: MachineLoops | null = null;
  private ambience: Ambience | null = null;
  private music_: Music | null = null;
  private musicMode = 'title';
  private right = new THREE.Vector3();

  constructor(private game: Game) {
    const unlock = () => {
      this.init();
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    game.env.onLightning = () => this.thunder();
  }

  private init() {
    if (this.ctx) return;
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    const ctx = this.ctx;
    this.master = ctx.createGain();
    this.master.gain.value = this.volume;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.ratio.value = 4;
    comp.attack.value = 0.005;
    comp.release.value = 0.2;
    this.master.connect(comp).connect(ctx.destination);
    this.sfx = ctx.createGain();
    this.sfx.connect(this.master);
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = this.musicVol * 0.5;
    this.musicBus.connect(this.master);
    // Buffers
    const len = ctx.sampleRate * 2;
    this.noiseBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.brownBuf = ctx.createBuffer(1, len, ctx.sampleRate);
    const b = this.brownBuf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      b[i] = last * 3.5;
    }
    // Reverb impulse
    this.reverb = ctx.createConvolver();
    const irLen = ctx.sampleRate * 2.2;
    const ir = ctx.createBuffer(2, irLen, ctx.sampleRate);
    for (let c = 0; c < 2; c++) {
      const ch = ir.getChannelData(c);
      for (let i = 0; i < irLen; i++) ch[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / irLen, 3.2);
    }
    this.reverb.buffer = ir;
    this.reverbSend = ctx.createGain();
    this.reverbSend.gain.value = 0.35;
    this.reverbSend.connect(this.reverb).connect(this.master);
    this.ambience = new Ambience(this);
    this.music_ = new Music(this);
    this.music_.setMode(this.musicMode);
    if (this.pendingPlayer) this.attachPlayer(this.pendingPlayer);
  }

  get context() {
    return this.ctx;
  }
  get out() {
    return this.sfx;
  }
  get musicOut() {
    return this.musicBus;
  }
  get verb() {
    return this.reverbSend;
  }
  get noise() {
    return this.noiseBuf;
  }
  get brown() {
    return this.brownBuf;
  }

  setVolume(v: number, music: number) {
    this.volume = v;
    this.musicVol = music;
    if (this.ctx) {
      this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
      this.musicBus.gain.setTargetAtTime(music * 0.5, this.ctx.currentTime, 0.1);
    }
  }

  music(mode: string) {
    this.musicMode = mode;
    this.music_?.setMode(mode);
  }

  private pendingPlayer: Machine | null = null;
  attachPlayer(m: Machine | null) {
    this.pendingPlayer = m;
    if (!this.ctx) return;
    this.loops?.dispose();
    this.loops = m ? new MachineLoops(this, m) : null;
  }

  /** Create a positional output chain for a sound. Returns the input node or null if inaudible. */
  private spatial(pos: THREE.Vector3 | null | undefined, volume: number, size: number, priority: number): { input: AudioNode; gain: GainNode; t: number } | null {
    const ctx = this.ctx!;
    let gainV = volume;
    let pan = 0;
    let lp = 20000;
    let verb = 0.15;
    if (pos) {
      const d = pos.distanceTo(this.listener);
      const ref = 8 * Math.max(0.5, size);
      gainV *= 1 / (1 + Math.pow(d / ref, 1.35));
      if (gainV < 0.004) return null;
      this.right.set(1, 0, 0).applyQuaternion(this.game.camera.quaternion);
      const dir = pos.clone().sub(this.listener).normalize();
      pan = clamp(dir.dot(this.right), -1, 1) * 0.8;
      lp = clamp(18000 / (1 + d / 60), 900, 18000);
      verb = clamp(0.1 + d / 250, 0.1, 0.8);
    }
    // voice limit
    const now = ctx.currentTime;
    this.voices = this.voices.filter((v) => v.end > now);
    if (this.voices.length > 40) {
      const weakest = this.voices.reduce((a, b) => (a.priority < b.priority ? a : b));
      if (weakest.priority > priority * gainV) return null;
      weakest.gain.gain.setTargetAtTime(0, now, 0.01);
      weakest.end = now;
    }
    const g = ctx.createGain();
    g.gain.value = gainV;
    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = lp;
    const panner = ctx.createStereoPanner();
    panner.pan.value = pan;
    g.connect(filter).connect(panner).connect(this.sfx);
    const send = ctx.createGain();
    send.gain.value = verb;
    panner.connect(send).connect(this.reverbSend);
    this.voices.push({ gain: g, end: now + 3, priority: priority * gainV });
    return { input: g, gain: g, t: now };
  }

  // ---------------------------------------------------------------- synthesis helpers
  noiseSrc(dur: number, buf?: AudioBuffer) {
    const s = this.ctx!.createBufferSource();
    s.buffer = buf ?? this.noiseBuf;
    s.loop = true;
    s.loopStart = Math.random();
    s.start(this.ctx!.currentTime, Math.random() * 1.5);
    s.stop(this.ctx!.currentTime + dur + 0.05);
    return s;
  }

  env(g: GainNode, t: number, a: number, peak: number, decay: number, curve = 3) {
    g.gain.setValueAtTime(0.0001, t);
    g.gain.linearRampToValueAtTime(peak, t + a);
    g.gain.setTargetAtTime(0.0001, t + a, decay / curve);
  }

  private burst(out: AudioNode, t: number, opts: { dur: number; type?: BiquadFilterType; f0: number; f1?: number; q?: number; peak: number; attack?: number; buf?: AudioBuffer }) {
    const ctx = this.ctx!;
    const src = this.noiseSrc(opts.dur + 0.2, opts.buf);
    const f = ctx.createBiquadFilter();
    f.type = opts.type ?? 'bandpass';
    f.frequency.setValueAtTime(opts.f0, t);
    if (opts.f1) f.frequency.exponentialRampToValueAtTime(Math.max(20, opts.f1), t + opts.dur);
    f.Q.value = opts.q ?? 1;
    const g = ctx.createGain();
    this.env(g, t, opts.attack ?? 0.002, opts.peak, opts.dur);
    src.connect(f).connect(g).connect(out);
  }

  private tone(out: AudioNode, t: number, opts: { type?: OscillatorType; f0: number; f1?: number; dur: number; peak: number; attack?: number }) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = opts.type ?? 'sine';
    o.frequency.setValueAtTime(opts.f0, t);
    if (opts.f1) o.frequency.exponentialRampToValueAtTime(Math.max(10, opts.f1), t + opts.dur);
    const g = ctx.createGain();
    this.env(g, t, opts.attack ?? 0.003, opts.peak, opts.dur);
    o.connect(g).connect(out);
    o.start(t);
    o.stop(t + opts.dur * 1.6 + 0.1);
  }

  private metal(out: AudioNode, t: number, base: number, dur: number, peak: number) {
    for (const [ratio, amp] of [[1, 1], [1.63, 0.7], [2.71, 0.5], [3.93, 0.35]] as [number, number][]) {
      this.tone(out, t, { type: 'sine', f0: base * ratio * (0.97 + Math.random() * 0.06), dur: dur * (1.2 - ratio * 0.15), peak: peak * amp * 0.5 });
    }
  }

  play(name: string, pos?: THREE.Vector3 | null, opts: { volume?: number; pitch?: number; size?: number } = {}) {
    if (!this.ctx || this.ctx.state !== 'running') {
      if (this.ctx?.state === 'suspended') this.ctx.resume();
      if (!this.ctx) return;
    }
    const vol = opts.volume ?? 1;
    const p = opts.pitch ?? 1;
    const size = opts.size ?? 1;
    const big = ['explosion', 'explosionBig', 'fire_cannon', 'fire_railgun', 'thunder'].includes(name);
    const sp = this.spatial(pos, vol, big ? 6 * size : name.startsWith('fire') ? 3 : 1, big ? 3 : 1);
    if (!sp) return;
    const out = sp.input;
    const t = sp.t;
    switch (name) {
      case 'fire_mg':
      case 'fire_chaingun':
        this.burst(out, t, { dur: 0.07, f0: 2200 * p, q: 0.8, peak: 0.55, type: 'bandpass' });
        this.burst(out, t, { dur: 0.05, f0: 6000, type: 'highpass', peak: 0.2 });
        this.tone(out, t, { f0: 140 * p, f1: 60, dur: 0.06, peak: 0.5 });
        break;
      case 'fire_shotgun':
        this.burst(out, t, { dur: 0.22, f0: 3000, f1: 400, type: 'lowpass', peak: 0.9 });
        this.tone(out, t, { f0: 110, f1: 40, dur: 0.18, peak: 0.8 });
        break;
      case 'fire_autocannon':
        this.burst(out, t, { dur: 0.14, f0: 1800, f1: 300, type: 'lowpass', peak: 0.8 });
        this.tone(out, t, { f0: 90 * p, f1: 35, dur: 0.2, peak: 0.9 });
        this.burst(out, t, { dur: 0.04, f0: 5000, type: 'highpass', peak: 0.3 });
        break;
      case 'fire_cannon':
        this.tone(out, t, { f0: 70, f1: 25, dur: 0.9, peak: 1.2 });
        this.burst(out, t, { dur: 1.4, f0: 2400, f1: 120, type: 'lowpass', peak: 1.1, buf: this.brownBuf });
        this.burst(out, t, { dur: 0.08, f0: 4000, type: 'highpass', peak: 0.6 });
        break;
      case 'fire_rocket':
      case 'fire_missile':
        this.burst(out, t, { dur: 0.7, f0: 500, f1: 2600, q: 1.5, peak: 0.6, attack: 0.03 });
        this.tone(out, t, { f0: 120, f1: 60, dur: 0.15, peak: 0.4 });
        break;
      case 'fire_laser':
        this.tone(out, t, { type: 'sawtooth', f0: 1900 * p, f1: 500, dur: 0.14, peak: 0.25 });
        this.tone(out, t, { type: 'sine', f0: 3200 * p, f1: 900, dur: 0.1, peak: 0.25 });
        break;
      case 'beam':
        this.tone(out, t, { type: 'sawtooth', f0: 220, dur: 0.14, peak: 0.12, attack: 0.02 });
        this.tone(out, t, { type: 'square', f0: 331, dur: 0.14, peak: 0.06, attack: 0.02 });
        this.burst(out, t, { dur: 0.14, f0: 5000, type: 'highpass', peak: 0.08 });
        break;
      case 'fire_railgun':
        this.burst(out, t, { dur: 0.1, f0: 7000, type: 'highpass', peak: 0.9 });
        this.tone(out, t, { type: 'sawtooth', f0: 1400, f1: 80, dur: 0.5, peak: 0.5 });
        this.tone(out, t, { f0: 90, f1: 30, dur: 0.7, peak: 1 });
        break;
      case 'fire_arc':
        for (let i = 0; i < 6; i++) this.burst(out, t + i * 0.025, { dur: 0.03, f0: 3000 + Math.random() * 4000, q: 3, peak: 0.6 });
        this.tone(out, t, { type: 'square', f0: 120, dur: 0.2, peak: 0.2 });
        break;
      case 'flamer':
        this.burst(out, t, { dur: 0.2, f0: 700, type: 'lowpass', peak: 0.45, attack: 0.03, buf: this.brownBuf });
        break;
      case 'explosion':
      case 'explosionBig': {
        const k = name === 'explosionBig' ? 1.4 : 1;
        this.tone(out, t, { f0: 60 * k, f1: 22, dur: 1.2 * k, peak: 1.2 });
        this.burst(out, t, { dur: 2.2 * k, f0: 3000, f1: 90, type: 'lowpass', peak: 1.2, buf: this.brownBuf });
        this.burst(out, t, { dur: 0.3, f0: 1800, f1: 400, type: 'bandpass', peak: 0.7 });
        for (let i = 0; i < 5; i++) this.metal(out, t + 0.15 + Math.random() * 0.8, 400 + Math.random() * 900, 0.4, 0.12);
        break;
      }
      case 'thunder':
        this.burst(out, t + 0.3, { dur: 4, f0: 400, f1: 40, type: 'lowpass', peak: 1.4, buf: this.brownBuf, attack: 0.3 });
        this.tone(out, t + 0.3, { f0: 40, f1: 25, dur: 3, peak: 0.8, attack: 0.3 });
        break;
      case 'hitMetal':
        this.metal(out, t, 700 + Math.random() * 500, 0.25, 0.6);
        this.burst(out, t, { dur: 0.03, f0: 4000, type: 'highpass', peak: 0.5 });
        break;
      case 'hitHeavy':
        this.metal(out, t, 260 + Math.random() * 150, 0.5, 0.9);
        this.tone(out, t, { f0: 90, f1: 40, dur: 0.25, peak: 0.8 });
        this.burst(out, t, { dur: 0.1, f0: 2500, type: 'bandpass', peak: 0.6 });
        break;
      case 'hitDirt':
        this.burst(out, t, { dur: 0.12, f0: 500, f1: 120, type: 'lowpass', peak: 0.5, buf: this.brownBuf });
        break;
      case 'ricochet':
        this.tone(out, t, { f0: 3200 * (0.8 + Math.random() * 0.5), f1: 900, dur: 0.35, peak: 0.25 });
        break;
      case 'partBreak':
        this.burst(out, t, { dur: 0.35, f0: 1200, q: 0.8, peak: 0.8 });
        this.metal(out, t, 320 + Math.random() * 200, 0.6, 0.6);
        this.metal(out, t + 0.07, 600 + Math.random() * 300, 0.4, 0.4);
        break;
      case 'crash':
        this.burst(out, t, { dur: 0.45, f0: 900, f1: 200, type: 'lowpass', peak: 1, buf: this.brownBuf });
        this.metal(out, t, 200 + Math.random() * 150, 0.6, 0.7);
        break;
      case 'backfire':
        this.burst(out, t, { dur: 0.05, f0: 600, type: 'lowpass', peak: 1 });
        this.tone(out, t, { f0: 70, f1: 40, dur: 0.06, peak: 0.7 });
        break;
      case 'stomp':
      case 'stompHeavy': {
        const k = name === 'stompHeavy' ? 1.5 : 1;
        this.tone(out, t, { f0: 60 * p, f1: 32, dur: 0.35 * k, peak: 1.0 });
        this.burst(out, t, { dur: 0.25, f0: 300, f1: 90, type: 'lowpass', peak: 0.6, buf: this.brownBuf });
        this.metal(out, t + 0.02, 180 * p, 0.3, 0.25 * k);
        this.burst(out, t + 0.05, { dur: 0.2, f0: 3500, type: 'highpass', peak: 0.08 });
        break;
      }
      case 'swing':
        this.burst(out, t, { dur: 0.3, f0: 300, f1: 1400, q: 2, peak: 0.4, attack: 0.05 });
        break;
      case 'melee_hit':
        this.metal(out, t, 180, 0.7, 1);
        this.tone(out, t, { f0: 80, f1: 30, dur: 0.3, peak: 1 });
        this.burst(out, t, { dur: 0.15, f0: 2000, peak: 0.7 });
        break;
      case 'grind':
        this.burst(out, t, { dur: 0.12, f0: 2600, q: 2, peak: 0.4 });
        this.tone(out, t, { type: 'sawtooth', f0: 90 + Math.random() * 20, dur: 0.12, peak: 0.2 });
        break;
      case 'torch':
        this.burst(out, t, { dur: 0.25, f0: 5000, type: 'highpass', peak: 0.15, attack: 0.05 });
        break;
      case 'salvage':
        for (let i = 0; i < 4; i++) this.burst(out, t + i * 0.06, { dur: 0.03, f0: 2500, q: 4, peak: 0.4 });
        this.metal(out, t + 0.3, 300, 0.5, 0.5);
        break;
      case 'rotorStrike':
        for (let i = 0; i < 5; i++) this.metal(out, t + i * 0.04, 500 + Math.random() * 600, 0.15, 0.5);
        break;
      case 'rankup':
      case 'ui_good':
        [523, 659, 784, 1046].forEach((f, i) => this.tone(out, t + i * 0.09, { type: 'triangle', f0: f, dur: 0.5, peak: 0.25 }));
        break;
      case 'ui_click':
        this.tone(out, t, { type: 'square', f0: 900, f1: 600, dur: 0.04, peak: 0.08 });
        break;
      case 'ui_coin':
        this.tone(out, t, { type: 'triangle', f0: 1318, dur: 0.12, peak: 0.18 });
        this.tone(out, t + 0.07, { type: 'triangle', f0: 1760, dur: 0.25, peak: 0.16 });
        break;
      case 'ui_bad':
        this.tone(out, t, { type: 'square', f0: 220, f1: 160, dur: 0.18, peak: 0.1 });
        break;
      case 'boss_roar':
        // a starting diesel the size of a building: grinding metal, low horn, air brakes
        this.tone(out, t, { type: 'sawtooth', f0: 38, f1: 55, dur: 2.4, peak: 0.9, attack: 0.4 });
        this.tone(out, t + 0.2, { type: 'sawtooth', f0: 57, f1: 82, dur: 2.0, peak: 0.5, attack: 0.3 });
        this.burst(out, t, { dur: 2.2, f0: 400, f1: 120, type: 'lowpass', peak: 0.8, buf: this.brownBuf, attack: 0.3 });
        for (let i = 0; i < 6; i++) this.metal(out, t + 0.3 + i * 0.28, 120 + Math.random() * 180, 0.5, 0.45);
        this.burst(out, t + 2.1, { dur: 0.6, f0: 4000, type: 'highpass', peak: 0.3 });
        break;
      default:
        this.burst(out, t, { dur: 0.1, f0: 1000, peak: 0.2 });
    }
  }

  private thunder() {
    const cam = this.game.camera.position;
    const p = cam.clone().add(new THREE.Vector3((Math.random() - 0.5) * 600, 100, (Math.random() - 0.5) * 600));
    setTimeout(() => this.play('thunder', p, { volume: 1.2, size: 20 }), 400 + Math.random() * 2000);
  }

  update(dt: number) {
    if (!this.ctx) return;
    this.loops?.update(dt);
    this.ambience?.update(dt, this.game);
    this.music_?.update(dt, this.game);
  }
}

// ---------------------------------------------------------------- machine loops
class MachineLoops {
  private nodes: AudioNode[] = [];
  private engineOsc: OscillatorNode[] = [];
  private engineFilter: BiquadFilterNode | null = null;
  private engineGain: GainNode | null = null;
  private rumbleGain: GainNode | null = null;
  private whine: OscillatorNode | null = null;
  private whineGain: GainNode | null = null;
  private rotorGain: GainNode | null = null;
  private rotorLfo: OscillatorNode | null = null;
  private rotorFilter: BiquadFilterNode | null = null;
  private jetGain: GainNode | null = null;
  private servoGain: GainNode | null = null;
  private servoOsc: OscillatorNode | null = null;
  private windGain: GainNode;
  private skidGain: GainNode;
  private cylinders = 4;

  constructor(private a: AudioEngine, private m: Machine) {
    const ctx = a.context!;
    const out = a.out;
    const mk = <T extends AudioNode>(n: T) => {
      this.nodes.push(n);
      return n;
    };
    // wind
    const wind = mk(a.noiseSrc(1e5, a.brown));
    const wf = mk(ctx.createBiquadFilter());
    wf.type = 'lowpass';
    wf.frequency.value = 600;
    this.windGain = mk(ctx.createGain());
    this.windGain.gain.value = 0;
    wind.connect(wf).connect(this.windGain).connect(out);
    // skid
    const skid = mk(a.noiseSrc(1e5));
    const sf = mk(ctx.createBiquadFilter());
    sf.type = 'bandpass';
    sf.frequency.value = 1400;
    sf.Q.value = 2;
    this.skidGain = mk(ctx.createGain());
    this.skidGain.gain.value = 0;
    skid.connect(sf).connect(this.skidGain).connect(out);
    const engine = m.parts.find((p) => p.def.category === 'engine');
    if (m.cls === 'ground' && engine) {
      this.cylinders = Number(engine.def.look?.cyl ?? 4);
      const layout = engine.def.look?.layout;
      this.engineFilter = mk(ctx.createBiquadFilter());
      this.engineFilter.type = 'lowpass';
      this.engineFilter.frequency.value = 400;
      this.engineFilter.Q.value = 2;
      this.engineGain = mk(ctx.createGain());
      this.engineGain.gain.value = 0;
      for (const [type, det] of [['sawtooth', 0], ['sawtooth', 7], ['square', -5]] as [OscillatorType, number][]) {
        const o = mk(ctx.createOscillator());
        o.type = type;
        o.detune.value = det;
        o.frequency.value = 40;
        o.connect(this.engineFilter);
        o.start();
        this.engineOsc.push(o);
      }
      this.engineFilter.connect(this.engineGain).connect(out);
      // exhaust rumble
      const rum = mk(a.noiseSrc(1e5, a.brown));
      const rf = mk(ctx.createBiquadFilter());
      rf.type = 'lowpass';
      rf.frequency.value = 180;
      this.rumbleGain = mk(ctx.createGain());
      this.rumbleGain.gain.value = 0;
      rum.connect(rf).connect(this.rumbleGain).connect(out);
      if (layout === 'turbine' || layout === 'flux' || engine.def.look?.turbo) {
        this.whine = mk(ctx.createOscillator());
        this.whine.type = 'sine';
        this.whine.frequency.value = 2000;
        this.whineGain = mk(ctx.createGain());
        this.whineGain.gain.value = 0;
        this.whine.connect(this.whineGain).connect(out);
        this.whine.start();
      }
    }
    if (m.cls === 'air') {
      const src = mk(a.noiseSrc(1e5, a.brown));
      this.rotorFilter = mk(ctx.createBiquadFilter());
      this.rotorFilter.type = 'lowpass';
      this.rotorFilter.frequency.value = 500;
      const am = mk(ctx.createGain());
      am.gain.value = 0.5;
      this.rotorLfo = mk(ctx.createOscillator());
      this.rotorLfo.type = 'sawtooth';
      this.rotorLfo.frequency.value = 12;
      const lfoGain = mk(ctx.createGain());
      lfoGain.gain.value = 0.5;
      this.rotorLfo.connect(lfoGain).connect(am.gain);
      this.rotorLfo.start();
      this.rotorGain = mk(ctx.createGain());
      this.rotorGain.gain.value = 0;
      src.connect(this.rotorFilter).connect(am).connect(this.rotorGain).connect(out);
      if (m.parts.some((p) => p.def.category === 'jet')) {
        const jet = mk(a.noiseSrc(1e5));
        const jf = mk(ctx.createBiquadFilter());
        jf.type = 'bandpass';
        jf.frequency.value = 900;
        jf.Q.value = 0.6;
        this.jetGain = mk(ctx.createGain());
        this.jetGain.gain.value = 0;
        jet.connect(jf).connect(this.jetGain).connect(out);
      }
      // electric motor whine
      this.whine = mk(ctx.createOscillator());
      this.whine.type = 'triangle';
      this.whine.frequency.value = 600;
      this.whineGain = mk(ctx.createGain());
      this.whineGain.gain.value = 0;
      this.whine.connect(this.whineGain).connect(out);
      this.whine.start();
    }
    if (m.cls === 'mech') {
      this.servoOsc = mk(ctx.createOscillator());
      this.servoOsc.type = 'sawtooth';
      this.servoOsc.frequency.value = 180;
      const sf2 = mk(ctx.createBiquadFilter());
      sf2.type = 'bandpass';
      sf2.frequency.value = 900;
      sf2.Q.value = 3;
      this.servoGain = mk(ctx.createGain());
      this.servoGain.gain.value = 0;
      this.servoOsc.connect(sf2).connect(this.servoGain).connect(out);
      this.servoOsc.start();
      const hiss = mk(a.noiseSrc(1e5));
      const hf = mk(ctx.createBiquadFilter());
      hf.type = 'highpass';
      hf.frequency.value = 3000;
      this.rumbleGain = mk(ctx.createGain());
      this.rumbleGain.gain.value = 0;
      hiss.connect(hf).connect(this.rumbleGain).connect(out);
    }
  }

  update(dt: number) {
    const ctx = this.a.context!;
    const t = ctx.currentTime;
    const m = this.m;
    const tel = m.controller.telemetry();
    const alive = m.alive;
    const speed = m.velocity.length();
    this.windGain.gain.setTargetAtTime(clamp(speed / 60, 0, 0.5), t, 0.2);
    if (this.engineGain && this.engineFilter) {
      const rpm = alive && m.hasFuel ? tel.rpm ?? 900 : 0;
      const f = (rpm / 60) * (this.cylinders / 2);
      for (const o of this.engineOsc) o.frequency.setTargetAtTime(Math.max(20, f), t, 0.03);
      const thr = tel.throttle ?? 0;
      this.engineFilter.frequency.setTargetAtTime(200 + thr * 1400 + rpm * 0.15, t, 0.05);
      const engOk = m.parts.some((p) => p.def.category === 'engine' && p.functional);
      this.engineGain.gain.setTargetAtTime(alive && engOk && rpm > 0 ? 0.12 + thr * 0.16 : 0, t, 0.08);
      this.rumbleGain?.gain.setTargetAtTime(alive && engOk ? 0.2 + thr * 0.4 : 0, t, 0.1);
      if (this.whine && this.whineGain) {
        this.whine.frequency.setTargetAtTime(800 + rpm * 0.6, t, 0.05);
        this.whineGain.gain.setTargetAtTime(alive ? 0.02 + thr * 0.05 : 0, t, 0.1);
      }
      const ctrl = m.controller as any;
      const slip = ctrl.contacts ? ctrl.contacts.reduce((s: number, c: any) => s + (c.grounded && c.surface === 'asphalt' ? c.slip + Math.min(1, Math.abs(c.vLat) / 8) : 0), 0) / Math.max(1, ctrl.contacts.length) : 0;
      this.skidGain.gain.setTargetAtTime(clamp(slip * 0.5, 0, 0.35), t, 0.05);
    }
    if (this.rotorGain && this.rotorLfo && this.rotorFilter) {
      const thr = alive ? tel.throttle ?? 0 : 0;
      const rotor = m.parts.find((p) => p.def.category === 'rotor' && p.functional);
      const blades = Number(rotor?.def.look?.blades ?? 2);
      const radius = rotor?.def.stats.radius ?? 1;
      const rps = lerp(3, 38, Math.sqrt(thr)) * (1.2 / Math.max(0.6, Math.sqrt(radius))) / (Math.PI * 2);
      this.rotorLfo.frequency.setTargetAtTime(Math.max(2, rps * blades), t, 0.1);
      this.rotorFilter.frequency.setTargetAtTime(300 + thr * 900, t, 0.1);
      this.rotorGain.gain.setTargetAtTime(rotor ? 0.25 + thr * 0.5 : 0, t, 0.1);
      this.jetGain?.gain.setTargetAtTime(alive ? thr * 0.35 : 0, t, 0.1);
      if (this.whine && this.whineGain) {
        this.whine.frequency.setTargetAtTime(300 + thr * 900, t, 0.05);
        this.whineGain.gain.setTargetAtTime(rotor ? 0.015 + thr * 0.03 : 0, t, 0.1);
      }
    }
    if (this.servoGain && this.servoOsc) {
      const thr = alive ? tel.throttle ?? 0 : 0;
      this.servoOsc.frequency.setTargetAtTime(160 + thr * 220 + Math.sin(t * 7) * 30, t, 0.05);
      this.servoGain.gain.setTargetAtTime(thr * 0.08, t, 0.1);
      this.rumbleGain?.gain.setTargetAtTime(thr * 0.04, t, 0.1);
    }
    void dt;
  }

  dispose() {
    const ctx = this.a.context!;
    for (const n of this.nodes) {
      try {
        if ((n as any).stop) (n as any).stop(ctx.currentTime + 0.05);
        n.disconnect();
      } catch {
        /* ignore */
      }
    }
    this.nodes = [];
  }
}

// ---------------------------------------------------------------- ambience
class Ambience {
  private wind: GainNode;
  private cricketT = 0;
  constructor(private a: AudioEngine) {
    const ctx = a.context!;
    const src = a.noiseSrc(1e6, a.brown);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 350;
    f.Q.value = 0.5;
    this.wind = ctx.createGain();
    this.wind.gain.value = 0.05;
    src.connect(f).connect(this.wind).connect(a.out);
  }
  update(dt: number, game: Game) {
    const ctx = this.a.context!;
    const w = game.env.current;
    const indoor = game.state === 'garage';
    const target = indoor ? 0.02 : 0.04 + w.wind * 0.12 + w.dust * 0.2 + w.rain * 0.15;
    this.wind.gain.setTargetAtTime(target, ctx.currentTime, 1);
    // crickets at night
    if (game.env.atm.night > 0.6 && !indoor && game.state === 'world') {
      this.cricketT -= dt;
      if (this.cricketT <= 0) {
        this.cricketT = 0.3 + Math.random() * 1.2;
        const g = ctx.createGain();
        const o = ctx.createOscillator();
        o.frequency.value = 4200 + Math.random() * 600;
        const am = ctx.createOscillator();
        am.frequency.value = 38;
        const amg = ctx.createGain();
        amg.gain.value = 0.5;
        am.connect(amg).connect(g.gain);
        const t = ctx.currentTime;
        g.gain.setValueAtTime(0, t);
        g.gain.linearRampToValueAtTime(0.012, t + 0.03);
        g.gain.linearRampToValueAtTime(0, t + 0.25);
        const pan = ctx.createStereoPanner();
        pan.pan.value = Math.random() * 2 - 1;
        o.connect(g).connect(pan).connect(this.a.out);
        o.start(t);
        am.start(t);
        o.stop(t + 0.3);
        am.stop(t + 0.3);
      }
    }
  }
}

// ---------------------------------------------------------------- music
class Music {
  private mode = 'title';
  private nextT = 0;
  private step = 0;
  private padGain: GainNode;
  private chords: number[][] = [
    [0, 3, 7, 10],
    [-4, 0, 3, 7],
    [-2, 2, 5, 9],
    [-5, -1, 2, 7],
  ];
  private root = 45; // A2
  private tension = 0;

  constructor(private a: AudioEngine) {
    const ctx = a.context!;
    this.padGain = ctx.createGain();
    this.padGain.gain.value = 0.9;
    this.padGain.connect(a.musicOut);
  }

  setMode(m: string) {
    this.mode = m;
    this.nextT = 0;
  }

  private hz(n: number) {
    return 440 * Math.pow(2, (n - 69) / 12);
  }

  private pad(notes: number[], dur: number, bright: number) {
    const ctx = this.a.context!;
    const t = ctx.currentTime + 0.05;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(300 + bright * 900, t);
    f.frequency.linearRampToValueAtTime(600 + bright * 1400, t + dur * 0.5);
    f.frequency.linearRampToValueAtTime(300 + bright * 600, t + dur);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(0.06, t + dur * 0.3);
    g.gain.linearRampToValueAtTime(0, t + dur * 1.05);
    f.connect(g).connect(this.padGain);
    const send = ctx.createGain();
    send.gain.value = 0.6;
    g.connect(send).connect(this.a.verb);
    for (const n of notes) {
      for (const det of [-6, 6]) {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = this.hz(n);
        o.detune.value = det;
        o.connect(f);
        o.start(t);
        o.stop(t + dur * 1.1);
      }
    }
  }

  private pluck(note: number, when: number, vol = 0.05) {
    const ctx = this.a.context!;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = this.hz(note);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.01);
    g.gain.setTargetAtTime(0, t + 0.01, 0.35);
    o.connect(g).connect(this.padGain);
    const send = ctx.createGain();
    send.gain.value = 0.5;
    g.connect(send).connect(this.a.verb);
    o.start(t);
    o.stop(t + 2);
  }

  private drum(when: number, vol: number) {
    const ctx = this.a.context!;
    const t = ctx.currentTime + when;
    const o = ctx.createOscillator();
    o.frequency.setValueAtTime(90, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.2);
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    o.connect(g).connect(this.padGain);
    o.start(t);
    o.stop(t + 0.4);
  }

  update(dt: number, game: Game) {
    const ctx = this.a.context!;
    // combat tension from nearby hostiles
    const p = game.player;
    let target = 0;
    if (p && game.state === 'world') {
      for (const m of game.ctx.machines) {
        if (m === p || !m.alive || !game.ctx.hostile(p.faction, m.faction)) continue;
        if (m.currPos.distanceTo(p.currPos) < 180) target = 1;
      }
    }
    this.tension = lerp(this.tension, target, 1 - Math.exp(-dt * 0.5));
    this.nextT -= dt;
    if (this.nextT > 0) return;
    const chord = this.chords[this.step % this.chords.length];
    this.step++;
    const mode = this.mode;
    if (mode === 'garage') {
      const dur = 7;
      this.nextT = dur;
      this.pad(chord.map((n) => n + this.root + 12), dur, 0.6);
      for (let i = 0; i < 6; i++) if (Math.random() < 0.55) this.pluck(this.root + 24 + chord[i % 4] + (i > 3 ? 12 : 0), i * (dur / 6) + 0.3, 0.035);
    } else if (mode === 'title') {
      const dur = 8;
      this.nextT = dur;
      this.pad(chord.map((n) => n + this.root + 12), dur, 0.4);
      this.pad([this.root - 12 + chord[0]], dur, 0.2);
      for (let i = 0; i < 4; i++) if (Math.random() < 0.6) this.pluck(this.root + 36 + chord[Math.floor(Math.random() * 4)], 1 + i * 1.7, 0.03);
    } else {
      const dur = 9;
      this.nextT = dur;
      this.pad([this.root - 12 + chord[0], this.root + chord[1]], dur, 0.2 + this.tension * 0.5);
      if (this.tension > 0.3) {
        for (let i = 0; i < 12; i++) this.drum(i * 0.75, 0.12 * this.tension * (i % 4 === 0 ? 1.4 : 0.7));
        for (let i = 0; i < 8; i++) if (Math.random() < 0.4) this.pluck(this.root + 12 + chord[i % 4], i * 1.1, 0.04 * this.tension);
      } else if (Math.random() < 0.5) {
        this.pluck(this.root + 24 + chord[2], 2, 0.025);
      }
    }
    void ctx;
  }
}

import { quality, isMobile } from './device.js';

/* ------------------------------------------------------------------ *
 * Procedural audio — no sample files, everything synthesised with the
 * WebAudio graph: engine note, tyre skid, boosts, impacts, item stings,
 * a Puerto Rican music sequencer and an Old San Juan ambience bed.
 * ------------------------------------------------------------------ */

const AUDIO_PREF_KEY = 'oldSanJuanKart.audio';
const EPS = 0.0001;
const CLAVE_32 = new Set([0, 6, 12, 20, 24]);
const GUIRO_16 = new Set([2, 6, 10, 14]);
// The offbeat upstroke. Chording the "and" of every beat rather than the beat
// itself is what makes a groove lilt like calypso or soca instead of driving
// like straight-ahead salsa, and it is the single biggest thing separating a
// beach feel from a city one.
const SKANK_16 = new Set([2, 6, 10, 14]);
// A shaker running the offbeat sixteenths sits under everything as sea-breeze
// texture.
const SHAKER_16 = new Set([1, 3, 5, 7, 9, 11, 13, 15]);
const MONTUNO = {
  0: [2, 4], 3: [1, 3], 6: [0, 2], 8: [1, 4], 10: [2, 3], 13: [0, 3], 15: [1, 4],
};
/* A bright major loop -- I, vi, IV, V, coloured with sixths and ninths. The
 * old progression was a minor ii-V (Dm9 G13 C6/9 A7), which is handsome but
 * reads as a night-time city; major sixths and ninths read as sunshine.
 *
 * Chord progressions are not copyrightable subject matter, and there is
 * deliberately still no melody table anywhere in this file -- every pitch
 * played is drawn from the chord tones below by a rhythmic pattern. That is
 * what keeps the soundtrack clear of anyone else's music, so if you extend
 * this, add chords and rhythms, never tunes. */
const PROGRESSION = [
  { name: 'Cmaj9', root: 36, tones: [60, 64, 67, 71, 74], horn: [64, 67, 71] },
  { name: 'Am11', root: 33, tones: [57, 60, 64, 67, 72], horn: [60, 64, 67] },
  { name: 'Fmaj9', root: 41, tones: [57, 60, 64, 65, 69], horn: [60, 64, 69] },
  { name: 'G13', root: 43, tones: [59, 62, 65, 69, 76], horn: [62, 65, 71] },
];

function clamp01(v) {
  return Math.max(0, Math.min(1, Number.isFinite(v) ? v : 0));
}

function midiToHz(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

export class Audio {
  constructor() {
    this.ready = false;
    this.enabled = true;
    this.masterVolume = 0.75;
    this.musicVolume = 0.55;
    this.muted = false;
    /* 小小赛车 V2：背景音乐改由 src/audio/musicManager.js 播放用户提供的
     * 两首 MP3。这里保留全部音效（引擎、轮胎、海浪、道具、撞击等），但把
     * 自带的程序化音乐调度器关掉，否则会出现两套背景音乐同时响。 */
    this.proceduralMusic = false;

    this.musicState = 'menu';
    this.intensity = 1;
    this._musicBpm = 106;
    this._musicStep = 0;
    this._nextMusicTime = 0;
    this._musicTimer = null;
    this._lookAhead = 0.18;
    this._scheduleIntervalMs = 25;
    this._maxStepsPerTick = 24;
    this._offline = false;

    const tier = quality?.tier || 'high';
    this.musicQuality = {
      tier,
      piano: tier !== 'low',
      // The steel pan carries the whole Caribbean character of the track, so
      // unlike the piano it plays on every tier -- low-end devices just get a
      // cheaper two-partial version of the voice (see _steelPan).
      pan: true,
      horns: tier === 'high' && !isMobile,
      denseCowbell: tier === 'high',
      reverb: tier !== 'low',
    };
    this.musicDebug = {
      scheduledNotes: 0,
      scheduledSteps: 0,
      state: this.musicState,
      bpm: this._musicBpm,
      nextNoteTime: 0,
      intervalMs: 60 / this._musicBpm / 4 * 1000,
      stepMs: 60 / this._musicBpm / 4 * 1000,
      schedulerIntervalMs: this._scheduleIntervalMs,
      voices: 0,
      lastScheduleAt: 0,
      quality: tier,
    };

    this._loadPrefs();
  }

  init(ctxOverride = null, opts = {}) {
    if (this.ready) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!ctxOverride && !AC) return;
    const ctx = ctxOverride || new AC();
    this.ctx = ctx;
    this.ready = true;
    this._offline = !!opts.offline || (typeof OfflineAudioContext !== 'undefined' && ctx instanceof OfflineAudioContext);

    this.master = ctx.createGain();
    this.master.gain.value = this.muted ? 0 : this.masterVolume;

    // a touch of convolution glues everything into the same street
    this.reverb = ctx.createConvolver();
    this.reverb.buffer = this._impulse(this.musicQuality.reverb ? 1.9 : 1.15, this.musicQuality.reverb ? 2.6 : 3.2);
    const wet = ctx.createGain();
    wet.gain.value = this.musicQuality.reverb ? 0.22 : 0.12;
    this.reverb.connect(wet);
    wet.connect(this.master);
    this.wetIn = this.reverb;

    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 18;
    comp.ratio.value = 7;
    comp.attack.value = 0.004;
    comp.release.value = 0.16;
    this.master.connect(comp);
    comp.connect(ctx.destination);

    this._buildEngine();
    this._buildSkid();
    this._buildAmbience();
    this._buildMusic();
    this._applyVolumes(true);
    this.setMusicState(this.musicState, { reset: true });
    if (!this._offline && opts.startMusic !== false && !this.muted) this._startMusicScheduler();
  }

  resume() {
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    if (this.ready && !this._offline && !this.muted) this._startMusicScheduler();
  }

  /** Soft-return to the menu: frameUpdate() skips audio.update() in menu state,
   *  so the engine / tyre / ambience beds would otherwise stay latched at race
   *  volume forever. Sink them here; audio.update() takes over again on the
   *  next race. Sound effects and the mute state are untouched. */
  setIdle(idle) {
    if (!this.ready) return;
    const t = this.ctx.currentTime;
    if (idle) {
      this.engine.out.gain.setTargetAtTime(0, t, 0.08);
      this.skid.gain.gain.setTargetAtTime(0, t, 0.06);
      this.ambience.gain.gain.setTargetAtTime(0.012, t, 0.15);
    } else {
      this.ambience.gain.gain.setTargetAtTime(0.05, t, 0.15);
    }
  }

  toggleMute(force = null) {
    this.muted = force == null ? !this.muted : !!force;
    this.enabled = !this.muted;
    this._applyVolumes();
    if (this.muted) this._stopMusicScheduler();
    else if (this.ready && !this._offline) this._startMusicScheduler(true);
    this._savePrefs();
    return this.muted;
  }

  setMasterVolume(v) {
    this.masterVolume = clamp01(v);
    this._applyVolumes();
    this._savePrefs();
    return this.masterVolume;
  }

  setMusicVolume(v) {
    this.musicVolume = clamp01(v);
    this._applyMusicVolume();
    this._savePrefs();
    return this.musicVolume;
  }

  setIntensity(x) {
    this.intensity = Math.max(0, Math.min(1.5, Number.isFinite(x) ? x : 1));
  }

  setMusicState(state = 'menu', opts = {}) {
    const next = this._normalizeMusicState(state);
    const changed = next !== this.musicState;
    this.musicState = next;
    const cfg = this._musicConfig(next);
    this._musicBpm = cfg.bpm;
    this.musicDebug.state = next;
    this.musicDebug.bpm = this._musicBpm;
    this.musicDebug.intervalMs = this._stepDuration() * 1000;
    this.musicDebug.stepMs = this.musicDebug.intervalMs;
    this._applyMusicVolume();

    if (this.ready && (opts.reset || changed && (next === 'countdown' || next === 'race' || next === 'finished' || next === 'menu'))) {
      this._resetMusicClock();
    }
    if (this.ready && !this._offline && !this.muted) this._startMusicScheduler();
    return next;
  }

  /** Render the same procedural music engine offline for automated analysis. */
  async renderMusicPreview(duration = 8, state = 'race') {
    const rate = this.ctx?.sampleRate || 44100;
    const Offline = window.OfflineAudioContext || window.webkitOfflineAudioContext;
    if (!Offline) throw new Error('OfflineAudioContext unavailable');
    const offline = new Offline(2, Math.ceil(duration * rate), rate);
    const preview = new Audio();
    preview.masterVolume = 1;
    preview.musicVolume = this.musicVolume;
    preview.muted = false;
    preview.init(offline, { offline: true, startMusic: false });
    preview.setMusicState(state, { reset: true });
    preview._scheduleMusicRange(0.04, duration - 0.08);
    return offline.startRendering();
  }

  _normalizeMusicState(state) {
    const s = String(state || 'menu').toLowerCase();
    if (s === 'racing') return 'race';
    if (s === 'finallap' || s === 'final-lap' || s === 'final_lap') return 'finalLap';
    if (s === 'finish' || s === 'results' || s === 'finished') return 'finished';
    if (s === 'countdown' || s === 'race' || s === 'menu' || s === 'finalLap') return s;
    return 'menu';
  }

  _musicConfig(state = this.musicState) {
    // Pulled back a few bpm across the board: the same patterns played a
    // little slower sit back and sway rather than pushing, which is most of
    // the difference between a beach groove and a city one. The race states
    // stay quick enough to carry the driving.
    return {
      menu: { bpm: 98, gain: 0.52, energy: 0.62 },
      countdown: { bpm: 120, gain: 0.46, energy: 0.7 },
      race: { bpm: 150, gain: 0.78, energy: 1.0 },
      finalLap: { bpm: 172, gain: 0.86, energy: 1.18 },
      finished: { bpm: 116, gain: 0.72, energy: 0.82 },
    }[state] || { bpm: 98, gain: 0.5, energy: 0.6 };
  }

  _loadPrefs() {
    try {
      const raw = globalThis.localStorage?.getItem(AUDIO_PREF_KEY);
      if (!raw) return;
      const prefs = JSON.parse(raw);
      if (Number.isFinite(prefs.masterVolume)) this.masterVolume = clamp01(prefs.masterVolume);
      if (Number.isFinite(prefs.musicVolume)) this.musicVolume = clamp01(prefs.musicVolume);
      if (typeof prefs.muted === 'boolean') this.muted = prefs.muted;
      this.enabled = !this.muted;
    } catch {
      // localStorage can throw in private browsing modes.
    }
  }

  _savePrefs() {
    try {
      globalThis.localStorage?.setItem(AUDIO_PREF_KEY, JSON.stringify({
        muted: this.muted,
        masterVolume: this.masterVolume,
        musicVolume: this.musicVolume,
      }));
    } catch {
      // Non-critical: audio should still work without persistence.
    }
  }

  _applyVolumes(immediate = false) {
    if (!this.master) return;
    const t = this.ctx.currentTime;
    const target = this.muted ? 0 : this.masterVolume;
    if (immediate) this.master.gain.setValueAtTime(target, t);
    else this.master.gain.setTargetAtTime(target, t, 0.025);
    this._applyMusicVolume(immediate);
  }

  _applyMusicVolume(immediate = false) {
    if (!this.musicBus) return;
    const t = this.ctx.currentTime;
    const cfg = this._musicConfig();
    const target = this.muted ? 0 : this.musicVolume * cfg.gain;
    if (immediate) this.musicBus.gain.setValueAtTime(target, t);
    else this.musicBus.gain.setTargetAtTime(target, t, 0.08);
  }

  _impulse(seconds, decay) {
    const rate = this.ctx.sampleRate;
    const len = Math.floor(rate * seconds);
    const buf = this.ctx.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const d = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, decay);
      }
    }
    return buf;
  }

  _noiseBuffer(seconds = 2) {
    const rate = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, Math.max(1, Math.floor(rate * seconds)), rate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    return buf;
  }

  _trackVoice(source) {
    this.musicDebug.voices++;
    source.onended = () => { this.musicDebug.voices = Math.max(0, this.musicDebug.voices - 1); };
  }

  _connectMusic(node, wet = 0) {
    node.connect(this.musicBus);
    if (wet > 0 && this.wetIn && this.musicQuality.reverb) {
      const send = this.ctx.createGain();
      send.gain.value = wet;
      node.connect(send);
      send.connect(this.wetIn);
    }
  }

  /* ----------------------------- engine ---------------------------- */
  _buildEngine() {
    const ctx = this.ctx;
    const out = ctx.createGain();
    out.gain.value = 0;
    out.connect(this.master);

    const asym = ctx.createWaveShaper();
    const curve = new Float32Array(2048);
    for (let i = 0; i < curve.length; i++) {
      const x = (i / (curve.length / 2)) - 1;
      curve[i] = Math.tanh((x + 0.12 * x * x) * 3.2) * 0.92;
    }
    asym.curve = curve;
    asym.oversample = '2x';

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 900;
    filter.Q.value = 1.4;

    // four detuned oscillators plus a breathy intake noise source give a lumpy kart exhaust.
    const oscs = [];
    for (const [type, detune, gain] of [['sawtooth', 0, 0.48], ['sawtooth', 11, 0.3], ['square', -8, 0.16], ['sine', -1200, 0.42]]) {
      const o = ctx.createOscillator();
      o.type = type;
      o.detune.value = detune;
      const g = ctx.createGain();
      g.gain.value = gain;
      o.connect(g);
      g.connect(asym);
      o.start();
      oscs.push(o);
    }

    const intake = ctx.createBufferSource();
    intake.buffer = this._noiseBuffer(1.5);
    intake.loop = true;
    const intakeBp = ctx.createBiquadFilter();
    intakeBp.type = 'bandpass';
    intakeBp.frequency.value = 1150;
    intakeBp.Q.value = 0.8;
    const intakeGain = ctx.createGain();
    intakeGain.gain.value = 0.018;
    intake.connect(intakeBp); intakeBp.connect(intakeGain); intakeGain.connect(asym);
    intake.start();

    asym.connect(filter);
    filter.connect(out);
    filter.connect(this.wetIn);

    this.engine = { out, filter, oscs, intakeGain, intakeBp, base: 46 };
  }

  /* ------------------------------ skid ----------------------------- */
  _buildSkid() {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(2);
    src.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 2400;
    bp.Q.value = 1.1;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(bp); bp.connect(g); g.connect(this.master); g.connect(this.wetIn);
    src.start();
    this.skid = { gain: g, filter: bp };
  }

  /* ---------------------------- ambience --------------------------- */
  _buildAmbience() {
    const ctx = this.ctx;
    // sea / wind bed
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(4);
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    const g = ctx.createGain();
    g.gain.value = 0.05;
    src.connect(lp); lp.connect(g); g.connect(this.master);
    src.start();

    // slow swell so the surf breathes
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.09;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 0.028;
    lfo.connect(lfoGain);
    lfoGain.connect(g.gain);
    lfo.start();

    this.ambience = { gain: g };
    this._coquiTimer = 2 + Math.random() * 3;
  }

  /** The two-note "co-quí" whistle of Puerto Rico's tree frog. */
  coqui() {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const o = ctx.createOscillator();
    o.type = 'sine';
    const g = ctx.createGain();
    o.connect(g); g.connect(this.master); g.connect(this.wetIn);
    const p = 0.9 + Math.random() * 0.25;
    o.frequency.setValueAtTime(1180 * p, t);
    o.frequency.setValueAtTime(1180 * p, t + 0.11);
    o.frequency.exponentialRampToValueAtTime(2050 * p, t + 0.13);
    g.gain.setValueAtTime(EPS, t);
    g.gain.exponentialRampToValueAtTime(0.075, t + 0.02);
    g.gain.exponentialRampToValueAtTime(0.055, t + 0.1);
    g.gain.exponentialRampToValueAtTime(EPS, t + 0.34);
    o.start(t); o.stop(t + 0.4);
  }

  /* ----------------------------- music ----------------------------- */
  _buildMusic() {
    const ctx = this.ctx;
    this.musicBus = ctx.createGain();
    this.musicBus.gain.value = 0;
    this.musicDucker = ctx.createGain();
    this.musicDucker.gain.value = 1;
    this.musicBus.connect(this.musicDucker);
    this.musicDucker.connect(this.master);
    this.musicNoise = this._noiseBuffer(1.25);
    this._applyMusicVolume(true);
  }

  _startMusicScheduler(reset = false) {
    /* Background music now comes from MusicManager; the procedural sequencer
       stays silent but its bus / ducker remain wired for the SFX graph. */
    if (!this.proceduralMusic) return;
    if (reset || !this._nextMusicTime) this._resetMusicClock();
    if (this._musicTimer || this._offline) return;
    this._musicTimer = setInterval(() => this._musicSchedulerTick(), this._scheduleIntervalMs);
  }

  _stopMusicScheduler() {
    if (!this._musicTimer) return;
    clearInterval(this._musicTimer);
    this._musicTimer = null;
  }

  _resetMusicClock() {
    if (!this.ctx) return;
    this._musicStep = 0;
    this._nextMusicTime = this.ctx.currentTime + 0.045;
    this.musicDebug.nextNoteTime = this._nextMusicTime;
  }

  _stepDuration() {
    return 60 / this._musicBpm / 4;
  }

  _musicSchedulerTick() {
    if (!this.ready || this.muted || !this.ctx || this.ctx.state === 'suspended') return;
    const now = this.ctx.currentTime;
    const stepDur = this._stepDuration();
    if (!this._nextMusicTime || this._nextMusicTime < now - 0.25) {
      const missed = Math.max(0, Math.floor((now - this._nextMusicTime) / stepDur));
      this._musicStep += Math.min(missed, 64);
      this._nextMusicTime = now + 0.025;
    }

    let scheduled = 0;
    while (this._nextMusicTime < now + this._lookAhead && scheduled < this._maxStepsPerTick) {
      this._scheduleMusicStep(this._musicStep, this._nextMusicTime);
      this._musicStep++;
      this._nextMusicTime += this._stepDuration();
      scheduled++;
    }
    this.musicDebug.nextNoteTime = this._nextMusicTime;
    this.musicDebug.lastScheduleAt = now;
  }

  _scheduleMusicRange(startTime, duration) {
    const end = startTime + duration;
    let t = startTime;
    let step = 0;
    while (t < end) {
      this._scheduleMusicStep(step, t);
      step++;
      t += this._stepDuration();
    }
  }

  _scheduleMusicStep(step, t) {
    const state = this.musicState;
    if (state === 'finished') this._scheduleFinishedStep(step, t);
    else this._scheduleGrooveStep(step, t);
    this.musicDebug.scheduledSteps++;
  }

  _scheduleGrooveStep(step, t) {
    const cfg = this._musicConfig();
    const vel = cfg.energy * this.intensity;
    const s16 = step % 16;
    const s32 = step % 32;
    const bar = Math.floor(step / 16);
    const chord = PROGRESSION[bar % PROGRESSION.length];
    const nextChord = PROGRESSION[(bar + 1) % PROGRESSION.length];
    const race = this.musicState === 'race' || this.musicState === 'finalLap';
    const finalLap = this.musicState === 'finalLap';
    const countdown = this.musicState === 'countdown';
    const menu = this.musicState === 'menu';

    if (CLAVE_32.has(s32)) this._clave(t, 0.62 * vel);

    // Shaker runs the whole time except during the countdown, thinning out on
    // the menu so the loop stays restful.
    if (!countdown && SHAKER_16.has(s16) && (!menu || s16 % 4 === 3)) {
      this._shaker(t, (menu ? 0.05 : race ? 0.085 : 0.065) * vel, s16 === 7 || s16 === 15);
    }

    if (!countdown && GUIRO_16.has(s16) && (!menu || step % 32 < 16)) {
      this._guiro(t, s16 === 14 || finalLap, (menu ? 0.19 : 0.26) * vel);
    }

    if (!countdown) {
      if (s16 === 4) this._conga(t, 'slap', 0.32 * vel);
      if (s16 === 7) this._conga(t, 'openHi', 0.36 * vel);
      if (s16 === 12) this._conga(t, 'mute', 0.24 * vel);
      if (s16 === 15) this._conga(t, 'openLo', 0.42 * vel);
    } else if (s16 === 12 || (bar > 1 && s16 === 14)) {
      this._conga(t, 'openLo', 0.25 * vel);
    }

    if (race) {
      if (s16 === 0 || s16 === 8 || s16 === 14 || (finalLap && (s16 === 4 || s16 === 10))) {
        this._cowbell(t, s16 === 14 || s16 === 10, (finalLap ? 0.34 : 0.25) * vel);
      }
    }

    if (!countdown) {
      if (s16 === 6) this._bass(midiToHz(chord.root + 12), t, 1.75, (menu ? 0.08 : 0.13) * vel);
      if (s16 === 12) this._bass(midiToHz(chord.root + 7), t, 2.2, (menu ? 0.075 : 0.12) * vel);
      if (race && (s16 === 15 || (finalLap && s16 === 3))) this._bass(midiToHz(nextChord.root + 12), t, 0.8, 0.06 * vel);
    }

    if (this.musicQuality.piano && !countdown && MONTUNO[s16] && (!menu || s16 % 2 === 0 || s16 === 3)) {
      const tones = MONTUNO[s16].map((i) => chord.tones[i]);
      this._pianoMontuno(tones, t, (menu ? 0.04 : 0.055) * vel);
    }

    // Offbeat skank on the pan: the upstroke that gives the groove its lilt.
    // Held longer on the menu, where there is room for it to ring out.
    if (this.musicQuality.pan && !countdown && SKANK_16.has(s16)) {
      const two = s16 % 8 === 2 ? [chord.tones[1], chord.tones[3]] : [chord.tones[2], chord.tones[4]];
      const voicing = this.musicQuality.tier === 'low' ? two.slice(0, 1) : two;
      this._steelPan(voicing, t, (menu ? 0.055 : race ? 0.075 : 0.06) * vel, menu ? 0.72 : 0.5);
    }

    // ...and a pan answer over the back half of each phrase, drawn from the
    // chord rather than from any written tune.
    if (this.musicQuality.pan && race) {
      const phraseStep = step % 64;
      if (phraseStep === 24 || phraseStep === 27 || phraseStep === 56 || (finalLap && phraseStep === 40)) {
        const pick = (phraseStep % 7) % chord.tones.length;
        this._steelPan([chord.tones[pick] + 12], t, 0.06 * vel, 0.8);
      }
    }

    if (this.musicQuality.horns && race) {
      const phraseStep = step % 64;
      if (phraseStep === 44 || phraseStep === 46 || phraseStep === 60 || (finalLap && phraseStep === 30)) {
        this._hornStab(chord.horn, t, (finalLap ? 0.12 : 0.085) * vel);
      }
    }
  }

  _scheduleFinishedStep(step, t) {
    const s16 = step % 16;
    const bar = Math.floor(step / 16);
    const cadence = [PROGRESSION[0], PROGRESSION[1], PROGRESSION[2], PROGRESSION[2]];
    const chord = cadence[bar % cadence.length];
    const vel = this._musicConfig().energy * this.intensity;

    if ([0, 6, 12].includes(s16)) this._clave(t, 0.42 * vel);
    if ([4, 12].includes(s16)) this._conga(t, s16 === 4 ? 'openHi' : 'openLo', 0.24 * vel);
    if (SHAKER_16.has(s16) && s16 % 4 === 3) this._shaker(t, 0.055 * vel, s16 === 15);
    if (s16 === 0) this._bass(midiToHz(chord.root + 12), t, 3.5, 0.12 * vel);
    if (this.musicQuality.piano && [0, 3, 8, 11].includes(s16)) {
      this._pianoMontuno(chord.tones.slice(1, 3), t, 0.05 * vel);
    }
    if (this.musicQuality.pan && SKANK_16.has(s16)) {
      this._steelPan([chord.tones[2], chord.tones[4]], t, 0.07 * vel, 0.8);
    }
    if (this.musicQuality.horns && (s16 === 0 || (bar % 4 === 2 && s16 === 12))) {
      this._hornStab(chord.horn, t, 0.12 * vel, s16 === 0 ? 0.22 : 0.48);
    }
  }

  _noiseBurst(t, dur, freq, vol, q = 1, type = 'bandpass') {
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.musicNoise || this._noiseBuffer(1);
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t);
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(EPS, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.006);
    g.gain.exponentialRampToValueAtTime(EPS, t + dur);
    src.connect(f); f.connect(g); this._connectMusic(g, 0.03);
    const offset = Math.random() * 0.5;
    src.start(t, offset, dur + 0.02); src.stop(t + dur + 0.03);
    this._trackVoice(src);
    this.musicDebug.scheduledNotes++;
  }

  _clave(t, vol) {
    this._noiseBurst(t, 0.045, 2600, vol * 0.16, 5.5, 'bandpass');
    const ctx = this.ctx;
    const o = ctx.createOscillator();
    o.type = 'triangle';
    const g = ctx.createGain();
    o.connect(g); this._connectMusic(g, 0.025);
    o.frequency.setValueAtTime(1780, t);
    o.frequency.exponentialRampToValueAtTime(1180, t + 0.032);
    g.gain.setValueAtTime(EPS, t);
    g.gain.exponentialRampToValueAtTime(vol * 0.09, t + 0.004);
    g.gain.exponentialRampToValueAtTime(EPS, t + 0.055);
    o.start(t); o.stop(t + 0.07);
    this._trackVoice(o);
    this.musicDebug.scheduledNotes++;
  }

  _conga(t, kind, vol) {
    const table = {
      mute: [185, 105, 0.08, 0.08],
      slap: [420, 170, 0.075, 0.11],
      openHi: [310, 145, 0.18, 0.14],
      openLo: [215, 92, 0.24, 0.17],
    }[kind];
    const [from, to, dur, gain] = table;
    const ctx = this.ctx;
    this._noiseBurst(t, Math.min(0.04, dur), 1700, vol * 0.06, 1.8, 'bandpass');
    const o = ctx.createOscillator();
    o.type = kind === 'slap' ? 'triangle' : 'sine';
    const g = ctx.createGain();
    o.connect(g); this._connectMusic(g, 0.045);
    o.frequency.setValueAtTime(from, t);
    o.frequency.exponentialRampToValueAtTime(to, t + dur);
    g.gain.setValueAtTime(EPS, t);
    g.gain.exponentialRampToValueAtTime(vol * gain, t + 0.006);
    g.gain.exponentialRampToValueAtTime(EPS, t + dur);
    o.start(t); o.stop(t + dur + 0.04);
    this._trackVoice(o);
    this.musicDebug.scheduledNotes++;
  }

  _guiro(t, long = false, vol = 0.1) {
    const dur = long ? 0.16 : 0.095;
    const ctx = this.ctx;
    const src = ctx.createBufferSource();
    src.buffer = this.musicNoise || this._noiseBuffer(1);
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 2400;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(long ? 3600 : 4300, t);
    bp.frequency.linearRampToValueAtTime(long ? 2200 : 3100, t + dur);
    bp.Q.value = 0.7;
    const g = ctx.createGain();
    g.gain.setValueAtTime(EPS, t);
    g.gain.linearRampToValueAtTime(vol, t + dur * 0.25);
    g.gain.linearRampToValueAtTime(vol * 0.42, t + dur * 0.72);
    g.gain.exponentialRampToValueAtTime(EPS, t + dur);
    src.connect(hp); hp.connect(bp); bp.connect(g); this._connectMusic(g, 0.015);
    src.start(t, Math.random() * 0.6, dur); src.stop(t + dur + 0.01);
    this._trackVoice(src);
    this.musicDebug.scheduledNotes++;
  }

  _cowbell(t, high = false, vol = 0.12) {
    const ctx = this.ctx;
    const mix = ctx.createGain();
    mix.gain.value = 0.5;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = high ? 1180 : 920;
    bp.Q.value = 5.5;
    const g = ctx.createGain();
    mix.connect(bp); bp.connect(g); this._connectMusic(g, 0.025);
    g.gain.setValueAtTime(EPS, t);
    g.gain.exponentialRampToValueAtTime(vol * 0.3, t + 0.004);
    g.gain.exponentialRampToValueAtTime(EPS, t + 0.105);
    for (const f of high ? [680, 1040] : [560, 845]) {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.setValueAtTime(f, t);
      o.connect(mix);
      o.start(t); o.stop(t + 0.12);
      this._trackVoice(o);
    }
    this.musicDebug.scheduledNotes++;
  }

  _bass(freq, t, steps, vol) {
    const ctx = this.ctx;
    const dur = Math.max(0.08, this._stepDuration() * steps);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 520;
    lp.Q.value = 0.8;
    const g = ctx.createGain();
    lp.connect(g); this._connectMusic(g, 0);
    g.gain.setValueAtTime(EPS, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(vol * 0.62, t + dur * 0.58);
    g.gain.exponentialRampToValueAtTime(EPS, t + dur);
    for (const [type, ratio, mix] of [['triangle', 1, 0.78], ['sine', 0.5, 0.5]]) {
      const o = ctx.createOscillator();
      o.type = type;
      const og = ctx.createGain();
      og.gain.value = mix;
      o.frequency.setValueAtTime(freq * ratio * 1.015, t);
      o.frequency.exponentialRampToValueAtTime(freq * ratio, t + Math.min(0.08, dur));
      o.connect(og); og.connect(lp);
      o.start(t); o.stop(t + dur + 0.03);
      this._trackVoice(o);
    }
    this.musicDebug.scheduledNotes++;
  }

  /**
   * Steel pan. The defining Caribbean timbre, and the reason the soundtrack
   * reads as a beach rather than a dancehall: a struck note rings with strong
   * octave and twelfth partials plus a slightly sharp metallic upper one, and
   * decays over most of a second rather than being clipped short like the
   * piano montuno it plays alongside.
   */
  _steelPan(midiNotes, t, vol, dur = 0.62) {
    const ctx = this.ctx;
    for (const midi of midiNotes) {
      const freq = midiToHz(midi);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(2600, t);
      bp.frequency.exponentialRampToValueAtTime(1150, t + dur * 0.7);
      bp.Q.value = 0.7;
      const g = ctx.createGain();
      bp.connect(g); this._connectMusic(g, 0.12);
      g.gain.setValueAtTime(EPS, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.004);
      g.gain.exponentialRampToValueAtTime(vol * 0.28, t + dur * 0.28);
      g.gain.exponentialRampToValueAtTime(EPS, t + dur);
      // 4.16 rather than 4 keeps the top partial inharmonic, which is what
      // gives a pan its shimmer instead of sounding like a plain organ.
      // Mixes sum to 1.0 so the envelope peak really is `vol` -- four partials
      // at their natural relative strengths would otherwise be close to twice
      // as loud as asked for, and the pan is dense enough to eat the mix. The
      // low tier keeps the octave but drops the two upper partials, which is
      // half the oscillators for most of the character.
      const partials = this.musicQuality.tier === 'low'
        ? [[1, 0.66, 0], [2, 0.34, 4]]
        : [[1, 0.53, 0], [2, 0.27, 4], [3, 0.14, -5], [4.16, 0.06, 7]];
      for (const [ratio, mix, detune] of partials) {
        const o = ctx.createOscillator();
        o.type = 'sine';
        o.detune.value = detune;
        o.frequency.setValueAtTime(freq * ratio, t);
        const og = ctx.createGain();
        og.gain.setValueAtTime(mix, t);
        // Upper partials die away first, as they do on a struck metal sheet.
        og.gain.exponentialRampToValueAtTime(Math.max(EPS, mix * 0.12), t + dur * (0.9 / ratio));
        o.connect(og); og.connect(bp);
        o.start(t); o.stop(t + dur + 0.05);
        this._trackVoice(o);
      }
      this.musicDebug.scheduledNotes++;
    }
  }

  /** Shaker / maraca: the sea-breeze sixteenths under the groove. */
  _shaker(t, vol, accent = false) {
    this._noiseBurst(t, accent ? 0.055 : 0.038, accent ? 7200 : 6100, vol, accent ? 1.5 : 1.1, 'highpass');
  }

  _pianoMontuno(midiNotes, t, vol) {
    const ctx = this.ctx;
    const dur = Math.min(0.13, this._stepDuration() * 0.88);
    for (const midi of midiNotes) {
      const freq = midiToHz(midi);
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.value = 1400;
      bp.Q.value = 0.9;
      const g = ctx.createGain();
      bp.connect(g); this._connectMusic(g, 0.035);
      g.gain.setValueAtTime(EPS, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.006);
      g.gain.exponentialRampToValueAtTime(vol * 0.2, t + dur * 0.45);
      g.gain.exponentialRampToValueAtTime(EPS, t + dur);
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.setValueAtTime(freq, t);
      o.connect(bp);
      o.start(t); o.stop(t + dur + 0.025);
      this._trackVoice(o);
      this.musicDebug.scheduledNotes++;
    }
  }

  _hornStab(midiNotes, t, vol, dur = 0.18) {
    const ctx = this.ctx;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1900, t);
    lp.frequency.exponentialRampToValueAtTime(850, t + dur);
    lp.Q.value = 1.2;
    const g = ctx.createGain();
    lp.connect(g); this._connectMusic(g, 0.08);
    g.gain.setValueAtTime(EPS, t);
    g.gain.linearRampToValueAtTime(vol, t + 0.025);
    g.gain.exponentialRampToValueAtTime(EPS, t + dur);
    for (const midi of midiNotes) {
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.detune.value = (Math.random() - 0.5) * 6;
      o.frequency.setValueAtTime(midiToHz(midi), t);
      o.connect(lp);
      o.start(t); o.stop(t + dur + 0.04);
      this._trackVoice(o);
    }
    this.musicDebug.scheduledNotes++;
  }

  _duckMusic(amount = 0.52, duration = 0.55) {
    if (!this.musicDucker || this.muted) return;
    const t = this.ctx.currentTime;
    const g = this.musicDucker.gain;
    g.cancelScheduledValues(t);
    g.setValueAtTime(Math.min(g.value || 1, amount), t);
    g.setTargetAtTime(1, t + duration, 0.16);
  }

  /* ----------------------------- one-shots -------------------------- */
  _tone(freq, dur, type = 'sine', vol = 0.2, slideTo = null, delay = 0) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime + delay;
    const o = ctx.createOscillator();
    o.type = type;
    const g = ctx.createGain();
    o.connect(g); g.connect(this.master); g.connect(this.wetIn);
    o.frequency.setValueAtTime(freq, t);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t + dur);
    g.gain.setValueAtTime(EPS, t);
    g.gain.exponentialRampToValueAtTime(vol, t + 0.012);
    g.gain.exponentialRampToValueAtTime(EPS, t + dur);
    o.start(t); o.stop(t + dur + 0.05);
  }

  _noiseHit(dur = 0.4, freq = 900, vol = 0.35, q = 0.8) {
    if (!this.ready) return;
    const ctx = this.ctx;
    const t = ctx.currentTime;
    const src = ctx.createBufferSource();
    src.buffer = this._noiseBuffer(1);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(freq, t);
    bp.frequency.exponentialRampToValueAtTime(Math.max(80, freq * 0.25), t + dur);
    bp.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(EPS, t + dur);
    src.connect(bp); bp.connect(g); g.connect(this.master); g.connect(this.wetIn);
    src.start(t); src.stop(t + dur + 0.05);
  }

  count(n) {
    this._duckMusic(0.72, 0.16);
    this._tone(n > 0 ? 660 : 990, 0.28, 'square', 0.16);
  }
  go() {
    this._duckMusic(0.62, 0.45);
    this._tone(880, 0.5, 'square', 0.2, 1320);
    this._tone(1320, 0.6, 'triangle', 0.12, 1760, 0.06);
  }
  boost() { this._noiseHit(0.55, 3100, 0.32, 0.7); this._tone(210, 0.42, 'sawtooth', 0.16, 960); this._tone(840, 0.18, 'triangle', 0.08, 1500, 0.03); }
  hop() { this._tone(520, 0.09, 'square', 0.08, 760); }
  drift() { this._tone(1400, 0.12, 'triangle', 0.06, 2100); }
  pickup() { [660, 880, 1320].forEach((f, i) => this._tone(f, 0.14, i === 2 ? 'triangle' : 'square', 0.13, null, i * 0.06)); }
  itemReady() { this._tone(1046, 0.16, 'triangle', 0.14, 1568); this._tone(2093, 0.09, 'sine', 0.06, null, 0.1); }
  throwItem() { this._noiseHit(0.22, 2100, 0.22, 1.4); this._tone(360, 0.16, 'square', 0.06, 180); }
  hit() { this._duckMusic(0.55, 0.32); this._noiseHit(0.5, 620, 0.55, 0.55); this._tone(150, 0.35, 'sawtooth', 0.22, 60); }
  explode() { this._duckMusic(0.38, 0.8); this._noiseHit(0.9, 360, 0.68, 0.42); this._tone(90, 0.75, 'sine', 0.34, 40); this._tone(52, 0.55, 'triangle', 0.18, 34, 0.03); }
  horn() { [392, 494, 587].forEach((f) => this._tone(f, 0.5, 'sawtooth', 0.1)); }
  /** Bodywork against bodywork. Light contact scrapes; hard contact bangs. */
  crash(force = 0.5) {
    const f = Math.min(1, Math.max(0.05, force));
    if (f < 0.5) { this._noiseHit(0.16 + f * 0.2, 2600, 0.1 + f * 0.16, 1.6); return; }
    this._duckMusic(0.6, 0.26);
    this._noiseHit(0.34, 900, 0.22 + f * 0.3, 0.7);
    this._tone(120 + Math.random() * 40, 0.28, 'sawtooth', 0.1 + f * 0.12, 55);
  }
  lap() { this._duckMusic(0.62, 0.35); [784, 988, 1175].forEach((f, i) => this._tone(f, 0.22, 'triangle', 0.13, null, i * 0.09)); }
  finish() {
    this._duckMusic(0.34, 1.2);
    [523, 659, 784, 1046].forEach((f, i) => this._tone(f, 0.5, 'triangle', 0.16, null, i * 0.13));
  }

  /* ---------------------------- per-frame --------------------------- */
  update(dt, player) {
    if (!this.ready || !this.enabled) return;
    const ctx = this.ctx;
    const e = this.engine;

    const speedN = Math.min(1.4, Math.abs(player.speed) / 34);
    // fake gearbox: the note climbs, snaps back, climbs again
    const gear = Math.floor(speedN * 4);
    const within = speedN * 4 - gear;
    const rpm = 0.35 + within * 0.65 + gear * 0.09;
    const boost = player.boostTime > 0 ? 1 : 0;
    const freq = e.base * (1 + rpm * 2.4) * (boost ? 1.22 : 1);
    const wobble = 1 + Math.sin((ctx.currentTime * (18 + rpm * 12)) % (Math.PI * 2)) * 0.006;
    e.oscs[0].frequency.setTargetAtTime(freq * wobble, ctx.currentTime, 0.03);
    e.oscs[1].frequency.setTargetAtTime(freq * 1.005, ctx.currentTime, 0.03);
    e.oscs[2].frequency.setTargetAtTime(freq * 0.5, ctx.currentTime, 0.04);
    e.oscs[3].frequency.setTargetAtTime(freq * 0.5, ctx.currentTime, 0.05);
    e.filter.frequency.setTargetAtTime(650 + rpm * 2650 + boost * 520 + (player.offroad ? -260 : 0), ctx.currentTime, 0.05);
    e.filter.Q.setTargetAtTime(1.1 + rpm * 0.9 + boost * 0.4, ctx.currentTime, 0.08);
    e.intakeGain.gain.setTargetAtTime(0.012 + speedN * 0.025 + boost * 0.018, ctx.currentTime, 0.08);
    e.intakeBp.frequency.setTargetAtTime(850 + rpm * 1800, ctx.currentTime, 0.1);
    const vol = 0.08 + speedN * 0.082 + boost * 0.04;
    e.out.gain.setTargetAtTime(player.finished ? 0.02 : vol, ctx.currentTime, 0.08);

    const skidAmt = player.drifting ? 0.13 : (Math.abs(player.lateral) > 6 ? 0.07 : 0);
    this.skid.gain.gain.setTargetAtTime(skidAmt, ctx.currentTime, 0.06);
    this.skid.filter.frequency.setTargetAtTime(1800 + Math.abs(player.lateral) * 90, ctx.currentTime, 0.1);

    this._coquiTimer -= dt;
    if (this._coquiTimer <= 0) {
      this.coqui();
      this._coquiTimer = 1.6 + Math.random() * 4.5;
    }
  }
}

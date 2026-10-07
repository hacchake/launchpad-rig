// 試し弾き用シンセ(WebAudio)。実機・DAWが無くても音で確かめられるように。
// 音色(INSTRUMENTS)は左手・右手で別々に選べる。ドラム、和音パッドもここで鳴らす。
// 共通の出口にリバーブとテンポ同期のピンポンディレイを掛ける。
(function (LP) {
  'use strict';
  const { clamp } = LP.util;
  const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12);

  const INSTRUMENTS = [
    { id: 'mallet', name: 'マリンバ' },
    { id: 'bell', name: 'ガラスベル' },
    { id: 'epiano', name: 'エレピ' },
    { id: 'kalimba', name: 'カリンバ' },
    { id: 'musicbox', name: 'オルゴール' },
    { id: 'pluck', name: 'シンセ・プラック' },
    { id: 'steel', name: 'スチールパン' },
    { id: 'lead', name: 'やわらかリード' },
    { id: 'chip', name: 'チップチューン' },
    { id: 'bass', name: 'ベース(1オクターブ下)' },
  ];

  const PAD_TYPES = [
    { id: 'warm', name: 'ウォーム' },
    { id: 'airy', name: 'エアリー' },
    { id: 'glass', name: 'グラス' },
    { id: 'off', name: 'なし' },
  ];

  class Synth {
    constructor() {
      this.ctx = null;
      this.enabled = true;
      this.volume = 0.7;
      this.reverb = 0.35;
      this.padType = 'warm';
      this.bpm = 120;
      this.voices = 0;
      this.pad = null;
    }

    get padOn() { return this.padType !== 'off'; }

    // ブラウザの制約で、ユーザー操作の中で初めて呼ばれた時に音が出せるようになる
    ensure() {
      if (!this.enabled) return null;
      if (!this.ctx) this._build();
      if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }

    _build() {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      const ctx = (this.ctx = new AC());

      this.master = ctx.createGain();
      this.master.gain.value = this.volume * 0.95;
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 30;
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -16;
      comp.knee.value = 12;
      comp.ratio.value = 3;
      comp.attack.value = 0.005;
      comp.release.value = 0.25;
      this.master.connect(hp);
      hp.connect(comp);
      comp.connect(ctx.destination);

      // 各音の出口(ドライ)
      this.bus = ctx.createGain();
      this.bus.connect(this.master);

      // リバーブ
      const conv = ctx.createConvolver();
      conv.buffer = this._impulse(3.4, 2.6);
      this.revSend = ctx.createGain();
      this.revSend.gain.value = this.reverb;
      const revOut = ctx.createGain();
      revOut.gain.value = 1.6;
      this.bus.connect(this.revSend);
      this.revSend.connect(conv);
      conv.connect(revOut);
      revOut.connect(this.master);

      // ピンポンディレイ(付点8分、テンポに追従)
      this.dl = ctx.createDelay(2);
      this.dr = ctx.createDelay(2);
      const fb = ctx.createGain();
      fb.gain.value = 0.3;
      const tone = ctx.createBiquadFilter();
      tone.type = 'lowpass';
      tone.frequency.value = 2800;
      const merger = ctx.createChannelMerger(2);
      const dSend = ctx.createGain();
      dSend.gain.value = 0.14;
      this.bus.connect(dSend);
      dSend.connect(this.dl);
      this.dl.connect(this.dr);
      this.dr.connect(tone);
      tone.connect(fb);
      fb.connect(this.dl);
      this.dl.connect(merger, 0, 0);
      this.dr.connect(merger, 0, 1);
      merger.connect(this.master);
      merger.connect(this.revSend);

      // 和音パッドの通り道
      this.padFilter = ctx.createBiquadFilter();
      this.padFilter.type = 'lowpass';
      this.padFilter.frequency.value = 400;
      this.padFilter.Q.value = 0.8;
      this.padGain = ctx.createGain();
      this.padGain.gain.value = 0;
      this.padFilter.connect(this.padGain);
      this.padGain.connect(this.bus);

      // ドラム用ノイズ
      const len = ctx.sampleRate;
      this.noise = ctx.createBuffer(1, len, ctx.sampleRate);
      const nd = this.noise.getChannelData(0);
      for (let i = 0; i < len; i++) nd[i] = Math.random() * 2 - 1;

      this.setTempo(this.bpm);
    }

    // 減衰ノイズで作るリバーブの残響。時間とともに暗くなるよう、なめらかさを増していく。
    _impulse(sec, decay) {
      const ctx = this.ctx;
      const rate = ctx.sampleRate;
      const len = Math.floor(rate * sec);
      const pre = Math.floor(rate * 0.018);
      const buf = ctx.createBuffer(2, len, rate);
      for (let ch = 0; ch < 2; ch++) {
        const data = buf.getChannelData(ch);
        let lp = 0;
        for (let i = pre; i < len; i++) {
          const t = i / len;
          const n = (Math.random() * 2 - 1) * Math.pow(1 - t, decay);
          lp += (n - lp) * (0.12 + 0.75 * (1 - t));
          data[i] = lp;
        }
      }
      return buf;
    }

    setTempo(bpm) {
      this.bpm = bpm;
      if (!this.ctx) return;
      const t = clamp((60 / bpm) * 0.75, 0.09, 1.5);
      const now = this.ctx.currentTime;
      this.dl.delayTime.setTargetAtTime(t, now, 0.05);
      this.dr.delayTime.setTargetAtTime(t, now, 0.05);
    }

    setVolume(v) {
      this.volume = v;
      if (this.ctx) this.master.gain.setTargetAtTime(v * 0.95, this.ctx.currentTime, 0.05);
    }

    setReverb(r) {
      this.reverb = r;
      if (this.ctx) this.revSend.gain.setTargetAtTime(r, this.ctx.currentTime, 0.05);
    }

    // 1音ぶんの出口(定位つき)を作る。end 秒後に片付ける。
    _out(pan) {
      const ctx = this.ctx;
      const out = ctx.createGain();
      const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (panner) { panner.pan.value = clamp(pan, -1, 1); out.connect(panner); panner.connect(this.bus); }
      else out.connect(this.bus);
      return out;
    }

    _release(out, end) {
      this.voices++;
      setTimeout(() => { this.voices--; out.disconnect(); }, (end - this.ctx.currentTime) * 1000 + 200);
    }

    // note: MIDIノート番号 / voice: 音色ID / when: 今から何秒後に鳴らすか(ストラム用)
    play(note, velocity = 100, { pan = 0, voice = 'bell', when = 0 } = {}) {
      if (!this.enabled) return;
      const ctx = this.ensure();
      if (!ctx || this.voices > 48) return;
      const t = ctx.currentTime + 0.005 + when;
      const f = mtof(note);
      // 高い音ほど耳に刺さるので少し控えめに
      const v = Math.pow(velocity / 127, 1.4) * 0.3 * clamp(1.25 - (note - 60) / 50, 0.45, 1.3);
      const out = this._out(pan);
      const fn = this['_' + voice] || this._bell;
      const end = fn.call(this, t, f, v, out, note, velocity);
      this._release(out, end);
    }

    // ---------- 音色 ----------
    // FM: carrier の周波数を modulator で揺らす。index(揺れ幅)を減衰させると「打った瞬間だけ明るい」音になる。

    _fm(t, f, ratio, idxStart, idxEnd, idxTime, dest) {
      const ctx = this.ctx;
      const c = ctx.createOscillator();
      c.frequency.value = f;
      const m = ctx.createOscillator();
      m.frequency.value = f * ratio;
      const mg = ctx.createGain();
      mg.gain.setValueAtTime(f * idxStart, t);
      mg.gain.exponentialRampToValueAtTime(Math.max(0.01, f * idxEnd), t + idxTime);
      m.connect(mg);
      mg.connect(c.frequency);
      c.connect(dest);
      return [c, m];
    }

    _amp(t, peak, attack, dur, out, sustainAt = 0, sustain = 0) {
      const a = this.ctx.createGain();
      a.gain.setValueAtTime(0.0001, t);
      a.gain.exponentialRampToValueAtTime(peak, t + attack);
      if (sustainAt) a.gain.exponentialRampToValueAtTime(peak * sustain, t + sustainAt);
      a.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      a.connect(out);
      return a;
    }

    _run(oscs, t, end) {
      for (const o of oscs) { o.start(t); o.stop(end + 0.05); }
      return end;
    }

    _bell(t, f, v, out, note, vel) {
      const dur = 2.4;
      const a = this._amp(t, v, 0.006, dur, out, 0.35, 0.3);
      return this._run(this._fm(t, f, 2, 1.3 * (0.5 + vel / 127), 0.06, 1.0, a), t, t + dur);
    }

    _mallet(t, f, v, out, note) {
      const dur = clamp(1.6 - (note - 40) / 60, 0.5, 1.6); // 低いほど長く鳴る
      const a = this._amp(t, v * 1.15, 0.003, dur, out);
      return this._run(this._fm(t, f, 4, 2.2, 0.01, 0.07, a), t, t + dur);
    }

    _epiano(t, f, v, out, note, vel) {
      const dur = clamp(3.2 - (note - 48) / 30, 1.2, 3.2);
      const a = this._amp(t, v, 0.004, dur, out, 0.4, 0.45);
      const body = this._fm(t, f, 1, 0.5 + 0.9 * (vel / 127), 0.05, 1.4, a);
      // 金属的なアタック(ティン)
      const tine = this._amp(t, v * 0.12, 0.002, 0.25, out);
      const ti = this._fm(t, f * 7, 1, 0.3, 0.01, 0.2, tine);
      return this._run(body.concat(ti), t, t + dur);
    }

    _kalimba(t, f, v, out) {
      const ctx = this.ctx;
      const dur = 1.5;
      const a = this._amp(t, v * 1.1, 0.002, dur, out);
      const o = ctx.createOscillator();
      o.frequency.value = f;
      o.connect(a);
      const click = this._amp(t, v * 0.35, 0.001, 0.07, out);
      const o2 = ctx.createOscillator();
      o2.frequency.value = f * 5.95;
      o2.connect(click);
      return this._run([o, o2], t, t + dur);
    }

    _musicbox(t, f, v, out) {
      const ctx = this.ctx;
      const dur = 1.3;
      const a = this._amp(t, v * 0.85, 0.002, dur, out);
      const o = ctx.createOscillator();
      o.frequency.value = f * 2;
      o.connect(a);
      const b = this._amp(t, v * 0.18, 0.002, 0.45, out);
      const o2 = ctx.createOscillator();
      o2.frequency.value = f * 4;
      o2.connect(b);
      return this._run([o, o2], t, t + dur);
    }

    _pluck(t, f, v, out, note, vel) {
      const ctx = this.ctx;
      const dur = 0.9;
      const a = this._amp(t, v * 0.8, 0.003, dur, out);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.Q.value = 3;
      lp.frequency.setValueAtTime(Math.min(16000, f * (2 + 10 * vel / 127)), t);
      lp.frequency.exponentialRampToValueAtTime(f * 1.2, t + 0.35);
      lp.connect(a);
      const o = ctx.createOscillator();
      o.type = 'sawtooth';
      o.frequency.value = f;
      o.connect(lp);
      return this._run([o], t, t + dur);
    }

    _steel(t, f, v, out) {
      const dur = 1.4;
      const a = this._amp(t, v, 0.003, dur, out, 0.15, 0.5);
      return this._run(this._fm(t, f, 3, 1.4, 0.02, 0.15, a), t, t + dur);
    }

    _lead(t, f, v, out, note, vel) {
      const ctx = this.ctx;
      const dur = 1.1;
      const a = this._amp(t, v * 0.55, 0.02, dur, out, 0.3, 0.6);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 900 + 1800 * (vel / 127);
      lp.connect(a);
      const oscs = [-8, 8].map((det) => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.value = f;
        o.detune.value = det;
        o.connect(lp);
        return o;
      });
      return this._run(oscs, t, t + dur);
    }

    _chip(t, f, v, out) {
      const ctx = this.ctx;
      const dur = 0.32;
      const a = ctx.createGain();
      a.gain.setValueAtTime(v * 0.6, t);
      a.gain.setValueAtTime(v * 0.4, t + 0.08);
      a.gain.linearRampToValueAtTime(0.0001, t + dur);
      a.connect(out);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = 5000;
      lp.connect(a);
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = f;
      o.connect(lp);
      return this._run([o], t, t + dur);
    }

    _bass(t, f, v, out) {
      const ctx = this.ctx;
      const dur = 1.1;
      const fb = f / 2;
      const a = this._amp(t, v * 1.5, 0.004, dur, out, 0.25, 0.5);
      const lp = ctx.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.setValueAtTime(900, t);
      lp.frequency.exponentialRampToValueAtTime(220, t + 0.4);
      lp.connect(a);
      const s = ctx.createOscillator();
      s.frequency.value = fb;
      s.connect(a);
      const w = ctx.createOscillator();
      w.type = 'sawtooth';
      w.frequency.value = fb;
      w.connect(lp);
      return this._run([s, w], t, t + dur);
    }

    // ---------- ドラム ----------

    drum(kind, velocity = 100, { pan = 0, when = 0 } = {}) {
      if (!this.enabled) return;
      const ctx = this.ensure();
      if (!ctx || this.voices > 48) return;
      const t = ctx.currentTime + 0.005 + when;
      const v = Math.pow(velocity / 127, 1.2) * 0.5;
      const out = this._out(pan * 0.6);
      let end = t + 0.4;
      const noise = (hpf, bpf, peak, dur) => {
        const src = ctx.createBufferSource();
        src.buffer = this.noise;
        let node = src;
        if (hpf) { const h = ctx.createBiquadFilter(); h.type = 'highpass'; h.frequency.value = hpf; node.connect(h); node = h; }
        if (bpf) { const b = ctx.createBiquadFilter(); b.type = 'bandpass'; b.frequency.value = bpf; b.Q.value = 1.2; node.connect(b); node = b; }
        node.connect(this._amp(t, peak, 0.001, dur, out));
        src.start(t);
        src.stop(t + dur + 0.05);
      };
      if (kind === 'kick') {
        const o = ctx.createOscillator();
        o.frequency.setValueAtTime(150, t);
        o.frequency.exponentialRampToValueAtTime(42, t + 0.13);
        o.connect(this._amp(t, v * 1.6, 0.002, 0.38, out));
        this._run([o], t, t + 0.38);
      } else if (kind === 'snare') {
        noise(1200, 0, v * 0.6, 0.18);
        const o = ctx.createOscillator();
        o.type = 'triangle';
        o.frequency.value = 190;
        o.connect(this._amp(t, v * 0.5, 0.001, 0.1, out));
        this._run([o], t, t + 0.1);
      } else if (kind === 'hat') {
        noise(7000, 0, v * 0.35, 0.05);
        end = t + 0.1;
      } else if (kind === 'clap') {
        noise(0, 1500, v * 0.9, 0.16);
      }
      this._release(out, end);
    }

    // ---------- 和音パッド ----------

    // 新しいコードへクロスフェード
    setPadChord(notes) {
      if (!this.enabled || !this.padOn) return;
      const ctx = this.ensure();
      if (!ctx) return;
      const t = ctx.currentTime;
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(1, t + 1.6);
      g.connect(this.padFilter);
      const oscs = [];
      const add = (type, freq, det, gain) => {
        const o = ctx.createOscillator();
        o.type = type;
        o.frequency.value = freq;
        o.detune.value = det;
        const og = ctx.createGain();
        og.gain.value = gain;
        o.connect(og);
        og.connect(g);
        o.start(t);
        oscs.push(o);
      };
      notes.forEach((n, i) => {
        const bass = i === 0;
        if (this.padType === 'warm') {
          for (const det of [-7, 7]) add('sawtooth', mtof(n), det, bass ? 0.07 : 0.045);
        } else if (this.padType === 'airy') {
          for (const det of [-12, 12]) add('triangle', mtof(n), det, bass ? 0.13 : 0.08);
          if (!bass) add('sine', mtof(n + 12), 0, 0.05);
        } else {
          add('sine', mtof(n), 0, bass ? 0.2 : 0.11);
          if (!bass) add('sine', mtof(n + 19), 0, 0.035);
        }
      });
      this._fadeOutPad(t);
      this.pad = { g, oscs };
    }

    _fadeOutPad(t) {
      const old = this.pad;
      if (!old) return;
      old.g.gain.cancelScheduledValues(t);
      old.g.gain.setValueAtTime(Math.max(0.0001, old.g.gain.value), t);
      old.g.gain.linearRampToValueAtTime(0.0001, t + 2);
      for (const o of old.oscs) o.stop(t + 2.1);
      setTimeout(() => old.g.disconnect(), 2300);
      this.pad = null;
    }

    stopPad() {
      if (!this.ctx) return;
      this._fadeOutPad(this.ctx.currentTime);
      this.padGain.gain.setTargetAtTime(0, this.ctx.currentTime, 0.6);
    }

    // activity 0..1: 盤面の活発さ。音量とフィルターの開き具合に反映する。
    setActivity(a) {
      if (!this.ctx) return;
      const now = this.ctx.currentTime;
      const on = this.enabled && this.padOn && this.pad;
      this.padGain.gain.setTargetAtTime(on ? 0.05 + 0.12 * a : 0, now, 0.8);
      this.padFilter.frequency.setTargetAtTime(320 + 2400 * a * a, now, 0.6);
    }
  }

  LP.INSTRUMENTS = INSTRUMENTS;
  LP.PAD_TYPES = PAD_TYPES;
  LP.Synth = Synth;
})(window.LP = window.LP || {});

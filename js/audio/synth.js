// 試し弾き用シンセ(WebAudio)。実機・DAWが無くても音で確かめられるように。
//   mallet : 左手。マリンバ風(FMの4倍音で打鍵感)
//   bell   : 右手。ガラス/エレピ風(FM 2倍音が減衰していく)
//   pad    : 和音パッド。盤面が活発なほど音量とフィルターが開く
// 共通の出口にリバーブとテンポ同期のピンポンディレイを掛ける。
(function (LP) {
  'use strict';
  const { clamp } = LP.util;
  const mtof = (n) => 440 * Math.pow(2, (n - 69) / 12);

  class Synth {
    constructor() {
      this.ctx = null;
      this.enabled = true;
      this.volume = 0.7;
      this.reverb = 0.35;
      this.padOn = true;
      this.bpm = 120;
      this.voices = 0;
      this.pad = null;
    }

    get ready() { return !!this.ctx && this.ctx.state === 'running'; }

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
      hp.frequency.value = 35;
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

    // note: MIDIノート番号 / when: 今から何秒後に鳴らすか(ストラム用)
    play(note, velocity = 100, { pan = 0, voice = 'bell', when = 0 } = {}) {
      if (!this.enabled) return;
      const ctx = this.ensure();
      if (!ctx || this.voices > 40) return;
      const t = ctx.currentTime + 0.005 + when;
      const f = mtof(note);
      // 高い音ほど耳に刺さるので少し控えめに
      const v = Math.pow(velocity / 127, 1.4) * 0.3 * clamp(1.25 - (note - 60) / 50, 0.45, 1.3);

      const out = ctx.createGain();
      const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      if (panner) { panner.pan.value = clamp(pan, -1, 1); out.connect(panner); panner.connect(this.bus); }
      else out.connect(this.bus);

      const end = voice === 'mallet' ? this._mallet(t, f, v, out, note) : this._bell(t, f, v, out, velocity);
      this.voices++;
      setTimeout(() => { this.voices--; out.disconnect(); }, (end - ctx.currentTime) * 1000 + 200);
    }

    _bell(t, f, v, out, velocity) {
      const ctx = this.ctx;
      const dur = 2.4;
      const c = ctx.createOscillator();
      c.frequency.value = f;
      const m = ctx.createOscillator();
      m.frequency.value = f * 2;
      const mg = ctx.createGain();
      const bright = 0.5 + velocity / 127;
      mg.gain.setValueAtTime(f * 1.3 * bright, t);
      mg.gain.exponentialRampToValueAtTime(f * 0.06, t + 1.0);
      m.connect(mg);
      mg.connect(c.frequency);
      const a = ctx.createGain();
      a.gain.setValueAtTime(0.0001, t);
      a.gain.exponentialRampToValueAtTime(v, t + 0.006);
      a.gain.exponentialRampToValueAtTime(v * 0.3, t + 0.35);
      a.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      c.connect(a);
      a.connect(out);
      c.start(t); m.start(t);
      c.stop(t + dur + 0.05); m.stop(t + dur + 0.05);
      return t + dur;
    }

    _mallet(t, f, v, out, note) {
      const ctx = this.ctx;
      const dur = clamp(1.6 - (note - 40) / 60, 0.5, 1.6); // 低いほど長く鳴る
      const c = ctx.createOscillator();
      c.frequency.value = f;
      const m = ctx.createOscillator();
      m.frequency.value = f * 4;
      const mg = ctx.createGain();
      mg.gain.setValueAtTime(f * 2.2, t);
      mg.gain.exponentialRampToValueAtTime(f * 0.01, t + 0.07);
      m.connect(mg);
      mg.connect(c.frequency);
      const a = ctx.createGain();
      a.gain.setValueAtTime(0.0001, t);
      a.gain.exponentialRampToValueAtTime(v * 1.15, t + 0.003);
      a.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      c.connect(a);
      a.connect(out);
      c.start(t); m.start(t);
      c.stop(t + dur + 0.05); m.stop(t + dur + 0.05);
      return t + dur;
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
      notes.forEach((n, i) => {
        for (const det of [-7, 7]) {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = mtof(n);
          o.detune.value = det;
          const og = ctx.createGain();
          og.gain.value = i === 0 ? 0.07 : 0.045;
          o.connect(og);
          og.connect(g);
          o.start(t);
          oscs.push(o);
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

  LP.Synth = Synth;
})(window.LP = window.LP || {});

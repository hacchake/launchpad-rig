// 試し弾き用の簡易シンセ(WebAudio)。実機・DAWが無くても音で確かめられるように。
// 左手は左、右手は右に定位させる。
(function (LP) {
  'use strict';

  class Synth {
    constructor() {
      this.ctx = null;
      this.enabled = false;
      this.volume = 0.22;
      this.voices = 0;
    }

    ensure() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this.volume;
        const comp = this.ctx.createDynamicsCompressor();
        this.master.connect(comp);
        comp.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return this.ctx;
    }

    play(note, velocity = 100, { pan = 0, dur = 0.4 } = {}) {
      if (!this.enabled) return;
      const ctx = this.ensure();
      if (!ctx || this.voices > 24) return;
      const t = ctx.currentTime;
      const f = 440 * Math.pow(2, (note - 69) / 12);
      const v = (velocity / 127) * 0.5;

      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.value = f;
      const sub = ctx.createOscillator();
      sub.type = 'sine';
      sub.frequency.value = f * 2;
      const subGain = ctx.createGain();
      subGain.gain.value = 0.25;

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(v, t + 0.005);
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur);

      const panner = ctx.createStereoPanner ? ctx.createStereoPanner() : null;
      osc.connect(env);
      sub.connect(subGain);
      subGain.connect(env);
      if (panner) { panner.pan.value = pan; env.connect(panner); panner.connect(this.master); }
      else env.connect(this.master);

      this.voices++;
      osc.onended = () => { this.voices--; };
      osc.start(t); sub.start(t);
      osc.stop(t + dur + 0.05); sub.stop(t + dur + 0.05);
    }
  }

  LP.Synth = Synth;
})(window.LP = window.LP || {});

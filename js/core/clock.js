// 時間管理モジュール
// BPM と 1拍あたりのティック数から一定間隔で 'tick' / 'beat' を発行する。
// 描画(requestAnimationFrame)とは独立しているので、将来は WebAudio の時刻や
// 外部MIDIクロックに差し替えられる。
(function (LP) {
  'use strict';
  const { clamp } = LP.util;

  class Clock {
    constructor({ bpm = 120, ticksPerBeat = 4 } = {}) {
      this.bpm = bpm;
      this.ticksPerBeat = ticksPerBeat;
      this.running = false;
      this.tickCount = 0;
      this.anchor = performance.now(); // 直近の拍の時刻(拍の位相計算用)
      this.next = 0;
      this.bus = new LP.EventBus();
      this._timer = null;
    }

    get beatMs() { return 60000 / this.bpm; }
    get tickMs() { return this.beatMs / this.ticksPerBeat; }
    get stepsPerSecond() { return 1000 / this.tickMs; }

    setBpm(bpm) {
      const now = performance.now();
      const phase = this.beatPhase(now);
      this.bpm = clamp(bpm, 20, 400);
      this.anchor = now - phase * this.beatMs; // 位相を保ったままテンポ変更
      this.bus.emit('tempo', this);
    }

    setTicksPerBeat(n) {
      this.ticksPerBeat = n;
      this.bus.emit('tempo', this);
    }

    // 0..1: 直近の拍からどれだけ進んだか(停止中も自走する)
    beatPhase(now = performance.now()) {
      const p = ((now - this.anchor) / this.beatMs) % 1;
      return p < 0 ? p + 1 : p;
    }

    start() {
      if (this.running) return;
      this.running = true;
      const now = performance.now();
      this.next = now;
      this.anchor = now;
      this.tickCount = 0;
      this.bus.emit('start', this);
      this._run();
    }

    stop() {
      if (!this.running) return;
      this.running = false;
      clearTimeout(this._timer);
      this._timer = null;
      this.bus.emit('stop', this);
    }

    toggle() { this.running ? this.stop() : this.start(); }

    _run() {
      if (!this.running) return;
      const now = performance.now();
      let guard = 0;
      while (now >= this.next && guard < 4) {
        const t = this.next;
        if (this.tickCount % this.ticksPerBeat === 0) {
          this.anchor = t;
          this.bus.emit('beat', { time: t, beat: this.tickCount / this.ticksPerBeat });
        }
        this.bus.emit('tick', { time: t, tick: this.tickCount });
        this.tickCount++;
        this.next += this.tickMs;
        guard++;
      }
      // タブが裏に回るなどして大きく遅れたら追いかけずに仕切り直す
      if (now - this.next > 250) this.next = now + this.tickMs;
      this._timer = setTimeout(() => this._run(), clamp(this.next - performance.now(), 1, 15));
    }
  }

  LP.Clock = Clock;
})(window.LP = window.LP || {});

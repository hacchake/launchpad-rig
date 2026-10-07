// Launchpad 抽象化レイヤー
//
//   UI → VirtualLaunchpadView ┐
//                              ├─ LaunchpadDevice(この共通インターフェース)
//   実機 → PhysicalLaunchpadSink ┘
//
// LaunchpadDevice は「8×8パッドを持つ1台」を表す。出力先(sink)は複数持てるので、
// 画面表示と実機LEDを同時に光らせたり、仮想だけ/実機だけにしたりできる。
// 入力も同じく、マウスでもMIDIでも press()/release() を呼ぶだけ。
(function (LP) {
  'use strict';

  class LaunchpadDevice {
    constructor({ id, index, model = 'S' }) {
      this.id = id;
      this.index = index;
      this.model = model;
      // 論理配置: 巨大グリッド上のどのスロットか(col 0=左手, 1=右手 / row 0=上段…)
      this.slot = { col: index % 2, row: Math.floor(index / 2) };
      // 物理配置: 画面上の位置(mm)と回転。論理配置とは独立。
      this.physical = { x: 0, y: 0, rotation: 0, pinned: false };
      this.midi = { outId: '', inId: '' };
      this.bus = new LP.EventBus();
      this.sinks = [];
      this.ledKeys = new Array(64).fill(-1);
      this.leds = new Array(64).fill(null);
    }

    get profile() { return LP.Profiles[this.model]; }
    get label() { return 'LP' + (this.index + 1); }
    get handSide() { return this.slot.col === 0 ? 'left' : 'right'; }
    get rowLayer() { return this.slot.row; }

    setModel(model) {
      if (model === this.model) return;
      this.model = model;
      this.invalidate();
      for (const s of this.sinks) if (s.onModelChange) s.onModelChange(this);
    }

    // 次のフレームで全パッドを送り直させる
    invalidate() { this.ledKeys.fill(-1); }

    // 抽象色でパッドを指定。機種の制約に丸めて、変化があった時だけ sink へ流す。
    setPad(lx, ly, color) {
      const p = this.profile;
      const q = p.quantize(color);
      const k = p.key(q);
      const i = ly * 8 + lx;
      if (this.ledKeys[i] === k) return;
      this.ledKeys[i] = k;
      this.leds[i] = q;
      for (const s of this.sinks) s.setLed(lx, ly, q, this);
    }

    // 1フレーム分の変更をまとめて送る(実機ではSysExをまとめる)
    flush() {
      for (const s of this.sinks) if (s.flush) s.flush(this);
    }

    addSink(sink) {
      if (!this.sinks.includes(sink)) this.sinks.push(sink);
      this.invalidate();
    }

    removeSink(sink) { this.sinks = this.sinks.filter((s) => s !== sink); }

    // 入力(マウス・タッチ・実機MIDI共通)
    press(lx, ly, opts = {}) {
      this.bus.emit('press', Object.assign({ device: this, lx, ly, velocity: 100 }, opts));
    }

    release(lx, ly, opts = {}) {
      this.bus.emit('release', Object.assign({ device: this, lx, ly }, opts));
    }

    dispose() {
      for (const s of this.sinks) if (s.detach) s.detach(this);
      this.sinks = [];
    }
  }

  LP.LaunchpadDevice = LaunchpadDevice;
})(window.LP = window.LP || {});

// パッド → 音程・MIDIチャンネルの対応付け
// handSide(左手/右手)と rowLayer(上段=高音 … 下段=低音)で音域を分ける。
// 各台の中は Launchpad X の Note モードに近い「右へ1音、上へ数音」の等間隔配置。
(function (LP) {
  'use strict';
  const { clamp } = LP.util;

  const SCALES = {
    pentatonic: { name: 'メジャーペンタ', steps: [0, 2, 4, 7, 9] },
    minorPenta: { name: 'マイナーペンタ', steps: [0, 3, 5, 7, 10] },
    major: { name: 'メジャー', steps: [0, 2, 4, 5, 7, 9, 11] },
    minor: { name: 'ナチュラルマイナー', steps: [0, 2, 3, 5, 7, 8, 10] },
    chromatic: { name: 'クロマチック', steps: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11] },
  };

  class NoteMapper {
    constructor() {
      this.scale = 'pentatonic';
      this.root = 36;                       // C2
      this.layerOffset = [24, 12, 0];       // 上段 / 中段 / 下段
      this.handOffset = { left: 0, right: 12 };
      this.channels = { left: 0, right: 1 }; // MIDI ch1 / ch2
    }

    get steps() { return SCALES[this.scale].steps; }

    // 1段上がると何音進むか(おおよそ4度)
    rowStep() {
      const n = this.steps.length;
      return n >= 12 ? 5 : n >= 7 ? 3 : 2;
    }

    baseFor(device) {
      return this.root + (this.layerOffset[device.rowLayer] || 0) + this.handOffset[device.handSide];
    }

    noteFor(device, lx, ly) {
      const steps = this.steps;
      const deg = lx + (7 - ly) * this.rowStep();
      const n = this.baseFor(device) + Math.floor(deg / steps.length) * 12 + steps[deg % steps.length];
      return clamp(n, 0, 127);
    }

    channelFor(device) { return this.channels[device.handSide]; }
  }

  LP.SCALES = SCALES;
  LP.NoteMapper = NoteMapper;
})(window.LP = window.LP || {});

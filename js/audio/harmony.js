// 和声: Clock の拍に合わせてコードを進め、生成モードの音をコードトーンに乗せる。
// Life や Falling Notes のようにどのセルが鳴るか予測できない音でも濁らないようにするため。
(function (LP) {
  'use strict';

  const NAMES = ['C', 'D♭', 'D', 'E♭', 'E', 'F', 'G♭', 'G', 'A♭', 'A', 'B♭', 'B'];

  // root: キーからの度数(半音)、pcs: 構成音(キー基準のピッチクラス)
  const PROGRESSIONS = {
    major: [
      { root: 0, name: 'maj9', pcs: [0, 4, 7, 11, 2] },   // Cmaj9
      { root: 9, name: 'm9', pcs: [9, 0, 4, 7, 11] },     // Am9
      { root: 5, name: 'maj9', pcs: [5, 9, 0, 4, 7] },    // Fmaj9
      { root: 7, name: '9sus4', pcs: [7, 0, 2, 5, 9] },   // G9sus4
    ],
    minor: [
      { root: 0, name: 'm9', pcs: [0, 3, 7, 10, 2] },     // Cm9
      { root: 8, name: 'maj7', pcs: [8, 0, 3, 7] },       // A♭maj7
      { root: 5, name: 'm9', pcs: [5, 8, 0, 3, 7] },      // Fm9
      { root: 10, name: '6', pcs: [10, 2, 5, 7] },        // B♭6
    ],
  };

  class Harmony {
    constructor() {
      this.key = 0;            // C
      this.mode = 'major';
      this.index = 0;
      this.beatsPerChord = 8;  // 2小節ごとにコードチェンジ
      this.bus = new LP.EventBus();
    }

    get chord() { return PROGRESSIONS[this.mode][this.index]; }

    setModeFromScale(scale) {
      const m = scale === 'minor' || scale === 'minorPenta' ? 'minor' : 'major';
      if (m === this.mode) return;
      this.mode = m;
      this.bus.emit('change', this);
    }

    reset() {
      if (this.index === 0) return;
      this.index = 0;
      this.bus.emit('change', this);
    }

    onBeat(beat) {
      const i = Math.floor(beat / this.beatsPerChord) % PROGRESSIONS[this.mode].length;
      if (i === this.index) return;
      this.index = i;
      this.bus.emit('change', this);
    }

    chordName() { return NAMES[(this.key + this.chord.root) % 12] + this.chord.name; }

    // lo..hi の範囲にあるコードトーンを低い順に
    tones(lo, hi) {
      const pcs = new Set(this.chord.pcs.map((p) => (p + this.key) % 12));
      const out = [];
      for (let n = lo; n <= hi; n++) if (pcs.has(n % 12)) out.push(n);
      return out;
    }

    // 和音パッド用: ベース1音 + 中音域のコードトーン3音
    padNotes() {
      const bass = 36 + ((this.key + this.chord.root) % 12);
      return [bass].concat(this.tones(55, 74).slice(0, 3));
    }
  }

  LP.Harmony = Harmony;
})(window.LP = window.LP || {});

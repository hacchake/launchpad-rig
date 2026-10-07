// 共通基盤: イベントバス・保存・数値ユーティリティ
// file:// で直接開けるよう、ES Modules ではなく window.LP 名前空間で各モジュールをつなぐ。
(function (LP) {
  'use strict';

  class EventBus {
    constructor() { this.map = new Map(); }
    on(type, fn) {
      if (!this.map.has(type)) this.map.set(type, new Set());
      this.map.get(type).add(fn);
      return () => this.off(type, fn);
    }
    off(type, fn) {
      const set = this.map.get(type);
      if (set) set.delete(fn);
    }
    emit(type, payload) {
      const set = this.map.get(type);
      if (set) for (const fn of [...set]) fn(payload);
    }
  }

  // localStorage はプライベートウィンドウ等で使えないことがあるので必ず try で包む
  const Store = {
    load(key, fallback) {
      try {
        const s = localStorage.getItem(key);
        return s ? JSON.parse(s) : fallback;
      } catch (e) { return fallback; }
    },
    save(key, value) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 保存できない環境では無視 */ }
    },
  };

  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  const clamp01 = (v) => clamp(v, 0, 1);

  const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
  const noteName = (n) => NOTE_NAMES[n % 12] + (Math.floor(n / 12) - 1);

  LP.EventBus = EventBus;
  LP.Store = Store;
  LP.util = { clamp, clamp01, noteName };
  // 画面上の物理配置は「mm」で管理し、ステージ上では 1mm = MM_PX px で描く
  LP.MM_PX = 2;
  // アプリ全体のイベント(将来のMIDI変換などがここを購読する)
  LP.bus = new EventBus();
})(window.LP = window.LP || {});

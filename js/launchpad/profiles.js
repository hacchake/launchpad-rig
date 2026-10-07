// 機種プロファイル: 抽象色 → 実機で表現できる色(quantize)→ 画面表示色(display)
// 将来の実機出力は quantize() の結果をそのまま MIDI に変換する(midi/midi-adapter.js)。
(function (LP) {
  'use strict';
  const { clamp01 } = LP.util;

  // Launchpad S: 赤LEDと緑LEDの2色 × 各4段階(0..3)。青は無い。
  const S_LEVEL = [0, 0.38, 0.68, 1];
  const S_RED_LED = [1, 0.1, 0.03];
  const S_GREEN_LED = [0.28, 1, 0.1];

  const Profiles = {
    S: {
      id: 'S',
      name: 'Launchpad S',
      rgb: false,
      bodyMm: 245, // おおよその本体寸法(正方形)
      colorDepth: '赤/緑LED 各4段階 (16色)',
      quantize(c) {
        // 青成分は赤・緑へ少しだけ逃がす(青い指定がまったく消えないように)
        const r = clamp01(c.r + 0.15 * c.b);
        const g = clamp01(c.g + 0.15 * c.b);
        return {
          red: Math.min(3, Math.floor(r * 3 + 0.35)),
          green: Math.min(3, Math.floor(g * 3 + 0.35)),
        };
      },
      key: (q) => q.red * 4 + q.green,
      off: () => ({ red: 0, green: 0 }),
      display(q) {
        if (!q.red && !q.green) return null;
        const a = S_LEVEL[q.red], b = S_LEVEL[q.green];
        return {
          r: Math.min(1, S_RED_LED[0] * a + S_GREEN_LED[0] * b),
          g: Math.min(1, S_RED_LED[1] * a + S_GREEN_LED[1] * b),
          b: Math.min(1, S_RED_LED[2] * a + S_GREEN_LED[2] * b),
          level: Math.max(a, b),
        };
      },
      // 実機の Note On ベロシティ = 緑*16 + 赤 + フラグ(0x0C = 通常表示)
      velocity: (q) => (q.green << 4) | q.red | 0x0c,
    },

    X: {
      id: 'X',
      name: 'Launchpad X',
      rgb: true,
      bodyMm: 180,
      colorDepth: 'RGB 各127段階',
      quantize(c) {
        const f = (v) => (v < 0.012 ? 0 : Math.round(clamp01(v) * 127));
        return { r: f(c.r), g: f(c.g), b: f(c.b) };
      },
      key: (q) => (q.r << 14) | (q.g << 7) | q.b,
      off: () => ({ r: 0, g: 0, b: 0 }),
      display(q) {
        if (!q.r && !q.g && !q.b) return null;
        return { r: q.r / 127, g: q.g / 127, b: q.b / 127, level: Math.max(q.r, q.g, q.b) / 127 };
      },
    },
  };

  LP.Profiles = Profiles;
})(window.LP = window.LP || {});

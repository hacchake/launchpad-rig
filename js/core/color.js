// 抽象色 {r,g,b}(各 0..1)。機種ごとの制約はここでは扱わず、
// launchpad/profiles.js の quantize() が実機の表現へ変換する。
(function (LP) {
  'use strict';
  const { clamp01 } = LP.util;

  const Color = {
    rgb: (r, g, b) => ({ r, g, b }),
    fromHex(hex) {
      let h = String(hex).replace('#', '');
      if (h.length === 3) h = h.split('').map((c) => c + c).join('');
      const n = parseInt(h, 16) || 0;
      return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
    },
    toHex(c) {
      const f = (v) => Math.round(clamp01(v) * 255).toString(16).padStart(2, '0');
      return '#' + f(c.r) + f(c.g) + f(c.b);
    },
    scale: (c, k) => ({ r: c.r * k, g: c.g * k, b: c.b * k }),
  };

  // Manual モードのパレット(Launchpad S では赤/緑LEDの範囲に丸められる)
  const PALETTE = [
    { name: '赤', hex: '#ff1e14' },
    { name: 'オレンジ', hex: '#ff6a00' },
    { name: '黄', hex: '#ffd000' },
    { name: '緑', hex: '#18ff3c' },
    { name: 'シアン', hex: '#00e1ff' },
    { name: '青', hex: '#1f3dff' },
    { name: '紫', hex: '#a42cff' },
    { name: '白', hex: '#ffffff' },
  ];

  LP.Color = Color;
  LP.PALETTE = PALETTE;
})(window.LP = window.LP || {});

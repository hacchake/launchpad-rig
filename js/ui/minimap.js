// 論理グリッドの俯瞰図。物理配置(ドラッグ・回転)に関係なく、
// 内部の 16×N グリッドと各台の論理スロットを表示する。
(function (LP) {
  'use strict';

  class Minimap {
    constructor(canvas) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.cell = 5;
    }

    draw(grid, anim, rig) {
      if (!grid || !anim.cur) return;
      const s = this.cell, w = grid.width * s, h = grid.height * s;
      const dpr = window.devicePixelRatio || 1;
      const cv = this.canvas;
      if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
        cv.width = Math.round(w * dpr);
        cv.height = Math.round(h * dpr);
        cv.style.width = w + 'px';
        cv.style.height = h + 'px';
      }
      const ctx = this.ctx;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.fillStyle = '#0b0c0e';
      ctx.fillRect(0, 0, w, h);
      const cur = anim.cur;
      for (const c of grid.cells) {
        const x = c.globalX * s, y = c.globalY * s;
        if (c.void) continue;
        const j = c.index * 3;
        const r = Math.min(255, 34 + cur[j] * 230), g = Math.min(255, 35 + cur[j + 1] * 230), b = Math.min(255, 38 + cur[j + 2] * 230);
        ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
        ctx.fillRect(x + 0.5, y + 0.5, s - 1, s - 1);
      }
      ctx.lineWidth = 1;
      ctx.font = '600 8px ui-monospace, Consolas, monospace';
      for (const d of rig.devices) {
        const x = d.slot.col * 8 * s, y = d.slot.row * 8 * s;
        ctx.strokeStyle = d.handSide === 'left' ? 'rgba(90,170,255,.55)' : 'rgba(255,160,80,.55)';
        ctx.strokeRect(x + 0.5, y + 0.5, 8 * s - 1, 8 * s - 1);
        ctx.fillStyle = 'rgba(255,255,255,.45)';
        ctx.fillText(String(d.index + 1), x + 2, y + 8);
      }
    }
  }

  LP.Minimap = Minimap;
})(window.LP = window.LP || {});

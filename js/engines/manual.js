// Manual モード: マウス/タッチ/実機でパッドを自由に操作する
// toggle    : 押すたびにON/OFF(パターンを描く)
// momentary : 押している間だけ光る(演奏向け)
(function (LP) {
  'use strict';

  class ManualEngine {
    constructor() {
      this.colorHex = '#18ff3c';
      this.brightness = 1;
      this.behavior = 'toggle';
      this.held = new Map(); // cell.index -> 押している本数
    }

    get color() { return LP.Color.scale(LP.Color.fromHex(this.colorHex), this.brightness); }

    reset() { this.held.clear(); }

    hold(cell) { this.held.set(cell.index, (this.held.get(cell.index) || 0) + 1); }

    release(cell) {
      const n = (this.held.get(cell.index) || 0) - 1;
      if (n > 0) this.held.set(cell.index, n); else this.held.delete(cell.index);
    }

    paint(grid) {
      const col = this.color;
      for (const c of grid.cells) {
        if (c.void) continue;
        if (this.held.has(c.index)) { c.state = 'on'; c.color = col; c.level = 1; }
        else if (c.alive) { c.state = 'on'; c.color = c.paintColor || col; c.level = 1; }
        else { c.state = 'off'; c.color = null; c.level = 0; }
      }
    }
  }

  LP.ManualEngine = ManualEngine;
})(window.LP = window.LP || {});

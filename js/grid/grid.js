// 巨大な仮想グリッド
// 全 Launchpad を 16 × (段数×8) の一枚のグリッドとして扱う。
// Launchpad の境界は物理的な機材の境界であって、グリッド上の境界ではない。
// 台が無い場所(3台・5台の右下など)は void セルになり、何も生きられない。
(function (LP) {
  'use strict';

  class GlobalGrid {
    constructor(width, height) {
      this.width = width;
      this.height = height;
      this.cells = [];
      for (let y = 0; y < height; y++) {
        for (let x = 0; x < width; x++) {
          this.cells.push({
            index: y * width + x,
            globalX: x,
            globalY: y,
            deviceId: null,
            device: null,
            localX: -1,
            localY: -1,
            void: true,
            alive: false,   // パターン(Manual と Game of Life で共有)
            age: 0,         // 生存世代数(0 = 生まれたて)
            paintColor: null,
            state: 'off',   // 表示状態: off/on/born/alive/dying/ghost/note/hit
            color: null,    // 表示用の抽象色 {r,g,b}
            level: 0,       // 表示の明るさ係数
          });
        }
      }
      this.byDevice = new Map();
      this.colTop = new Array(width).fill(-1);
      this.colBottom = new Array(width).fill(-1);
    }

    // リグの論理スロットからグリッドを組み立てる。prev があれば同じ座標のパターンを引き継ぐ。
    static fromRig(rig, prev) {
      const g = new GlobalGrid(rig.gridWidth, rig.gridHeight);
      for (const d of rig.devices) {
        const arr = new Array(64);
        for (let ly = 0; ly < 8; ly++) {
          for (let lx = 0; lx < 8; lx++) {
            const c = g.get(d.slot.col * 8 + lx, d.slot.row * 8 + ly);
            c.void = false;
            c.deviceId = d.id;
            c.device = d;
            c.localX = lx;
            c.localY = ly;
            arr[ly * 8 + lx] = c;
          }
        }
        g.byDevice.set(d.id, arr);
      }
      for (let x = 0; x < g.width; x++) {
        for (let y = 0; y < g.height; y++) {
          if (g.get(x, y).void) continue;
          if (g.colTop[x] < 0) g.colTop[x] = y;
          g.colBottom[x] = y;
        }
      }
      if (prev) {
        for (const c of g.cells) {
          if (c.void) continue;
          const p = prev.get(c.globalX, c.globalY);
          if (p && !p.void) { c.alive = p.alive; c.age = p.age; c.paintColor = p.paintColor; }
        }
      }
      return g;
    }

    get(x, y) {
      if (x < 0 || y < 0 || x >= this.width || y >= this.height) return null;
      return this.cells[y * this.width + x];
    }

    cellOf(device, lx, ly) {
      const arr = this.byDevice.get(device.id);
      return arr ? arr[ly * 8 + lx] : null;
    }

    capture() {
      return this.cells.map((c) => (c.alive ? { p: c.paintColor } : null));
    }

    restore(snap) {
      if (!snap || snap.length !== this.cells.length) return false;
      this.cells.forEach((c, i) => {
        c.alive = !!snap[i] && !c.void;
        c.paintColor = snap[i] ? snap[i].p : null;
        c.age = 1;
      });
      return true;
    }

    clearPattern() {
      for (const c of this.cells) { c.alive = false; c.age = 0; }
    }

    randomize(density, colorFn) {
      for (const c of this.cells) {
        if (c.void) continue;
        c.alive = Math.random() < density;
        c.age = 1;
        c.paintColor = c.alive && colorFn ? colorFn(c) : null;
      }
    }

    population() {
      let n = 0;
      for (const c of this.cells) if (c.alive) n++;
      return n;
    }
  }

  LP.GlobalGrid = GlobalGrid;
})(window.LP = window.LP || {});

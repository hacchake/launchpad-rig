// Falling Notes エンジン
// ノートは巨大グリッドの上端から下端へ流れ、Launchpad の境界を越えて移動する。
// 列の一番下のセルに着いたら hit イベント(将来 MIDI Note に変換)。
(function (LP) {
  'use strict';

  let nextId = 1;

  class FallingNotesEngine {
    constructor() {
      this.notes = [];
      this.rate = 0.35;          // 出現率 0..1
      this.motion = 'straight';  // straight / diagonal / mix
      this.hits = 0;
    }

    setGrid(grid) {
      this.grid = grid;
      this.notes = this.notes.filter((n) => n.x < grid.width && n.y < grid.height);
    }

    _dx() {
      const r = Math.random();
      if (this.motion === 'straight') return 0;
      if (this.motion === 'diagonal') return r < 0.5 ? -1 : 1;
      return r < 0.5 ? 0 : r < 0.75 ? -1 : 1;
    }

    spawnAt(x, y) {
      if (this.grid.colBottom[x] < 0) return;
      this.notes.push({ id: nextId++, x, y, dx: this._dx(), done: false });
    }

    removeColumn(x) { this.notes = this.notes.filter((n) => n.x !== x); }

    burst(count = 8) {
      const g = this.grid;
      for (let k = 0; k < count; k++) {
        const x = Math.floor(Math.random() * g.width);
        if (g.colTop[x] >= 0) this.spawnAt(x, g.colTop[x]);
      }
    }

    clear() { this.notes = []; }

    // 1ティック分進める。下端に着いたノート(hit)の配列を返す。
    step() {
      const g = this.grid;
      this.notes = this.notes.filter((n) => !n.done);
      const hits = [];
      for (const n of this.notes) {
        n.y += 1;
        if (n.dx) {
          let nx = n.x + n.dx;
          if (nx < 0 || nx >= g.width) { n.dx = -n.dx; nx = n.x + n.dx; } // 左右の端で反射
          n.x = nx;
        }
        const bottom = g.colBottom[n.x];
        if (bottom < 0) { n.done = true; continue; }
        if (n.y >= bottom) {
          n.y = bottom;
          n.done = true;
          this.hits++;
          hits.push({ note: n, cell: g.get(n.x, n.y) });
        }
      }
      // 新しいノートを各列の上端に出す
      const p = this.rate * 0.12;
      for (let x = 0; x < g.width; x++) {
        const top = g.colTop[x];
        if (top < 0 || Math.random() >= p) continue;
        if (this.notes.some((n) => n.x === x && n.y <= top + 1)) continue;
        this.spawnAt(x, top);
      }
      return hits;
    }

    paint(scheme) {
      const g = this.grid;
      for (const c of g.cells) { c.state = 'off'; c.color = null; c.level = 0; }
      for (const n of this.notes) {
        const c = g.get(n.x, n.y);
        if (!c || c.void) continue; // 台の無い場所は見えないまま通過
        if (n.done) { c.state = 'hit'; c.color = scheme.hit; }
        else { c.state = 'note'; c.color = c.globalX < g.width / 2 ? scheme.noteLeft : scheme.noteRight; }
        c.level = 1;
      }
    }
  }

  LP.FallingNotesEngine = FallingNotesEngine;
})(window.LP = window.LP || {});

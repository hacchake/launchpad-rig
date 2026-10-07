// Cellular Automata エンジン(Life系ルール B/S 表記)
// 巨大グリッド全体で近傍を数えるので、セルは Launchpad の境界をそのまま越える。
(function (LP) {
  'use strict';

  const LIFE_RULES = [
    { rule: 'B3/S23', name: "Conway's Life (B3/S23)" },
    { rule: 'B36/S23', name: 'HighLife (B36/S23)' },
    { rule: 'B3678/S34678', name: 'Day & Night' },
    { rule: 'B368/S245', name: 'Morley (B368/S245)' },
    { rule: 'B36/S125', name: '2x2 (B36/S125)' },
    { rule: 'B3/S12345', name: 'Maze (B3/S12345)' },
    { rule: 'B2/S', name: 'Seeds (B2/S)' },
  ];

  function parseRule(str) {
    const m = /B(\d*)\/S(\d*)/i.exec(str || '');
    const born = new Array(9).fill(false);
    const survive = new Array(9).fill(false);
    if (m) {
      for (const ch of m[1]) born[+ch] = true;
      for (const ch of m[2]) survive[+ch] = true;
    }
    return { str, born, survive };
  }

  class LifeEngine {
    constructor() {
      this.rule = parseRule('B3/S23');
      this.wrap = true;       // 端をつなぐ(トーラス)
      this.generation = 0;
      this.ghostGens = 3;     // 死後に残光として残る世代数
    }

    setRule(str) { this.rule = parseRule(str); }

    setGrid(grid) {
      this.grid = grid;
      const n = grid.cells.length;
      this.deadAge = new Uint8Array(n).fill(255); // 死んでからの世代数(255 = ずっと前)
      this.next = new Uint8Array(n);
    }

    resetHistory() {
      this.deadAge.fill(255);
      this.generation = 0;
    }

    forget(cell) { this.deadAge[cell.index] = 255; }

    step() {
      const { width: w, height: h, cells } = this.grid;
      const next = this.next;
      const { born, survive } = this.rule;
      const wrap = this.wrap;

      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const i = y * w + x;
          const c = cells[i];
          if (c.void) { next[i] = 0; continue; }
          let n = 0;
          for (let dy = -1; dy <= 1; dy++) {
            let yy = y + dy;
            if (yy < 0 || yy >= h) { if (!wrap) continue; yy = (yy + h) % h; }
            for (let dx = -1; dx <= 1; dx++) {
              if (!dx && !dy) continue;
              let xx = x + dx;
              if (xx < 0 || xx >= w) { if (!wrap) continue; xx = (xx + w) % w; }
              if (cells[yy * w + xx].alive) n++;
            }
          }
          next[i] = c.alive ? (survive[n] ? 1 : 0) : (born[n] ? 1 : 0);
        }
      }

      const res = { born: [], died: [] };
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        if (c.void) continue;
        const now = next[i] === 1;
        if (now) {
          if (!c.alive) { c.age = 0; res.born.push(c); } else c.age = Math.min(c.age + 1, 1e6);
          this.deadAge[i] = 255;
        } else {
          if (c.alive) { this.deadAge[i] = 0; res.died.push(c); } else if (this.deadAge[i] < 255) this.deadAge[i]++;
        }
        c.alive = now;
      }
      this.generation++;
      return res;
    }

    // 生まれた/生存中/死んだ/最近死んだ を色に落とす(色は scheme で自由に変更可能)
    paint(scheme) {
      const cells = this.grid.cells;
      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        if (c.void) continue;
        if (c.alive) {
          const fresh = c.age === 0;
          c.state = fresh ? 'born' : 'alive';
          c.color = fresh ? scheme.born : scheme.alive;
          c.level = 1;
        } else {
          const a = this.deadAge[i];
          if (a === 0) { c.state = 'dying'; c.color = scheme.dying; c.level = 1; }
          else if (a <= this.ghostGens) { c.state = 'ghost'; c.color = scheme.ghost; c.level = 1 - (a - 1) / this.ghostGens; }
          else { c.state = 'off'; c.color = null; c.level = 0; }
        }
      }
    }
  }

  LP.LIFE_RULES = LIFE_RULES;
  LP.LifeEngine = LifeEngine;
})(window.LP = window.LP || {});

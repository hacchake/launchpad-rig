// Animation Engine
// セルの表示状態(state/color/level)を目標値として、毎フレーム
//   fade      : 点灯へのなめらかな立ち上がり
//   afterglow : 消灯時のゆっくりした残光
//   pulse     : 拍に合わせた脈動(Clock の位相に同期)
//   flash     : 生まれた瞬間・押した瞬間にパッと白く光る
// を合成し、各 LaunchpadDevice.setPad() へ抽象色で渡す。機種の色制約は device 側で処理。
(function (LP) {
  'use strict';

  const PULSING = { alive: true, on: true, note: true };

  class AnimationEngine {
    constructor(clock) {
      this.clock = clock;
      this.fx = { glow: true, fade: true, pulse: true, flash: true, afterglow: true };
      this.brightness = 1;
      this.last = 0;
      this.tmp = { r: 0, g: 0, b: 0 };
    }

    setGrid(grid) {
      this.grid = grid;
      const n = grid.cells.length;
      this.cur = new Float32Array(n * 3);
      this.flashT = new Float64Array(n).fill(-1e9);
      this.flashS = new Float32Array(n);
      this.devices = [...new Set(grid.cells.filter((c) => !c.void).map((c) => c.device))];
    }

    flash(cell, strength = 1) {
      if (!cell || cell.void) return;
      this.flashT[cell.index] = performance.now();
      this.flashS[cell.index] = strength;
    }

    frame(now) {
      const g = this.grid;
      if (!g) return;
      const dt = this.last ? Math.min(100, now - this.last) : 16;
      this.last = now;

      const fx = this.fx;
      const kRise = fx.fade ? 1 - Math.exp(-dt / 40) : 1;
      const kFall = fx.afterglow ? 1 - Math.exp(-dt / 300) : fx.fade ? 1 - Math.exp(-dt / 60) : 1;
      const ph = this.clock.beatPhase(now);
      const pulse = 0.8 + 0.2 * Math.pow(1 - ph, 2);
      const cells = g.cells, cur = this.cur, tmp = this.tmp, B = this.brightness;

      for (let i = 0; i < cells.length; i++) {
        const c = cells[i];
        if (c.void) continue;
        let tr = 0, tg = 0, tb = 0;
        if (c.color) {
          let k = B * c.level;
          if (fx.pulse && PULSING[c.state]) k *= pulse;
          tr = c.color.r * k; tg = c.color.g * k; tb = c.color.b * k;
        }
        const j = i * 3;
        cur[j] += (tr - cur[j]) * (tr > cur[j] ? kRise : kFall);
        cur[j + 1] += (tg - cur[j + 1]) * (tg > cur[j + 1] ? kRise : kFall);
        cur[j + 2] += (tb - cur[j + 2]) * (tb > cur[j + 2] ? kRise : kFall);
        let r = cur[j], gg = cur[j + 1], b = cur[j + 2];
        if (fx.flash) {
          const age = now - this.flashT[i];
          if (age < 500) {
            const f = this.flashS[i] * Math.exp(-age / 110);
            r += (1 - r) * f; gg += (1 - gg) * f; b += (1 - b) * f;
          }
        }
        tmp.r = r; tmp.g = gg; tmp.b = b;
        c.device.setPad(c.localX, c.localY, tmp);
      }
      for (const d of this.devices) d.flush();
    }
  }

  LP.AnimationEngine = AnimationEngine;
})(window.LP = window.LP || {});

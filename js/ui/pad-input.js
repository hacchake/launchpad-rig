// マウス・タッチ入力 → LaunchpadDevice.press()/release()
// Pointer Events でポインタごとに追跡するので、タッチ画面なら両手・複数指で同時に操作できる。
// ドラッグで台をまたいでも、指の下のパッドを都度判定する。
(function (LP) {
  'use strict';

  class PadInput {
    constructor(stage, rig) {
      this.rig = rig;
      this.active = new Map();
      stage.addEventListener('pointerdown', (e) => this.down(e));
      window.addEventListener('pointermove', (e) => this.move(e));
      window.addEventListener('pointerup', (e) => this.up(e));
      window.addEventListener('pointercancel', (e) => this.up(e));
      stage.addEventListener('contextmenu', (e) => e.preventDefault());
    }

    hit(x, y) {
      const el = document.elementFromPoint(x, y);
      const pad = el && el.closest ? el.closest('.pad') : null;
      if (!pad) return null;
      const device = this.rig.byId(pad.dataset.dev);
      if (!device) return null;
      return { device, lx: +pad.dataset.x, ly: +pad.dataset.y, key: pad.dataset.dev + ':' + pad.dataset.x + ':' + pad.dataset.y };
    }

    down(e) {
      const h = this.hit(e.clientX, e.clientY);
      const erase = e.button === 2;
      if (!h) {
        // パッドのすき間から描き始めた場合は、最初に触れたパッドから描画を始める
        if (e.target.closest('.lp-matrix')) { e.preventDefault(); this.active.set(e.pointerId, { h: null, erase }); }
        return;
      }
      e.preventDefault();
      this.active.set(e.pointerId, { h, erase });
      h.device.press(h.lx, h.ly, { velocity: 100, erase, drag: false, pointerId: e.pointerId, source: e.pointerType });
    }

    move(e) {
      const a = this.active.get(e.pointerId);
      if (!a) return;
      const h = this.hit(e.clientX, e.clientY);
      if (!h || (a.h && h.key === a.h.key)) return;
      const first = !a.h;
      if (a.h) a.h.device.release(a.h.lx, a.h.ly, { pointerId: e.pointerId, source: e.pointerType });
      a.h = h;
      h.device.press(h.lx, h.ly, { velocity: 100, erase: a.erase, drag: !first, pointerId: e.pointerId, source: e.pointerType });
    }

    up(e) {
      const a = this.active.get(e.pointerId);
      if (!a) return;
      this.active.delete(e.pointerId);
      if (a.h) a.h.device.release(a.h.lx, a.h.ly, { pointerId: e.pointerId, source: e.pointerType, end: true });
    }
  }

  LP.PadInput = PadInput;
})(window.LP = window.LP || {});

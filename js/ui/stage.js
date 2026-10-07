// ステージ: Launchpad 群の物理配置を描く。
// 位置は mm で管理し、画面サイズに合わせて全体を拡大縮小する。
// 本体の縁(パッド以外)をドラッグで移動、Shift+ホイールで回転。
(function (LP) {
  'use strict';

  const LAYER_LABELS = [['上段', 'HIGH'], ['中段', 'MID'], ['下段', 'LOW']];
  const PAD = { left: 96, right: 24, top: 70, bottom: 22 }; // 画面px の余白(ラベル用)

  class StageView {
    constructor(wrap, stage, rig) {
      this.wrap = wrap;
      this.stage = stage;
      this.rig = rig;
      this.views = new Map();
      this.scale = 1;
      this.drag = null;
      this.deco = document.createElement('div');
      this.deco.className = 'stage-deco';
      stage.appendChild(this.deco);
      stage.style.setProperty('--u', LP.MM_PX + 'px');
      this._initDrag();
      new ResizeObserver(() => this.fit()).observe(wrap);
    }

    // リグの状態に合わせて表示を作り直す
    sync() {
      const live = new Set(this.rig.devices.map((d) => d.id));
      for (const [id, v] of this.views) {
        if (!live.has(id)) { v.device.removeSink(v); v.el.remove(); this.views.delete(id); }
      }
      for (const d of this.rig.devices) {
        let v = this.views.get(d.id);
        if (!v) {
          v = new LP.VirtualLaunchpadView(d, this.rig);
          this.views.set(d.id, v);
          this.stage.appendChild(v.el);
          d.addSink(v);
        } else if (v.size !== this.rig.sizeOf(d.model) || v.model !== d.model) {
          v.build();
        } else {
          v.updateMeta();
          v.updatePlacement();
        }
      }
      this.drawDeco();
      this.fit();
    }

    placement(d) { const v = this.views.get(d.id); if (v) v.updatePlacement(); }

    // 左手/右手・段のラベル、体の中心線、空きスロット
    drawDeco() {
      const MM = LP.MM_PX;
      const L = this.rig.layout();
      const html = [];
      const top = L.rows[0].y * MM;
      html.push(`<div class="center-line" style="left:${L.centerX * MM}px;top:${top}px;height:${L.height * MM}px"></div>`);
      const hands = [['LEFT HAND', '左手', 'left'], ['RIGHT HAND', '右手', 'right']];
      L.cols.forEach((c, i) => {
        html.push(`<div class="stage-label hand hand-${hands[i][2]}" style="left:${c.x * MM}px;top:${top}px;width:${c.w * MM}px">` +
          `${hands[i][1]} <small>${hands[i][0]}</small></div>`);
      });
      L.rows.forEach((r, i) => {
        const lab = LAYER_LABELS[i] || ['', ''];
        html.push(`<div class="stage-label layer" style="left:${L.cols[0].x * MM}px;top:${(r.y + r.h / 2) * MM}px">` +
          `${lab[0]}<small>${lab[1]}</small></div>`);
      });
      for (const s of this.rig.emptySlots()) {
        const size = L.cols[s.col].w;
        const r = L.slotRect(s.col, s.row, size);
        html.push(`<div class="placeholder" style="left:${r.x * MM}px;top:${r.y * MM}px;width:${size * MM}px;height:${size * MM}px">` +
          `<span>空き<br>${s.col ? '右手' : '左手'} · ${(LAYER_LABELS[s.row] || [''])[0]}</span></div>`);
      }
      this.deco.innerHTML = html.join('');
      this._layout = L;
    }

    bounds() {
      const L = this._layout || this.rig.layout();
      let x0 = 0, y0 = 0, x1 = L.width, y1 = L.height;
      for (const d of this.rig.devices) {
        const s = this.rig.sizeOf(d.model);
        const a = (d.physical.rotation * Math.PI) / 180;
        const half = (s / 2) * (Math.abs(Math.cos(a)) + Math.abs(Math.sin(a)));
        const cx = d.physical.x + s / 2, cy = d.physical.y + s / 2;
        x0 = Math.min(x0, cx - half); x1 = Math.max(x1, cx + half);
        y0 = Math.min(y0, cy - half); y1 = Math.max(y1, cy + half);
      }
      return { x0, y0, x1, y1 };
    }

    fit() {
      if (this.drag) return;
      const W = this.wrap.clientWidth, H = this.wrap.clientHeight;
      if (!W || !H) return;
      const MM = LP.MM_PX;
      const b = this.bounds();
      const bw = (b.x1 - b.x0) * MM, bh = (b.y1 - b.y0) * MM;
      const aw = W - PAD.left - PAD.right, ah = H - PAD.top - PAD.bottom;
      const s = Math.max(0.05, Math.min(aw / bw, ah / bh, 1.4));
      const tx = PAD.left + (aw - bw * s) / 2 - b.x0 * MM * s;
      const ty = PAD.top + (ah - bh * s) / 2 - b.y0 * MM * s;
      this.scale = s;
      this.stage.style.transform = `translate(${tx.toFixed(1)}px, ${ty.toFixed(1)}px) scale(${s.toFixed(4)})`;
      this.stage.style.setProperty('--inv', (1 / s).toFixed(4));
      // 初回はアニメーションさせずに即座に合わせる
      if (!this._booted) {
        this._booted = true;
        this.stage.classList.add('dragging');
        requestAnimationFrame(() => requestAnimationFrame(() => this.stage.classList.remove('dragging')));
      }
    }

    _initDrag() {
      const stage = this.stage;
      stage.addEventListener('pointerdown', (e) => {
        // パッドの並び(すき間を含む)からは移動しない。描画ドラッグと区別するため、縁と名札だけで掴む。
        if (e.button !== 0 || e.target.closest('.lp-matrix')) return;
        const el = e.target.closest('.lp');
        if (!el) return;
        const d = this.rig.byId(el.dataset.dev);
        if (!d) return;
        e.preventDefault();
        stage.appendChild(el); // 掴んだ台を最前面へ
        this.drag = { d, el, id: e.pointerId, sx: e.clientX, sy: e.clientY, ox: d.physical.x, oy: d.physical.y, moved: false };
        el.classList.add('grabbing');
        stage.classList.add('dragging');
      });
      window.addEventListener('pointermove', (e) => {
        const g = this.drag;
        if (!g || e.pointerId !== g.id) return;
        const k = this.scale * LP.MM_PX;
        const dx = (e.clientX - g.sx) / k, dy = (e.clientY - g.sy) / k;
        if (Math.abs(dx) + Math.abs(dy) > 1) g.moved = true;
        g.d.physical.x = g.ox + dx;
        g.d.physical.y = g.oy + dy;
        this.placement(g.d);
      });
      const end = (e) => {
        const g = this.drag;
        if (!g || e.pointerId !== g.id) return;
        this.drag = null;
        g.el.classList.remove('grabbing');
        stage.classList.remove('dragging');
        if (g.moved) { g.d.physical.pinned = true; this.rig.bus.emit('physical', g.d); }
        this.fit();
      };
      window.addEventListener('pointerup', end);
      window.addEventListener('pointercancel', end);

      // Shift(または Alt)+ホイールで本体を回転
      stage.addEventListener('wheel', (e) => {
        if (!e.shiftKey && !e.altKey) return;
        const el = e.target.closest('.lp');
        if (!el) return;
        const d = this.rig.byId(el.dataset.dev);
        if (!d) return;
        e.preventDefault();
        const delta = (e.deltaY || e.deltaX) > 0 ? 5 : -5;
        let r = d.physical.rotation + delta;
        if (r > 180) r -= 360;
        if (r < -180) r += 360;
        d.physical.rotation = r;
        d.physical.pinned = true;
        this.placement(d);
        this.rig.bus.emit('physical', d);
        this.fit();
      }, { passive: false });
    }
  }

  LP.StageView = StageView;
})(window.LP = window.LP || {});

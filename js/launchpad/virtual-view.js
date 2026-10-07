// 仮想 Launchpad の画面表示(LaunchpadDevice の sink の一つ)
// 8×8 パッドに加え、実機の上段ボタン列・右側ボタン列も(飾りとして)描く。
(function (LP) {
  'use strict';

  const OFF_RUBBER = [0.215, 0.215, 0.23]; // 消灯時のパッド(ゴム)の色
  const LAYER_NAMES = ['上段', '中段', '下段'];
  const C = (v) => Math.round(Math.min(1, v) * 255);

  class VirtualLaunchpadView {
    constructor(device, rig) {
      this.device = device;
      this.rig = rig;
      this.el = document.createElement('div');
      this.build();
    }

    build() {
      const d = this.device;
      const MM = LP.MM_PX;
      const size = this.rig.sizeOf(d.model);
      this.size = size;
      this.model = d.model;

      const el = this.el;
      el.className = 'lp lp-' + d.model;
      el.dataset.dev = d.id;
      el.style.width = el.style.height = size * MM + 'px';
      el.innerHTML = '';

      this.tag = document.createElement('div');
      this.tag.className = 'lp-tag';
      el.appendChild(this.tag);

      const body = document.createElement('div');
      body.className = 'lp-body';
      el.appendChild(body);

      const margin = size * (d.model === 'S' ? 0.055 : 0.045);
      const pitch = (size - 2 * margin) / 9;
      const m = document.createElement('div');
      m.className = 'lp-matrix';
      m.style.inset = margin * MM + 'px';
      m.style.gap = pitch * 0.17 * MM + 'px';

      this.pads = new Array(64);
      this.logo = null;
      for (let row = 0; row < 9; row++) {
        for (let col = 0; col < 9; col++) {
          const b = document.createElement('div');
          if (row === 0 && col === 8) {
            b.className = d.model === 'X' ? 'logo' : 'corner';
            if (d.model === 'X') this.logo = b;
          } else if (row === 0 || col === 8) {
            b.className = 'fn';
          } else {
            b.className = 'pad';
            b.dataset.dev = d.id;
            b.dataset.x = col;
            b.dataset.y = row - 1;
            this.pads[(row - 1) * 8 + col] = b;
          }
          m.appendChild(b);
        }
      }
      body.appendChild(m);

      this.updateMeta();
      this.updatePlacement();
      d.invalidate();
    }

    updateMeta() {
      const d = this.device;
      const hand = d.handSide === 'left' ? 'L 左手' : 'R 右手';
      this.tag.innerHTML =
        `<b>${d.label}</b><span class="model"> / ${d.profile.name}</span>` +
        `<span class="meta hand-${d.handSide}">${hand}</span>` +
        `<span class="meta">${LAYER_NAMES[d.rowLayer] || ''}</span>`;
      if (this.logo) this.logo.style.setProperty('--logo', d.handSide === 'left' ? 'rgba(70,160,255,.55)' : 'rgba(255,150,60,.55)');
    }

    updatePlacement() {
      const p = this.device.physical;
      const MM = LP.MM_PX;
      this.el.style.left = p.x * MM + 'px';
      this.el.style.top = p.y * MM + 'px';
      this.el.style.transform = p.rotation ? `rotate(${p.rotation}deg)` : '';
    }

    // sink インターフェース
    setLed(lx, ly, q) {
      const pad = this.pads[ly * 8 + lx];
      if (!pad) return;
      const d = this.device.profile.display(q);
      if (!d) {
        if (pad._lit) {
          pad._lit = false;
          pad.classList.remove('lit');
          pad.style.background = '';
          pad.style.boxShadow = '';
        }
        return;
      }
      pad._lit = true;
      pad.classList.add('lit');
      const L = d.level;
      // LEDはゴム越しに光るので、消灯色に加算する
      const r = OFF_RUBBER[0] * (1 - 0.6 * L) + d.r;
      const g = OFF_RUBBER[1] * (1 - 0.6 * L) + d.g;
      const b = OFF_RUBBER[2] * (1 - 0.6 * L) + d.b;
      const hi = 0.5 * L;
      pad.style.background =
        `radial-gradient(circle at 50% 45%, rgb(${C(r + (1 - r) * hi)},${C(g + (1 - g) * hi)},${C(b + (1 - b) * hi)}) 0%, rgb(${C(r)},${C(g)},${C(b)}) 72%)`;
      // グローは色相を保ったまま、明るさで濃さと広がりを変える
      const MM = LP.MM_PX;
      const nr = d.r / L, ng = d.g / L, nb = d.b / L;
      pad.style.boxShadow =
        `0 0 ${((3 + 10 * L) * MM).toFixed(1)}px ${(0.8 * L * MM).toFixed(1)}px rgba(${C(nr)},${C(ng)},${C(nb)},${(0.18 + 0.55 * L).toFixed(2)})`;
    }

    onModelChange() { this.build(); }

    detach() { this.el.remove(); }
  }

  LP.VirtualLaunchpadView = VirtualLaunchpadView;
})(window.LP = window.LP || {});

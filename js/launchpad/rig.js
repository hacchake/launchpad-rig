// Launchpad 管理: 台数・機種・論理スロット・物理配置
//
//         左手(col 0)   右手(col 1)
//  上段 row0   LP1          LP2
//  中段 row1   LP3          LP4
//  下段 row2   LP5          LP6
//
// 論理スロット(slot)は巨大グリッド上の位置、物理配置(physical)は画面上の置き場所。
// ドラッグや回転で physical を変えても slot は変わらないので、
// Cellular Automata の連続性は論理側で保たれる。
(function (LP) {
  'use strict';
  const { clamp } = LP.util;

  const DEFAULT_MODELS = ['S', 'S', 'X', 'X', 'S', 'X'];
  const CENTER_GAP = 70; // 左手列と右手列のすき間(mm)
  const ROW_GAP = 46;    // 段と段のすき間(mm)
  const FLAT_SIZE = 220; // 実寸比率オフ時の共通サイズ(mm)

  class LaunchpadRig {
    constructor(saved) {
      saved = saved || {};
      this.bus = new LP.EventBus();
      this.devices = [];
      this.models = (saved.models || DEFAULT_MODELS).slice(0, 6);
      while (this.models.length < 6) this.models.push('S');
      this.realScale = saved.realScale !== false;
      this._saved = (saved.devices || []).slice();
      this.setCount(saved.count || 6);
    }

    get count() { return this.devices.length; }
    get rows() { return Math.ceil(this.devices.length / 2); }
    get gridWidth() { return 16; }
    get gridHeight() { return this.rows * 8; }

    byId(id) { return this.devices.find((d) => d.id === id) || null; }
    deviceAt(col, row) { return this.devices.find((d) => d.slot.col === col && d.slot.row === row) || null; }
    sizeOf(model) { return this.realScale ? LP.Profiles[model].bodyMm : FLAT_SIZE; }

    setCount(n) {
      n = clamp(n | 0, 2, 6);
      while (this.devices.length < n) {
        const i = this.devices.length;
        const d = new LP.LaunchpadDevice({ id: 'lp' + (i + 1), index: i, model: this.models[i] });
        const s = this._saved[i];
        if (s) {
          if (s.slot) d.slot = { col: s.slot.col, row: s.slot.row };
          if (s.physical) Object.assign(d.physical, s.physical);
        }
        d.bus.on('press', (e) => this.bus.emit('press', e));
        d.bus.on('release', (e) => this.bus.emit('release', e));
        this.devices.push(d);
      }
      while (this.devices.length > n) {
        const d = this.devices.pop();
        this._saved[d.index] = this._serializeDevice(d);
        d.dispose();
      }
      this.normalizeSlots();
      this.autoLayout(false);
    }

    // 範囲外・重複したスロットを空きスロットへ詰め直す
    normalizeSlots() {
      const rows = this.rows;
      const used = new Set();
      const bad = [];
      for (const d of this.devices) {
        const k = d.slot.col + ',' + d.slot.row;
        if (d.slot.row >= rows || d.slot.row < 0 || d.slot.col < 0 || d.slot.col > 1 || used.has(k)) bad.push(d);
        else used.add(k);
      }
      for (const d of bad) {
        outer: for (let r = 0; r < rows; r++) {
          for (let c = 0; c < 2; c++) {
            if (!used.has(c + ',' + r)) { d.slot = { col: c, row: r }; used.add(c + ',' + r); break outer; }
          }
        }
      }
    }

    emptySlots() {
      const out = [];
      for (let r = 0; r < this.rows; r++) for (let c = 0; c < 2; c++) if (!this.deviceAt(c, r)) out.push({ col: c, row: r });
      return out;
    }

    // 論理スロットから導いた「標準の物理配置」。左列は中心側(右)に、右列は中心側(左)に寄せる。
    layout() {
      const rows = this.rows;
      const colW = [0, 0];
      const rowH = new Array(rows).fill(0);
      for (const d of this.devices) {
        const s = this.sizeOf(d.model);
        colW[d.slot.col] = Math.max(colW[d.slot.col], s);
        rowH[d.slot.row] = Math.max(rowH[d.slot.row], s);
      }
      if (!colW[0]) colW[0] = colW[1] || this.sizeOf('S');
      if (!colW[1]) colW[1] = colW[0];
      for (let r = 0; r < rows; r++) if (!rowH[r]) rowH[r] = Math.max(colW[0], colW[1]);
      const cols = [{ x: 0, w: colW[0] }, { x: colW[0] + CENTER_GAP, w: colW[1] }];
      const rowsOut = [];
      let y = 0;
      for (let r = 0; r < rows; r++) { rowsOut.push({ y, h: rowH[r] }); y += rowH[r] + ROW_GAP; }
      const width = cols[1].x + cols[1].w;
      const height = y - ROW_GAP;
      const slotRect = (col, row, size) => ({
        x: col === 0 ? cols[0].x + cols[0].w - size : cols[1].x,
        y: rowsOut[row].y + (rowsOut[row].h - size) / 2,
        size,
      });
      return { cols, rows: rowsOut, width, height, centerX: colW[0] + CENTER_GAP / 2, slotRect };
    }

    // ドラッグで固定(pinned)されていない台を標準位置へ。force なら全台を整列し回転も戻す。
    autoLayout(force) {
      const L = this.layout();
      for (const d of this.devices) {
        if (!force && d.physical.pinned) continue;
        const r = L.slotRect(d.slot.col, d.slot.row, this.sizeOf(d.model));
        d.physical.x = r.x;
        d.physical.y = r.y;
        if (force) { d.physical.rotation = 0; d.physical.pinned = false; }
      }
    }

    setModel(d, model) {
      d.setModel(model);
      this.models[d.index] = model;
      this.autoLayout(false);
    }

    // 論理スロットの変更。既に誰かがいれば入れ替える。
    setSlot(d, slot) {
      const other = this.deviceAt(slot.col, slot.row);
      if (other === d) return;
      if (other) other.slot = { col: d.slot.col, row: d.slot.row };
      d.slot = { col: slot.col, row: slot.row };
      this.autoLayout(false);
    }

    swapLogicalLR() {
      for (const d of this.devices) d.slot = { col: 1 - d.slot.col, row: d.slot.row };
      this.autoLayout(false);
    }

    swapLogicalTB() {
      const rows = this.rows;
      for (const d of this.devices) d.slot = { col: d.slot.col, row: rows - 1 - d.slot.row };
      this.autoLayout(false);
    }

    // 物理配置だけを鏡写しにする(論理グリッドはそのまま)
    swapPhysicalLR() {
      const L = this.layout();
      for (const d of this.devices) {
        d.physical.x = L.width - d.physical.x - this.sizeOf(d.model);
        d.physical.pinned = true;
      }
    }

    swapPhysicalTB() {
      const L = this.layout();
      for (const d of this.devices) {
        d.physical.y = L.height - d.physical.y - this.sizeOf(d.model);
        d.physical.pinned = true;
      }
    }

    _serializeDevice(d) {
      return { slot: { ...d.slot }, physical: { ...d.physical } };
    }

    serialize() {
      const devices = [];
      for (let i = 0; i < 6; i++) {
        const d = this.devices[i];
        devices.push(d ? this._serializeDevice(d) : this._saved[i] || null);
      }
      return { count: this.count, models: this.models.slice(), realScale: this.realScale, devices };
    }
  }

  LP.LaunchpadRig = LaunchpadRig;
})(window.LP = window.LP || {});

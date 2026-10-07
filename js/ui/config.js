// LP Configuration ダイアログ
// 機種・論理スロット・回転・実機MIDIポートを台ごとに設定する。
(function (LP) {
  'use strict';

  const LAYERS = ['上段', '中段', '下段'];
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  class ConfigPanel {
    constructor(dialog, app) {
      this.dialog = dialog;
      this.app = app;
      dialog.addEventListener('change', (e) => this.onChange(e));
      dialog.addEventListener('input', (e) => this.onInput(e));
      dialog.addEventListener('click', (e) => this.onClick(e));
      dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); }); // 背景クリックで閉じる
      app.midi.bus.on('ports', () => { if (dialog.open) this.render(); });
    }

    open() {
      this.render();
      this.dialog.showModal();
    }

    get isOpen() { return this.dialog.open; }

    render() {
      const { rig, midi, mapper } = this.app;
      const outs = midi.outputs(), ins = midi.inputs();
      const slots = [];
      for (let r = 0; r < rig.rows; r++) for (let c = 0; c < 2; c++) slots.push({ v: c + ',' + r, label: `${LAYERS[r]} · ${c ? '右手' : '左手'}` });
      const portOpts = (list, sel) => ['<option value="">仮想のみ</option>']
        .concat(list.map((p) => `<option value="${esc(p.id)}"${p.id === sel ? ' selected' : ''}>${esc(p.name)}</option>`)).join('');

      const rows = rig.devices.map((d) => `
        <tr data-id="${d.id}">
          <td><b>${d.label}</b></td>
          <td><select data-k="model">
            <option value="S"${d.model === 'S' ? ' selected' : ''}>Launchpad S</option>
            <option value="X"${d.model === 'X' ? ' selected' : ''}>Launchpad X</option>
          </select></td>
          <td><select data-k="slot">${slots.map((s) => `<option value="${s.v}"${s.v === d.slot.col + ',' + d.slot.row ? ' selected' : ''}>${s.label}</option>`).join('')}</select></td>
          <td><span class="hand-${d.handSide}">${d.handSide}</span></td>
          <td>${d.rowLayer}</td>
          <td class="mono">${LP.util.noteName(mapper.baseFor(d))} / ch${mapper.channelFor(d) + 1}</td>
          <td class="rot"><input type="range" data-k="rot" min="-180" max="180" step="5" value="${d.physical.rotation}"><span>${d.physical.rotation}°</span></td>
          <td><select data-k="out"${midi.enabled ? '' : ' disabled'}>${portOpts(outs, d.midi.outId)}</select></td>
          <td><select data-k="in"${midi.enabled ? '' : ' disabled'}>${portOpts(ins, d.midi.inId)}</select></td>
        </tr>`).join('');

      let midiState;
      if (!midi.supported) midiState = 'このブラウザは Web MIDI API 非対応です(Chrome / Edge で使えます)';
      else if (!midi.enabled) midiState = '未使用。実機をつなぐ時だけ有効化してください';
      else midiState = `有効: 出力 ${outs.length} / 入力 ${ins.length}`;

      this.dialog.innerHTML = `
        <div class="cfg">
          <header>
            <h2>LP Configuration</h2>
            <button class="x" data-act="close" title="閉じる">×</button>
          </header>
          <div class="cfg-scroll">
            <table>
              <thead><tr>
                <th>LP</th><th>機種</th><th>論理スロット</th><th>handSide</th><th>rowLayer</th>
                <th>開始音 / ch</th><th>回転(物理)</th><th>実機 出力</th><th>実機 入力</th>
              </tr></thead>
              <tbody>${rows}</tbody>
            </table>
          </div>
          <p class="note">論理スロット = 巨大グリッド上の位置(セルのつながりはこちらで決まる)。
            画面上の位置は本体の縁をドラッグ、回転は Shift+ホイールでも変えられます。物理配置を変えても論理グリッドは変わりません。</p>
          <div class="cfg-actions">
            <span class="lbl">物理配置</span>
            <button class="btn" data-act="align">論理どおりに整列</button>
            <button class="btn" data-act="physLR">左右を入れ替え</button>
            <button class="btn" data-act="physTB">上下を入れ替え</button>
          </div>
          <div class="cfg-actions">
            <span class="lbl">論理グリッド</span>
            <button class="btn" data-act="logLR">左右を入れ替え</button>
            <button class="btn" data-act="logTB">上下を入れ替え</button>
          </div>
          <label class="chk"><input type="checkbox" data-k="real"${rig.realScale ? ' checked' : ''}>
            実寸比率で表示(Launchpad S ≈ 24.5cm角 / Launchpad X ≈ 18cm角 の概算)</label>
          <section class="cfg-midi">
            <h3>MIDI(任意)</h3>
            <p class="note">${esc(midiState)}</p>
            <div class="cfg-actions">
              <button class="btn" data-act="midi"${midi.supported && !midi.enabled ? '' : ' disabled'}>Web MIDI を有効化</button>
              <label>音源へのノート出力 <select data-k="noteOut"${midi.enabled ? '' : ' disabled'}>
                <option value="">なし</option>${outs.map((p) => `<option value="${esc(p.id)}"${p.id === this.app.noteOutPort ? ' selected' : ''}>${esc(p.name)}</option>`).join('')}
              </select></label>
              <label>左手 ch <input type="number" data-k="chL" min="1" max="16" value="${mapper.channels.left + 1}"></label>
              <label>右手 ch <input type="number" data-k="chR" min="1" max="16" value="${mapper.channels.right + 1}"></label>
            </div>
            <p class="note">実機出力を選ぶと、その台のLEDを画面と同時に光らせます(S は X-Y レイアウト / X は Programmer モード)。
              実機の入力を選ぶと、実機のパッドが画面のパッドと同じように働きます。※実機での動作は未検証。</p>
          </section>
        </div>`;
    }

    _device(e) {
      const tr = e.target.closest('tr[data-id]');
      return tr ? this.app.rig.byId(tr.dataset.id) : null;
    }

    onInput(e) {
      if (e.target.dataset.k !== 'rot') return;
      const d = this._device(e);
      if (!d) return;
      d.physical.rotation = +e.target.value;
      d.physical.pinned = true;
      e.target.nextElementSibling.textContent = d.physical.rotation + '°';
      this.app.stageView.placement(d);
    }

    onChange(e) {
      const k = e.target.dataset.k;
      if (!k) return;
      const app = this.app, rig = app.rig;
      const d = this._device(e);
      const v = e.target.value;
      switch (k) {
        case 'model': rig.setModel(d, v); app.onRigChanged(); break;
        case 'slot': { const [c, r] = v.split(',').map(Number); rig.setSlot(d, { col: c, row: r }); app.onRigChanged(); break; }
        case 'rot': app.stageView.fit(); app.persist(); break;
        case 'out': d.midi.outId = v; app.attachPhysical(d); break;
        case 'in': d.midi.inId = v; app.attachPhysical(d); break;
        case 'real': rig.realScale = e.target.checked; rig.autoLayout(false); app.onRigChanged(); break;
        case 'noteOut': app.noteOutPort = v; break;
        case 'chL': app.mapper.channels.left = Math.max(0, Math.min(15, (+v || 1) - 1)); app.persist(); this.render(); break;
        case 'chR': app.mapper.channels.right = Math.max(0, Math.min(15, (+v || 1) - 1)); app.persist(); this.render(); break;
      }
    }

    onClick(e) {
      const act = e.target.dataset && e.target.dataset.act;
      if (!act) return;
      const app = this.app, rig = app.rig;
      switch (act) {
        case 'close': this.dialog.close(); return;
        case 'align': rig.autoLayout(true); break;
        case 'physLR': rig.swapPhysicalLR(); break;
        case 'physTB': rig.swapPhysicalTB(); break;
        case 'logLR': rig.swapLogicalLR(); break;
        case 'logTB': rig.swapLogicalTB(); break;
        case 'midi':
          app.midi.enable().then(() => { app.updateMidiStatus(); this.render(); })
            .catch((err) => alert('MIDI を有効化できませんでした: ' + err.message));
          return;
      }
      app.onRigChanged();
    }
  }

  LP.ConfigPanel = ConfigPanel;
})(window.LP = window.LP || {});

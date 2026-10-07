// アプリ本体: 各モジュールをつなぎ、上部バー・下部ドックの操作を受け持つ。
//
//   入力(マウス/タッチ/実機)→ LaunchpadDevice.press → App.onPress → 各モード(Engine)
//   Clock.tick → Life / Falling の1ステップ → grid セルの state/color
//   requestAnimationFrame → AnimationEngine → LaunchpadDevice.setPad → 画面/実機
(function (LP) {
  'use strict';

  const $ = (s) => document.querySelector(s);
  const STORE_KEY = 'multi-launchpad-rig/v1';
  const DEFAULT_SCHEME = {
    born: '#ffffff', alive: '#18ff3c', dying: '#ff1e14', ghost: '#5a0804',
    noteLeft: '#00b4ff', noteRight: '#ff7a00', hit: '#ffffff',
  };
  const HINTS = {
    manual: 'クリックで点灯 / もう一度クリック・右クリックで消灯 / ドラッグで台をまたいで描画',
    life: 'パッドで生きたセルを描く → START。セルは Launchpad の境界を越えて動きます',
    falling: 'START でノートが上から流れます。パッドをクリックするとそこからノートを落とせます',
  };

  class App {
    constructor() {
      const saved = LP.Store.load(STORE_KEY, {}) || {};
      this.mode = saved.mode || 'life';
      this.scheme = Object.assign({}, DEFAULT_SCHEME, saved.scheme);
      this.density = saved.density ?? 0.28;
      this.noteOutPort = '';
      this.activity = 0;
      this.strokes = new Map();
      this.snapshot = null;

      this.rig = new LP.LaunchpadRig(saved.rig);
      this.clock = new LP.Clock({ bpm: saved.bpm || 120, ticksPerBeat: saved.tpb || 4 });
      this.life = new LP.LifeEngine();
      this.life.wrap = saved.wrap ?? true;
      if (saved.rule) this.life.setRule(saved.rule);
      this.falling = new LP.FallingNotesEngine();
      this.falling.rate = saved.fallRate ?? 0.35;
      this.falling.motion = saved.motion || 'straight';
      this.manual = new LP.ManualEngine();
      this.manual.colorHex = saved.paint || '#18ff3c';
      this.manual.brightness = saved.paintBright ?? 1;
      this.manual.behavior = saved.behavior || 'toggle';
      this.anim = new LP.AnimationEngine(this.clock);
      Object.assign(this.anim.fx, saved.fx || {});
      this.anim.brightness = saved.brightness ?? 1;
      this.mapper = new LP.NoteMapper();
      if (saved.scale && LP.SCALES[saved.scale]) this.mapper.scale = saved.scale;
      if (saved.channels) Object.assign(this.mapper.channels, saved.channels);
      const audio = saved.audio || {};
      this.synth = new LP.Synth();
      this.synth.enabled = audio.on ?? true;
      this.synth.volume = audio.volume ?? 0.7;
      this.synth.reverb = audio.reverb ?? 0.35;
      if (audio.padType && LP.PAD_TYPES.some((p) => p.id === audio.padType)) this.synth.padType = audio.padType;
      this.synth.bpm = this.clock.bpm;
      this.harmony = new LP.Harmony();
      this.harmony.setModeFromScale(this.mapper.scale);
      this.sonifier = new LP.Sonifier(this);
      if (audio.voices) Object.assign(this.sonifier.voices, audio.voices);
      if (audio.rules) Object.assign(this.sonifier.rules, audio.rules);
      this.midi = new LP.WebMidiAdapter();

      this.stageView = new LP.StageView($('#stageWrap'), $('#stage'), this.rig);
      this.input = new LP.PadInput($('#stage'), this.rig);
      this.minimap = new LP.Minimap($('#minimap'));
      this.config = new LP.ConfigPanel($('#configDialog'), this);

      this.rig.bus.on('press', (e) => this.onPress(e));
      this.rig.bus.on('release', (e) => this.onRelease(e));
      this.rig.bus.on('physical', () => this.persist());
      this.clock.bus.on('tick', () => this.onTick());
      this.clock.bus.on('beat', (e) => this.harmony.onBeat(e.beat));
      this.clock.bus.on('tempo', () => this.synth.setTempo(this.clock.bpm));
      this.clock.bus.on('start', () => { this.harmony.reset(); this.updateTransport(); this.updatePad(); });
      this.clock.bus.on('stop', () => { this.updateTransport(); this.updatePad(); });
      this.harmony.bus.on('change', () => { if (this.synth.pad) this.synth.setPadChord(this.harmony.padNotes()); });
      // 最初のユーザー操作で音を出せる状態にする(ブラウザの自動再生制限)
      const unlock = () => { if (this.synth.enabled) { this.synth.ensure(); this.updatePad(); } };
      window.addEventListener('pointerdown', unlock, true);
      window.addEventListener('keydown', unlock, true);

      this.updateSchemeColors();
      this.bindUI();
      this.rebuild();
      // 起動直後に真っ暗にならないよう、最初は Life のランダム配置を置いておく
      if (!saved.mode || saved.mode === 'life') this.random();
      this.setMode(this.mode);
      requestAnimationFrame((t) => this.frame(t));
    }

    // ---------- 構成 ----------

    rebuild() {
      const prev = this.grid;
      this.grid = LP.GlobalGrid.fromRig(this.rig, prev);
      this.life.setGrid(this.grid);
      this.falling.setGrid(this.grid);
      this.anim.setGrid(this.grid);
      this.manual.reset();
      if (this.snapshot && this.snapshot.length !== this.grid.cells.length) this.snapshot = null;
      this.stageView.sync();
      $('#deviceCount').value = String(this.rig.count);
      this.repaint();
      this.persist();
    }

    onRigChanged() {
      this.rebuild();
      if (this.config.isOpen) this.config.render();
    }

    attachPhysical(d) {
      if (d._phys) { d._phys.detach(d); d.removeSink(d._phys); d._phys = null; }
      const { outId, inId } = d.midi;
      if (!this.midi.enabled || (!outId && !inId)) return;
      const sink = new LP.PhysicalLaunchpadSink(this.midi, outId, inId);
      d.addSink(sink);
      sink.attach(d);
      d._phys = sink;
      this.updateMidiStatus();
    }

    updateMidiStatus() {
      const el = $('#midiStatus');
      if (!this.midi.enabled) { el.textContent = 'MIDI 未使用'; el.classList.remove('on'); return; }
      const phys = this.rig.devices.filter((d) => d._phys).length;
      el.textContent = `MIDI 有効 · 実機 ${phys} 台`;
      el.classList.add('on');
    }

    // ---------- モード ----------

    setMode(mode) {
      this.mode = mode;
      this.manual.reset();
      this.strokes.clear();
      document.querySelectorAll('#modeSeg button').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
      document.querySelectorAll('.opts').forEach((s) => { s.hidden = s.dataset.for !== mode; });
      document.body.dataset.mode = mode;
      $('#hint').textContent = HINTS[mode];
      const rule = $('#soundRule');
      rule.innerHTML = LP.SOUND_RULES[mode].map((r) => `<option value="${r.id}">${r.name}</option>`).join('');
      rule.value = this.sonifier.rule(mode);
      this.updateRuleDesc();
      this.updatePad();
      this.repaint();
      this.updateStats();
      this.persist();
    }

    updateRuleDesc() {
      const r = LP.SOUND_RULES[this.mode].find((x) => x.id === this.sonifier.rule(this.mode));
      $('#ruleDesc').textContent = r ? r.desc : '';
    }

    repaint() {
      if (this.mode === 'manual') this.manual.paint(this.grid);
      else if (this.mode === 'life') this.life.paint(this.colors);
      else this.falling.paint(this.colors);
    }

    updateSchemeColors() {
      this.colors = {};
      for (const k in this.scheme) this.colors[k] = LP.Color.fromHex(this.scheme[k]);
    }

    // ---------- 入力 ----------

    onPress(e) {
      if (this.synth.enabled) this.synth.ensure();
      const cell = this.grid.cellOf(e.device, e.lx, e.ly);
      if (!cell) return;

      if (this.mode === 'falling') {
        if (e.erase) this.falling.removeColumn(cell.globalX);
        else { this.falling.spawnAt(cell.globalX, cell.globalY); this.anim.flash(cell, 0.7); }
        this.repaint();
        return;
      }

      if (this.mode === 'manual' && this.manual.behavior === 'momentary' && !e.erase) {
        this.manual.hold(cell);
        this.anim.flash(cell, 1);
        this.sound(cell, e.velocity);
        this.repaint();
        return;
      }

      // トグル描画: 押し始めのパッドで「点ける/消す」を決め、ドラッグ中は同じ動作を続ける
      let value;
      if (e.drag) value = this.strokes.get(e.pointerId);
      else {
        value = e.erase ? false : !cell.alive;
        if (e.pointerId !== undefined) this.strokes.set(e.pointerId, value);
      }
      if (value === undefined) return;
      if (value) {
        cell.alive = true;
        cell.age = 0;
        cell.paintColor = this.manual.color;
        this.life.forget(cell);
        this.anim.flash(cell, 1);
        if (this.mode === 'manual') this.sound(cell, e.velocity);
      } else if (cell.alive) {
        cell.alive = false;
        this.life.forget(cell);
      }
      this.repaint();
    }

    onRelease(e) {
      const cell = this.grid.cellOf(e.device, e.lx, e.ly);
      if (cell && this.manual.held.has(cell.index)) { this.manual.release(cell); this.repaint(); }
      if (e.end) this.strokes.delete(e.pointerId);
    }

    // 手で押したパッドの音(鳴り方は Sonifier のルールで決まる)
    sound(cell, velocity = 100) { this.sonifier.onPress(cell, velocity); }

    // 和音パッドは再生中、ルールが和音を使う時だけ鳴らす
    updatePad() {
      const want = this.synth.enabled && this.synth.padOn && this.synth.ctx && this.clock.running && this.sonifier.usesPad(this.mode);
      if (want && !this.synth.pad) this.synth.setPadChord(this.harmony.padNotes());
      else if (!want && this.synth.pad) this.synth.stopPad();
      this.synth.setActivity(this.activity);
    }

    updateActivity() {
      let a = 0;
      if (this.mode === 'life') {
        const live = this.grid.cells.filter((c) => !c.void).length;
        a = Math.min(1, (this.grid.population() / Math.max(1, live)) * 4);
      } else if (this.mode === 'falling') {
        a = Math.min(1, this.falling.notes.length / 24);
      } else {
        a = Math.min(1, this.manual.held.size / 6);
      }
      this.activity += (a - this.activity) * 0.2;
      this.synth.setActivity(this.activity);
    }

    // ---------- 時間 ----------

    onTick() {
      if (this.mode === 'life') this.lifeStep();
      else if (this.mode === 'falling') this.fallStep();
      else this.updateActivity();
    }

    lifeStep() {
      if (this.life.generation === 0) this.snapshot = this.grid.capture();
      const res = this.life.step();
      for (const c of res.born) this.anim.flash(c, 0.45);
      this.sonifier.onLifeStep(res);
      this.updateActivity();
      this.repaint();
    }

    fallStep() {
      const hits = this.falling.step();
      for (const h of hits) {
        this.anim.flash(h.cell, 1);
        LP.bus.emit('noteHit', { cell: h.cell, device: h.cell.device, x: h.cell.globalX });
      }
      this.sonifier.onFallStep(hits, this.falling.crossings);
      this.updateActivity();
      this.repaint();
    }

    // ---------- トランスポート ----------

    start() { if (this.synth.enabled) this.synth.ensure(); this.clock.start(); }
    stop() { this.clock.stop(); }
    step() { this.onTick(); }

    reset() {
      if (this.mode === 'falling') { this.falling.clear(); this.falling.hits = 0; }
      else {
        if (this.snapshot) this.grid.restore(this.snapshot);
        this.life.resetHistory();
      }
      this.repaint();
    }

    random() {
      if (this.mode === 'falling') this.falling.burst(10);
      else {
        const colorFn = this.mode === 'manual'
          ? () => LP.Color.scale(LP.Color.fromHex(LP.PALETTE[(Math.random() * LP.PALETTE.length) | 0].hex), this.manual.brightness)
          : null;
        this.grid.randomize(this.density, colorFn);
        this.life.resetHistory();
        this.snapshot = this.grid.capture();
      }
      this.repaint();
    }

    clear() {
      if (this.mode === 'falling') this.falling.clear();
      else { this.grid.clearPattern(); this.life.resetHistory(); }
      this.repaint();
    }

    updateTransport() {
      $('#btnStart').classList.toggle('active', this.clock.running);
      $('#btnStop').classList.toggle('active', !this.clock.running);
    }

    // ---------- 描画ループ ----------

    frame(now) {
      this.anim.frame(now);
      this.minimap.draw(this.grid, this.anim, this.rig);
      if (!this._statT || now - this._statT > 120) { this._statT = now; this.updateStats(); }
      requestAnimationFrame((t) => this.frame(t));
    }

    updateStats() {
      $('#stGen').textContent = this.life.generation;
      $('#stGrid').textContent = `${this.grid.width} × ${this.grid.height}`;
      $('#stDevices').textContent = `${this.rig.count}  ${this.rig.devices.map((d) => d.model).join('')}`;
      $('#stPop').textContent = this.grid.population();
      $('#stHits').textContent = this.falling.hits;
      $('#rateVal').textContent = `${this.clock.stepsPerSecond.toFixed(1)} step/s`;
      $('#stChord').textContent = this.mode === 'manual' && this.sonifier.rule('manual') !== 'chord'
        ? LP.SCALES[this.mapper.scale].name
        : this.harmony.chordName();
    }

    // ---------- 保存 ----------

    persist() {
      clearTimeout(this._persistT);
      this._persistT = setTimeout(() => {
        LP.Store.save(STORE_KEY, {
          mode: this.mode,
          scheme: this.scheme,
          rig: this.rig.serialize(),
          bpm: this.clock.bpm,
          tpb: this.clock.ticksPerBeat,
          wrap: this.life.wrap,
          rule: this.life.rule.str,
          fallRate: this.falling.rate,
          motion: this.falling.motion,
          paint: this.manual.colorHex,
          paintBright: this.manual.brightness,
          behavior: this.manual.behavior,
          fx: this.anim.fx,
          brightness: this.anim.brightness,
          scale: this.mapper.scale,
          channels: this.mapper.channels,
          audio: {
            on: this.synth.enabled,
            volume: this.synth.volume,
            reverb: this.synth.reverb,
            padType: this.synth.padType,
            voices: this.sonifier.voices,
            rules: this.sonifier.rules,
          },
          density: this.density,
        });
      }, 300);
    }

    // ---------- UI 結線 ----------

    bindUI() {
      const on = (sel, ev, fn) => $(sel).addEventListener(ev, fn);

      on('#deviceCount', 'change', (e) => { this.rig.setCount(+e.target.value); this.onRigChanged(); });
      on('#openConfig', 'click', () => this.config.open());
      document.querySelectorAll('#modeSeg button').forEach((b) => b.addEventListener('click', () => this.setMode(b.dataset.mode)));

      const sound = $('#soundToggle');
      sound.checked = this.synth.enabled;
      sound.addEventListener('change', () => {
        this.synth.enabled = sound.checked;
        if (sound.checked) this.synth.ensure();
        this.updatePad();
        this.persist();
      });
      const scale = $('#scaleSelect');
      scale.innerHTML = Object.entries(LP.SCALES).map(([k, s]) => `<option value="${k}">${s.name}</option>`).join('');
      scale.value = this.mapper.scale;
      scale.addEventListener('change', () => {
        this.mapper.scale = scale.value;
        this.harmony.setModeFromScale(scale.value); // マイナー系の音階ならコード進行もマイナーに
        this.persist();
      });
      const vol = $('#volume');
      vol.value = this.synth.volume;
      vol.addEventListener('input', () => { this.synth.setVolume(+vol.value); this.persist(); });
      const rev = $('#reverb');
      rev.value = this.synth.reverb;
      rev.addEventListener('input', () => { this.synth.setReverb(+rev.value); this.persist(); });
      const opts = (list) => list.map((o) => `<option value="${o.id}">${o.name}</option>`).join('');
      const pad = $('#padType');
      pad.innerHTML = opts(LP.PAD_TYPES);
      pad.value = this.synth.padType;
      pad.addEventListener('change', () => {
        this.synth.padType = pad.value;
        if (this.synth.pad) this.synth.stopPad(); // 音色を変えたら鳴らし直す
        setTimeout(() => this.updatePad(), 50);
        this.persist();
      });
      for (const [sel, hand] of [['#voiceL', 'left'], ['#voiceR', 'right']]) {
        const el = $(sel);
        el.innerHTML = opts(LP.INSTRUMENTS);
        el.value = this.sonifier.voices[hand];
        el.addEventListener('change', () => { this.sonifier.voices[hand] = el.value; this.persist(); });
      }
      const soundRule = $('#soundRule');
      soundRule.addEventListener('change', () => {
        this.sonifier.setRule(this.mode, soundRule.value);
        this.updateRuleDesc();
        this.updatePad();
        this.persist();
      });

      on('#btnStart', 'click', () => this.start());
      on('#btnStop', 'click', () => this.stop());
      on('#btnStep', 'click', () => this.step());
      on('#btnReset', 'click', () => this.reset());
      on('#btnRandom', 'click', () => this.random());
      on('#btnClear', 'click', () => this.clear());
      this.updateTransport();

      const bpm = $('#bpm');
      bpm.value = this.clock.bpm;
      $('#bpmVal').textContent = this.clock.bpm;
      bpm.addEventListener('input', () => { this.clock.setBpm(+bpm.value); $('#bpmVal').textContent = bpm.value; this.updateStats(); this.persist(); });
      const div = $('#division');
      div.value = String(this.clock.ticksPerBeat);
      div.addEventListener('change', () => { this.clock.setTicksPerBeat(+div.value); this.updateStats(); this.persist(); });

      // Manual
      const pal = $('#palette');
      const swatches = LP.PALETTE.map((p) => `<button class="sw" data-hex="${p.hex}" title="${p.name}" style="--sw:${p.hex}"></button>`);
      pal.innerHTML = swatches.join('') + `<input type="color" id="paintCustom" title="任意の色">`;
      const markSwatch = () => pal.querySelectorAll('.sw').forEach((b) => b.classList.toggle('active', b.dataset.hex === this.manual.colorHex));
      pal.addEventListener('click', (e) => {
        const b = e.target.closest('.sw');
        if (!b) return;
        this.manual.colorHex = b.dataset.hex;
        markSwatch(); this.repaint(); this.persist();
      });
      const custom = $('#paintCustom');
      custom.value = this.manual.colorHex;
      custom.addEventListener('input', () => { this.manual.colorHex = custom.value; markSwatch(); this.repaint(); this.persist(); });
      markSwatch();
      const pb = $('#paintBright');
      pb.value = this.manual.brightness;
      pb.addEventListener('input', () => { this.manual.brightness = +pb.value; this.repaint(); this.persist(); });
      const beh = $('#behavior');
      beh.value = this.manual.behavior;
      beh.addEventListener('change', () => { this.manual.behavior = beh.value; this.manual.reset(); this.persist(); });

      // Life
      const rule = $('#rule');
      rule.innerHTML = LP.LIFE_RULES.map((r) => `<option value="${r.rule}">${r.name}</option>`).join('');
      rule.value = this.life.rule.str;
      rule.addEventListener('change', () => { this.life.setRule(rule.value); this.persist(); });
      const wrap = $('#wrap');
      wrap.checked = this.life.wrap;
      wrap.addEventListener('change', () => { this.life.wrap = wrap.checked; this.persist(); });
      const dens = $('#density');
      dens.value = this.density;
      dens.addEventListener('input', () => { this.density = +dens.value; this.persist(); });

      // Falling
      const motion = $('#motion');
      motion.value = this.falling.motion;
      motion.addEventListener('change', () => { this.falling.motion = motion.value; this.persist(); });
      const fr = $('#fallRate');
      fr.value = this.falling.rate;
      fr.addEventListener('input', () => { this.falling.rate = +fr.value; this.persist(); });

      // 配色(Life / Falling 共通の scheme)
      document.querySelectorAll('input[data-scheme]').forEach((inp) => {
        inp.value = this.scheme[inp.dataset.scheme];
        inp.addEventListener('input', () => {
          this.scheme[inp.dataset.scheme] = inp.value;
          this.updateSchemeColors(); this.repaint(); this.persist();
        });
      });
      on('#schemeReset', 'click', () => {
        this.scheme = Object.assign({}, DEFAULT_SCHEME);
        document.querySelectorAll('input[data-scheme]').forEach((inp) => { inp.value = this.scheme[inp.dataset.scheme]; });
        this.updateSchemeColors(); this.repaint(); this.persist();
      });

      // LED 効果
      document.querySelectorAll('input[data-fx]').forEach((inp) => {
        inp.checked = this.anim.fx[inp.dataset.fx];
        inp.addEventListener('change', () => {
          this.anim.fx[inp.dataset.fx] = inp.checked;
          $('#stage').classList.toggle('no-glow', !this.anim.fx.glow);
          this.persist();
        });
      });
      $('#stage').classList.toggle('no-glow', !this.anim.fx.glow);
      const br = $('#brightness');
      br.value = this.anim.brightness;
      br.addEventListener('input', () => { this.anim.brightness = +br.value; this.persist(); });

      // キーボード
      window.addEventListener('keydown', (e) => {
        if (e.target.closest('input, select, textarea, dialog') || e.ctrlKey || e.metaKey || e.altKey) return;
        const k = e.key.toLowerCase();
        if (k === ' ') { e.preventDefault(); this.clock.running ? this.stop() : this.start(); }
        else if (k === 'arrowright' || k === '.') this.step();
        else if (k === 'r') this.random();
        else if (k === 'c') this.clear();
        else if (k === 'backspace') this.reset();
        else if (k === '1') this.setMode('manual');
        else if (k === '2') this.setMode('life');
        else if (k === '3') this.setMode('falling');
      });
    }
  }

  LP.App = App;
  window.addEventListener('DOMContentLoaded', () => { LP.app = new App(); });
})(window.LP = window.LP || {});

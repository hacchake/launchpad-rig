// Sonifier: 盤面の出来事 → 音 の対応ルール(鳴り方)
// モードごとに複数のルールから選べる。どのルールも生成音はコードトーンに乗るので濁らない。
// 実際に鳴ったセルは強くフラッシュさせ、音と光を連動させる。
(function (LP) {
  'use strict';
  const { clamp } = LP.util;

  const RULES = {
    manual: [
      { id: 'scale', name: '音階(パッドごとに固定)', desc: '押した場所で音程が決まる楽器。音階は上部バーで選ぶ。' },
      { id: 'chord', name: 'コードに合わせる', desc: 'パッドの音程が今のコードの構成音になる。START中はコード進行に合わせて変わる。' },
      { id: 'mute', name: '鳴らさない', desc: '' },
    ],
    life: [
      { id: 'birth', name: '誕生(高さ=音程)', desc: '生まれたセルから数個を選んで鳴らす。上ほど高い音。' },
      { id: 'scan', name: 'スキャン(左→右に読む)', desc: '縦の線が左から右へ走り、その列で生きているセルを鳴らす。シーケンサー風。' },
      { id: 'arp', name: 'アルペジオ(数=音域)', desc: '毎ステップ1音ずつ和音を上り下り。生きているセルが多いほど音域が広がる。' },
      { id: 'death', name: '消滅(低く静かに)', desc: '死んだセルを低めの音で静かに鳴らす。' },
      { id: 'mute', name: '鳴らさない', desc: '' },
    ],
    falling: [
      { id: 'column', name: '到達(列=音程)', desc: '下端に着いたノートを鳴らす。列ごとに音程が決まる。' },
      { id: 'cross', name: '到達+境界越え', desc: '下端に加え、ノートが Launchpad の境界を越えた瞬間にもオルゴールで鳴る。' },
      { id: 'drum', name: '左手ドラム+右手メロディ', desc: '左手側の列はキック/スネア/ハット/クラップ、右手側の列はメロディ。' },
      { id: 'mute', name: '鳴らさない', desc: '' },
    ],
  };

  const DRUM_BY_COLUMN = ['kick', 'kick', 'snare', 'snare', 'hat', 'hat', 'clap', 'clap'];

  class Sonifier {
    constructor(app) {
      this.app = app;
      this.rules = { manual: 'scale', life: 'birth', falling: 'column' };
      this.voices = { left: 'mallet', right: 'bell' };
      // 発音数の上限(トークンバケット)。音が詰まりすぎないように。
      this.budget = {
        life: { rate: 5, max: 3, tokens: 3, t: 0 },
        fall: { rate: 10, max: 4, tokens: 4, t: 0 },
        cross: { rate: 8, max: 3, tokens: 3, t: 0 },
      };
      this.scanX = 0;
      this.arpI = 0;
      this.arpDir = 1;
    }

    get synth() { return this.app.synth; }
    get harmony() { return this.app.harmony; }
    get grid() { return this.app.grid; }

    rule(mode) { return this.rules[mode]; }

    setRule(mode, id) {
      this.rules[mode] = id;
      this.scanX = 0;
    }

    // 和音パッドを使うか(手動演奏でもコード追従なら使う)
    usesPad(mode) {
      const r = this.rules[mode];
      if (r === 'mute') return false;
      return mode !== 'manual' || r === 'chord';
    }

    take(kind) {
      const b = this.budget[kind];
      const now = performance.now();
      b.tokens = Math.min(b.max, b.tokens + ((now - b.t) / 1000) * b.rate);
      b.t = now;
      if (b.tokens < 1) return false;
      b.tokens--;
      return true;
    }

    // 発音の共通口: 内蔵シンセ + (設定されていれば)MIDIノート出力
    voice(cell, note, velocity, when = 0, instrument) {
      const app = this.app;
      const d = cell.device;
      const pan = this.panOf(cell);
      app.synth.play(note, velocity, { pan, voice: instrument || this.voices[d.handSide], when });
      if (app.noteOutPort) {
        const ch = app.mapper.channelFor(d);
        setTimeout(() => app.midi.pulseNote(app.noteOutPort, ch, note, Math.round(velocity), 180), when * 1000);
      }
      LP.bus.emit('note', { cell, device: d, note, velocity });
    }

    panOf(cell) { return ((cell.globalX + 0.5) / this.grid.width * 2 - 1) * 0.75; }

    // 巨大グリッド上の高さ(上=高音)を今のコードトーンに割り当てる
    chordNote(cell, lo = 43, hi = 93) {
      const tones = this.harmony.tones(lo, hi);
      const H = this.grid.height;
      const top = Math.min(tones.length - 1, 15);
      const idx = Math.round(((H - 1 - cell.globalY) / Math.max(1, H - 1)) * (top - 3)) + (cell.globalX >= this.grid.width / 2 ? 3 : 0);
      return tones[clamp(idx, 0, tones.length - 1)];
    }

    // 列ごとにコードトーンを割り当てる(左手側の列は低め、右手側は高め)
    columnNote(cell) {
      const tones = this.harmony.tones(43, 93);
      const x = cell.globalX, half = this.grid.width / 2;
      return tones[Math.min(tones.length - 1, x < half ? x : x - 3)];
    }

    // 生きているセルの集合から、音程の重ならない数個を低い順に選ぶ
    pick(cells, max, noteFn) {
      const byNote = new Map();
      for (const c of cells.slice().sort(() => Math.random() - 0.5)) {
        const n = noteFn(c);
        if (!byNote.has(n)) byNote.set(n, c);
      }
      return [...byNote.entries()].slice(0, max).sort((a, b) => a[0] - b[0]);
    }

    // ---------- 手で押した時 ----------

    onPress(cell, velocity) {
      const r = this.rules.manual;
      if (r === 'mute' || !this.synth.enabled) return;
      let note;
      if (r === 'chord') {
        const base = this.app.mapper.baseFor(cell.device);
        const tones = this.harmony.tones(base, base + 48);
        note = tones[Math.min(tones.length - 1, cell.localX + (7 - cell.localY))];
      } else {
        note = this.app.mapper.noteFor(cell.device, cell.localX, cell.localY);
      }
      this.voice(cell, note, velocity);
    }

    // ---------- Game of Life ----------

    onLifeStep(res) {
      if (!this.synth.enabled) return;
      const anim = this.app.anim;
      switch (this.rules.life) {
        case 'birth': {
          let k = 0;
          for (const [note, c] of this.pick(res.born, 3, (c) => this.chordNote(c))) {
            if (!this.take('life')) break;
            this.voice(c, note, 55 + Math.random() * 30, k++ * 0.045);
            anim.flash(c, 1);
          }
          break;
        }
        case 'death': {
          let k = 0;
          for (const [note, c] of this.pick(res.died, 2, (c) => this.chordNote(c, 36, 76))) {
            if (!this.take('life')) break;
            this.voice(c, note, 40 + Math.random() * 25, k++ * 0.06);
            anim.flash(c, 0.8);
          }
          break;
        }
        case 'scan': {
          const g = this.grid;
          const x = this.scanX;
          this.scanX = (x + 1) % g.width;
          const col = [];
          for (let y = 0; y < g.height; y++) {
            const c = g.get(x, y);
            if (c.void) continue;
            anim.flash(c, 0.16); // 走査線を薄く光らせる
            if (c.alive) col.push(c);
          }
          let k = 0;
          for (const [note, c] of this.pick(col, 2, (c) => this.chordNote(c))) {
            this.voice(c, note, 55 + Math.random() * 25, k++ * 0.02);
            anim.flash(c, 1);
          }
          break;
        }
        case 'arp': {
          const g = this.grid;
          const pop = g.population();
          if (!pop) break;
          const live = g.cells.filter((c) => !c.void).length;
          const tones = this.harmony.tones(48, 96);
          const span = clamp(Math.round((pop / live) * 40) + 3, 3, tones.length);
          this.arpI += this.arpDir;
          if (this.arpI >= span - 1) { this.arpI = span - 1; this.arpDir = -1; }
          if (this.arpI <= 0) { this.arpI = 0; this.arpDir = 1; }
          const pool = res.born.length ? res.born : g.cells.filter((c) => c.alive);
          const c = pool[(Math.random() * pool.length) | 0];
          this.voice(c, tones[this.arpI], 60 + Math.min(35, res.born.length * 4));
          anim.flash(c, 1);
          break;
        }
      }
    }

    // ---------- Falling Notes ----------

    onFallStep(hits, crossings) {
      if (!this.synth.enabled) return;
      const r = this.rules.falling;
      if (r === 'mute') return;
      const anim = this.app.anim;
      hits.forEach((h, i) => {
        const c = h.cell;
        if (!this.take('fall')) return;
        if (r === 'drum' && c.globalX < this.grid.width / 2) {
          const kind = DRUM_BY_COLUMN[c.globalX % 8];
          this.synth.drum(kind, 90 + Math.random() * 30, { pan: this.panOf(c), when: i * 0.01 });
          LP.bus.emit('drum', { cell: c, kind });
        } else {
          this.voice(c, this.columnNote(c), 85 + Math.random() * 30, i * 0.02);
        }
      });
      if (r === 'cross') {
        for (const c of crossings) {
          if (!this.take('cross')) break;
          this.voice(c, Math.min(108, this.columnNote(c) + 12), 45, 0, 'musicbox');
          anim.flash(c, 0.9);
        }
      }
    }
  }

  LP.SOUND_RULES = RULES;
  LP.Sonifier = Sonifier;
})(window.LP = window.LP || {});

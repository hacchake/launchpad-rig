// MIDI Adapter(Web MIDI API)
//
//   LaunchpadDevice ── PhysicalLaunchpadSink ── WebMidiAdapter ── 実機 Launchpad
//
// 実機なしでも動くよう、有効化しない限り何もしない。
// Protocols に機種ごとのLED制御・入力解析をまとめてある(実機での動作は未検証)。
(function (LP) {
  'use strict';

  const SYSEX_X = [0xf0, 0x00, 0x20, 0x29, 0x02, 0x0c];

  const Protocols = {
    // Launchpad S: X-Yレイアウト。パッドのノート番号 = 行*16 + 列
    S: {
      init: () => [[0xb0, 0x00, 0x00], [0xb0, 0x00, 0x01]], // リセット → X-Yレイアウト
      ledMessages(changes) {
        return changes.map(({ lx, ly, q }) => [0x90, ly * 16 + lx, LP.Profiles.S.velocity(q)]);
      },
      parse(data) {
        const st = data[0] & 0xf0;
        if (st !== 0x90 && st !== 0x80) return null;
        const n = data[1], lx = n % 16, ly = Math.floor(n / 16);
        if (lx > 7 || ly > 7) return null;
        return { lx, ly, velocity: st === 0x80 ? 0 : data[2] };
      },
    },
    // Launchpad X: Programmer モード。パッド番号 = (8-行)*10 + 列+1(左下が11)
    X: {
      init: () => [[...SYSEX_X, 0x0e, 0x01, 0xf7]],
      index: (lx, ly) => (8 - ly) * 10 + (lx + 1),
      ledMessages(changes) {
        // RGB LED を SysEx でまとめて送る: 03 <03 index r g b>... F7
        const msgs = [];
        for (let i = 0; i < changes.length; i += 64) {
          const m = [...SYSEX_X, 0x03];
          for (const { lx, ly, q } of changes.slice(i, i + 64)) m.push(0x03, this.index(lx, ly), q.r, q.g, q.b);
          m.push(0xf7);
          msgs.push(m);
        }
        return msgs;
      },
      parse(data) {
        const st = data[0] & 0xf0;
        if (st !== 0x90 && st !== 0x80) return null;
        const n = data[1], row = Math.floor(n / 10), col = n % 10;
        if (row < 1 || row > 8 || col < 1 || col > 8) return null;
        return { lx: col - 1, ly: 8 - row, velocity: st === 0x80 ? 0 : data[2] };
      },
    },
  };

  class WebMidiAdapter {
    constructor() {
      this.access = null;
      this.bus = new LP.EventBus();
      this.listeners = new Map();
    }

    get supported() { return !!navigator.requestMIDIAccess; }
    get enabled() { return !!this.access; }

    async enable() {
      if (this.access) return this.access;
      if (!this.supported) throw new Error('このブラウザは Web MIDI API に対応していません');
      this.access = await navigator.requestMIDIAccess({ sysex: true });
      this.access.onstatechange = () => { this._bindInputs(); this.bus.emit('ports'); };
      this._bindInputs();
      this.bus.emit('ports');
      return this.access;
    }

    outputs() { return this.access ? [...this.access.outputs.values()].map((p) => ({ id: p.id, name: p.name })) : []; }
    inputs() { return this.access ? [...this.access.inputs.values()].map((p) => ({ id: p.id, name: p.name })) : []; }

    send(portId, bytes) {
      if (!this.access || !portId) return;
      const port = this.access.outputs.get(portId);
      if (!port) return;
      try { port.send(bytes); } catch (e) { console.warn('MIDI送信失敗', e); }
    }

    listen(portId, fn) {
      if (!this.listeners.has(portId)) this.listeners.set(portId, new Set());
      this.listeners.get(portId).add(fn);
      this._bindInputs();
      return () => { const s = this.listeners.get(portId); if (s) s.delete(fn); };
    }

    _bindInputs() {
      if (!this.access) return;
      for (const input of this.access.inputs.values()) {
        input.onmidimessage = (ev) => {
          const set = this.listeners.get(input.id);
          if (set) for (const fn of set) fn(ev.data);
        };
      }
    }

    noteOn(portId, ch, note, vel) { this.send(portId, [0x90 | ch, note, vel]); }
    noteOff(portId, ch, note) { this.send(portId, [0x80 | ch, note, 0]); }
    pulseNote(portId, ch, note, vel, ms = 200) {
      if (!portId) return;
      this.noteOn(portId, ch, note, vel);
      setTimeout(() => this.noteOff(portId, ch, note), ms);
    }
  }

  // 実機 Launchpad を LaunchpadDevice の sink として扱う。
  // 仮想表示(VirtualLaunchpadView)と同じ setLed()/flush() インターフェース。
  class PhysicalLaunchpadSink {
    constructor(adapter, outId, inId) {
      this.adapter = adapter;
      this.outId = outId;
      this.inId = inId;
      this.pending = new Map();
      this.unlisten = null;
      this.device = null;
    }

    get protocol() { return Protocols[this.device.model]; }

    attach(device) {
      this.device = device;
      for (const m of this.protocol.init()) this.adapter.send(this.outId, m);
      if (this.inId) {
        this.unlisten = this.adapter.listen(this.inId, (data) => {
          const p = this.protocol.parse(data);
          if (!p) return;
          if (p.velocity > 0) device.press(p.lx, p.ly, { velocity: p.velocity, source: 'midi' });
          else device.release(p.lx, p.ly, { source: 'midi' });
        });
      }
      device.invalidate();
    }

    onModelChange(device) {
      this.detach(device);
      this.attach(device);
    }

    setLed(lx, ly, q) { this.pending.set(ly * 8 + lx, { lx, ly, q }); }

    flush() {
      if (!this.pending.size) return;
      const changes = [...this.pending.values()];
      this.pending.clear();
      if (!this.outId) return;
      for (const m of this.protocol.ledMessages(changes)) this.adapter.send(this.outId, m);
    }

    detach(device) {
      if (this.unlisten) this.unlisten();
      this.unlisten = null;
      this.pending.clear();
      if (!this.outId || !device) return;
      const off = device.profile.off();
      const all = [];
      for (let ly = 0; ly < 8; ly++) for (let lx = 0; lx < 8; lx++) all.push({ lx, ly, q: off });
      for (const m of Protocols[device.model].ledMessages(all)) this.adapter.send(this.outId, m);
    }
  }

  LP.MidiProtocols = Protocols;
  LP.WebMidiAdapter = WebMidiAdapter;
  LP.PhysicalLaunchpadSink = PhysicalLaunchpadSink;
})(window.LP = window.LP || {});

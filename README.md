# Multi-Launchpad Rig(複数Launchpad仮想演奏システム)

実機の Launchpad S / Launchpad X を買う前に、画面上で 2〜6 台を「左手・右手 × 上中下段」に並べて、
両手で操作する感覚を試すためのプロトタイプ。

## 起動

`index.html` をブラウザで開くだけ(ダブルクリックで可。外部ライブラリなし)。
Web MIDI を使う場合は Chrome / Edge で開く。

```
        左手        右手
上段   [ LP1 ]     [ LP2 ]
中段   [ LP3 ]     [ LP4 ]
下段   [ LP5 ]     [ LP6 ]
```

## 操作

| 操作 | 内容 |
|---|---|
| クリック / 右クリック | パッドON・OFF(Manual / Game of Life) |
| ドラッグ | 台をまたいで連続描画 |
| 本体の縁・名札をドラッグ | 物理配置の移動(論理グリッドは変わらない) |
| Shift + ホイール | 本体の回転 |
| Space / → / R / C / Backspace | START・STOP / STEP / RANDOM / CLEAR / RESET |
| 1 / 2 / 3 | Manual / Game of Life / Falling Notes |

タッチ画面なら Pointer Events で複数指を同時に扱えるので、実際に両手で叩ける。

## 構成

```
UI (ui/app.js, stage.js, pad-input.js, config.js, minimap.js)
 ↓
Virtual Launchpad (launchpad/virtual-view.js)        ← 画面表示 sink
 ↓
Launchpad abstraction (launchpad/device.js, profiles.js, rig.js)
 ↓
MIDI Adapter (midi/midi-adapter.js)                   ← 実機 sink
 ↓
Physical Launchpad
```

| フォルダ | 役割 |
|---|---|
| `js/core/` | イベントバス・保存・抽象色・**Clock(時間管理、描画と独立)** |
| `js/launchpad/` | `LaunchpadDevice`(共通インターフェース)、機種プロファイル、台数・論理スロット・物理配置の管理 |
| `js/grid/` | 全台を一枚にした巨大グリッド(16 × 段数×8)。台の無い場所は void |
| `js/engines/` | Game of Life(B/S ルール切替)、Falling Notes、Manual |
| `js/render/` | Animation Engine(fade / afterglow / pulse / flash を合成) |
| `js/midi/` | 音程マッピング(handSide × rowLayer)、Web MIDI アダプタ、Launchpad S/X のLED・入力プロトコル |
| `js/audio/` | 試し弾き用の簡易シンセ(左手は左、右手は右に定位) |

### 設計上のポイント

- **物理配置と論理グリッドの分離**: `device.slot`(巨大グリッド上の位置)と `device.physical`(画面上の mm 座標・回転)は別物。
  ドラッグ・回転・「物理: 左右入れ替え」は physical だけを変え、セルのつながりは slot で決まる。
- **仮想と実機が同じインターフェース**: `LaunchpadDevice` は複数の sink を持てる。
  画面表示(`VirtualLaunchpadView`)も実機(`PhysicalLaunchpadSink`)も `setLed()` / `flush()` を実装するだけ。
  入力もマウス・実機MIDIとも `device.press()` / `release()` に集約される。台ごとに仮想のみ・実機併用を混在できる。
- **色の抽象化**: エンジンは抽象色 `{r,g,b}` だけを扱う。`profiles.js` の `quantize()` が機種ごとに丸める。
  - Launchpad S: 赤LED・緑LED 各4段階(青は無い)。実機の Note On ベロシティにそのまま変換できる値を持つ。
  - Launchpad X: RGB 各127段階。実機へは SysEx(Programmer モード)で送る。
- **handSide / rowLayer**: 論理スロットの列・段から決まる。`NoteMapper` が左右の手と段で音域・MIDIチャンネルを分ける
  (上段=高音、下段=低音、右手は左手より1オクターブ上。左手 ch1 / 右手 ch2)。
- **時間管理**: `Clock` が BPM × 分割で tick / beat を発行。Life・Falling は tick で進み、pulse は拍の位相に同期。

### 拡張のための差し込み口

- `LP.bus` の `note`(パッドを鳴らした)/ `noteHit`(Falling Notes が下端に到達)を購読すれば別のMIDI処理を追加できる。
- 新しいモードは `paint(grid)` でセルの `state` / `color` / `level` を書くエンジンを作り、`App.onTick` / `App.repaint` に足す。

## 注意

- 実機の寸法・パッド配置は概算。実寸比率は LP Configuration で切り替えられる。
- Web MIDI(実機LED・入力・音源への出力)は実装済みだが、実機では未検証。

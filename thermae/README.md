# yukemuri（湯けむり）

バケツリレー素子（BBD）のクロックを動かして、**ディレイタイムの変化そのものからピッチを作る**
リアルタイム・アナログ風ディレイ／ピッチシーケンサー。ブラウザだけで動きます。

Chase Bliss THERMAE の「仕組み」を調べて独自に書き起こした非公式の習作です。
製品の回路・ファームウェアとは無関係で、メーカーとの関係もありません。

## 動かす

```
# どちらでもOK
open thermae/index.html               # そのまま開く（ScriptProcessorで動作）
npx http-server -p 8080 thermae       # サーバー経由（AudioWorkletで動作・低レイテンシ推奨）
```

ビルド不要。依存パッケージもゼロ。`index.html` / `style.css` / `engine.js` / `app.js` だけです。

音源は3つから選べます。

- **マイク／ライン入力** — リアルタイム。ギターやマイクを挿して弾く。**必ずヘッドホンで**（スピーカーだとハウります）
- **音源ファイル** — ドラッグ＆ドロップ、ループ再生
- **内蔵デモ音** — 機材なしで試せる Karplus-Strong のギター風プラック

## 何をやっているか

ピッチシフターは普通、音程を検出して digital に作り直します。THERMAE はそれをやりません。
**ディレイタイムを変えると、すでにバケツの中に溜まっている音が新しい速度で押し出される**——
早く押し出せば音程が上がり、遅く押し出せば下がる。それだけです。

`engine.js` も同じ作りになっています。

```
入力 → コンパンダ → アンチエイリアスLPF（カットオフはクロックに追従）
     → 16384個のバケツ（クロック fc で駆動）→ サンプル＆ホールド
     → 再生LPF（同じくクロック追従）→ エキスパンダ
     → レゾナントLPF（TONE）→ REGEN → バケツの入口へ戻る
```

ディレイタイムは `16384 / fc`。フィルターのカットオフがクロックに追従するので、

- 1オクターブ下＝クロック半分＝**暗くてノイジー**
- 1オクターブ上＝クロック倍＝**明るくて締まった音**

という音質差が、狙って足したのではなく構造から勝手に出てきます。
ピッチ変化がリピートにだけかかり生音はそのまま、というのも同じ理由です。

### シーケンス

`基準 → INT 1 → INT 1+INT 2 → 基準…` と回ります（INT 2 は**加算**：両方 -12 なら3段目は -24）。
各ステップの長さは3つのトグル（♩ ／ ♪. ／ ♪）でタップテンポの音符分割として決まります。
INT を OFF にしたステップは飛ばされるので、2ステップにも、ただのアナログディレイにもなります。

### 検証した動作

| 項目 | 結果 |
|---|---|
| ディレイタイム | 400ms 設定で実測 400ms |
| INT = -12 | 440Hz 入力 → リピートが 220Hz |
| INT = +12 | 220Hz 入力 → リピートが 440Hz |
| 自己発振 | REGEN 0.85 あたりから持続（実機の3時方向に相当） |
| 処理負荷 | node 上で 55倍速（AudioWorklet で余裕） |

## 操作

| | |
|---|---|
| ノブ | ドラッグ／ホイール／矢印キー（Shiftで微調整） |
| TAP | クリックでタップテンポ、**長押しで SLOWDOWN**（最長32秒まで伸びる） |
| BYPASS | クリックでON/OFF、長押しで残響を消す |
| STEP MODE | 自動送りを止めて、TAPを踏むたびに1ステップ進む |
| キーボード | `space` タップ ／ `B` バイパス ／ `S` 長押しでスローダウン ／ `P` デモを1音 |

INT ノブのクリック位置は 4th / 5th / oct / oct+5th / 2oct の上下＋中央 OFF。
どこに回しても演奏を邪魔しない音程しか出ません。半音きざみにしたい場合は CHROMATIC を ON に。

`［拡張］` と書いてあるもの（BOUNCE、CHROMATIC）と TIME スライダーはこのアプリ独自の追加です。

## 実装メモ

- DSP は `engine.js` の `ThermaeEngine` 1クラスだけ。外部依存もクロージャも持たないので、
  `toString()` して Blob 経由で AudioWorklet に渡せます。同じクラスを
  ScriptProcessorNode でも直接動かせるため、`file://` で開いても音が出ます。
- 設定は localStorage に保存されます。
- `window.yukemuri` にデバッグ用のハンドルが出ています。

## 参考

- [Chase Bliss — Thermae](https://www.chasebliss.com/thermae)
- [Premier Guitar レビュー](https://www.premierguitar.com/gear/chase-bliss-audio-thermae-review)
- [Pedal of the Day](https://www.pedal-of-the-day.com/2018/07/20/chase-bliss-audio-thermae-analog-delay-pitch-shifter/)
- [Vintage King — First Listen](https://vintageking.com/blog/2018/06/chase-bliss-audio-thermae)

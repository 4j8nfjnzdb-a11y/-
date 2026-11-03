# harimaze — Max/MSP コラージュ・マシン 5 台

貼り交ぜ（はりまぜ）屏風のように、断片を貼り合わせて別のものを立ち上げるための Max パッチ 11 本です。
どれも **gen~ のコードボックス 1 つ** が心臓部で、周りは音源・パラメータ・プリセット・出力だけのシンプルな構成です。

| パッチ | 何をするか | 文脈 |
|---|---|---|
| `harimaze_tenki.maxpat` 天気 | ループ窓が天気のように変わる。テープ停止・巻き戻し・過去への跳躍・マイクロループへの凍結・窓の漂い | Philip Jeck の速度操作、竹村延和の SCRUB 的即興、Ulla の揺れるループ |
| `harimaze_kizu.maxpat` 傷盤 | 傷ついた CD。引っかかり（少しずつずれる）、飛び、欠落、ジッ音、崩れたエラー補間 | Oval、刀根康尚『Solo for Wounded CD』 |
| `harimaze_mebuki.maxpat` 芽吹 | 2 音源のグラニュラー。morph が「次の粒をどちらから取るか」の確率なので、A の中に B が芽を出す | Jake Muir、KMRU、竹村延和のおもちゃ的旋律 |
| `harimaze_tsuioku.maxpat` 追憶 | 32 秒の円環テープ + 3 つの「想起」ヘッド。思い出した音は風化して再録される | Jeck / Basinski、Ulla『Hometown Girl』、claire rousay |
| `harimaze_kiri.maxpat` 切貼 | 等分スライス × 16 ステップ。毎周一部が変異する | 竹村延和、Jan Jelinek、Space Afrika / Klein |
| `harimaze_bake.maxpat` 化け | データベンディング。バイト入替・ビット反転・符号の誤読・深度・レート誤読・ステレオ誤読・ブロック反復 | 刀根康尚・Oval の延長、文字化けの音版 |
| `harimaze_wa.maxpat` 輪 | 割り切れない周期の 8 本のループ。断片と沈黙、擦り減りと切り直し | Eno のループ・システム、Basinski、Huerco S. |
| `harimaze_hibiki.maxpat` 響 | 8 本の共鳴器で、入力（雨・声・ノイズ）を和音にする。和音は漂い、移り変わる。マイク入力可 | SUGAI KEN、KMRU、竹村延和の Tone Poems |
| `harimaze_kosuri.maxpat` 擦 | モーターと手のバネの物理モデル。自動スクラッチと、スライダーで手動スクラッチ | 竹村延和の SCRUB、Jeck、大友良英 |
| `harimaze_ni.maxpat` 似 | 断片の大きさと明るさを測り、似た断片へ歩く。sweep で音の並べ替え | Jelinek、Space Afrika / Klein、コンカテネイティブ合成 |
| `harimaze_kodama.maxpat` こだま | ダブ・ディレイ。断片の投げ込み、拍で跳ぶディレイタイム、逆回転、フィルターと飽和の帰還。マイク入力可 | Ulla『foam』のダブ、3XL 周辺 |

## 動かし方

1. Max 8.1 以降（Max 9 でも可）でパッチを開く。gen~ は Max 本体に含まれています。
2. 音声ファイルをドロップ欄に落とす（または `replace` で選ぶ）。
3. 右下の **ezdac~**（スピーカー）をクリックしてオーディオを ON。
4. 右上の **プリセット ●** を押す。起動時は 1 番目のプリセットが自動で入ります。
5. パラメータの数字をドラッグ。

起動時は**音源が空**です（サンプルは何も読み込みません）。ドロップ欄にファイルを落とすか、`replace` でファイルを選んでください。

## つくり

```
[r <machine>_<param>] → [flonum] → [prepend <param>] → [gen~]   … 各パラメータ（受信名でプリセットが数字も更新する）
[●] → [; <machine>_speed 1; ...]                                 … プリセット（隠しメッセージ）
[button] → [click~] → gen~ in1                                    … 今すぐイベント / 外部トリガー
gen~ out1, out2 → [*~] → ezdac~ / meter~ / sfrecord~              … 出力と録音
gen~ out3 → [snapshot~] → slider                                  … 再生位置（戻る・進むが見える）
gen~ out4 → [snapshot~] → 数字                                     … 状態（天気・故障の種類など）
```

- gen~ をダブルクリックするとコードが読めます。同じコードが `genexpr/*.genexpr` にもあります。
- **in1 はトリガー入力**（tsuioku・hibiki・kodama は in1/in2 がライブ入力）。立ち上がりでイベントが起きるので、
  別のマシンの out4 や `[metro]` → `[click~]`、ドラムの検出信号などで駆動すると、マシン同士を連鎖させられます。
- パラメータ名はそのまま gen~ へのメッセージです（例: `[weather 0.8(` を gen~ に送る）。
- 受信名は `tenki_speed` のように `<マシン名>_<パラメータ名>`。別パッチから `[s tenki_weather]` で操作できます。
- バッファ名はマシンごとに別（`hz_tenki_src` など）なので、5 台を同時に開いても干渉しません。

## パラメータ早見表

**天気 tenki** — `speed` 速度（負で逆）/ `start` 窓の開始 / `size` 窓の長さ / `drift` 窓の漂い /
`weather` イベント頻度 / `tapestop` `rewind` `leap` `freeze` 各イベントの重み / `glide` 速度変化の慣性 ms /
`xfade` 継ぎ目のクロスフェード ms / `level`

**傷盤 kizu** — `speed` / `damage` 故障の頻度 / `stick` `skip` `drop` `zip` 各故障の重み / `sticklen` 引っかかる断片の長さ ms /
`creep` 引っかかり点のずれ / `crush` 故障中の劣化 / `click` 0 で 4ms クロスフェード、1 で生の切断 / `level`

**芽吹 mebuki** — `morph` B から粒を取る確率 / `bloom` morph の自走 / `position` 読み位置 / `scan` 時間の流れ（実時間比、負で逆行）/
`spray` 位置の散り / `density` 粒/秒 / `grainsize` ms / `pitch` 半音 / `pspray` 音高の散り / `toy` 五音音階に丸める /
`rev` 逆再生率 / `width` 定位の広がり / `level`

**追憶 tsuioku** — `source` 1=ファイル 0=ライブ入力 / `ingain` / `recall` 想起の頻度 / `span` どこまで遡るか / `loop` 想起ループの長さ ms /
`rev` 逆行の確率 / `varispeed` 速度の揺れ（ときどきオクターブ跳び）/ `wow` うねり / `feedback` 再録量 / `erode` 風化（暗く・歪み・ヒス）/
`freeze` 書き込み停止 / `dry` 原音 / `level`

**切貼 kiri** — `bpm` / `slices` 切片数 / `steps` ステップ数 / `order` 0=元の並び 1=シャッフル / `mutate` 1 周ごとの変異率 /
`rest` 休符 / `rev` 逆再生 / `pitch` 五音の音程 / `ratchet` 連打 / `gatelen` 音の長さ / `swing` / `reroll` 全体を書き直す / `level`

## 検証について

GenExpr のコードは `tools/genexpr.mjs` で JavaScript に変換し、`node tools/test.mjs` でオフライン試験しています
（NaN が出ない・音量が暴れない・各イベントが実際に起きる・クリックしない、など 66 項目）。
この環境には Max が無いため、パッチを Max で実際に開いての確認はしていません。開いたときにエラーが出たら、
Max コンソールの文面を教えてください。

パッチは `python3 tools/make_patches.py` で再生成できます（パッチコードの接続先は自動で検査されます）。

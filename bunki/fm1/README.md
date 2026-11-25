# BUNKI を FM-1 に入れる

`bunki.dock` が FM-1 に入れるファイルです(fm1-dock のモジュール、22 KB)。
M-VAVE のファームウェアを置き換えるのではなく、fm1-dock の上に追加する 1 つのシンセです。

![fm1-emu(fm1-dock 0.9)の中の BUNKI:HOLD・GATE・EVOLVE。上が各サイン波の音程の軌跡、中が分岐図](emu_panel.png)

## 入れ方

1. **FM-1 に fm1-dock がまだ入っていなければ**:パソコンの Chrome か Edge で
   <https://joakimeriksson.github.io/fm1-dock/#install> を開き、FM-1 を USB の**データ**ケーブルでつないで
   **Connect over USB** → **Install fm1-dock**。ここで本体のファームウェアが fm1-dock に替わる
   (元に戻す方法は下)。ファームウェアの書き換えは自己責任。
2. 同じページの **console**(<https://joakimeriksson.github.io/fm1-dock/#console>)の **Deploy a module** で
   `bunki.dock` を選ぶ。数秒で入り、そのまま BUNKI が立ち上がる。
   ターミナルからなら下の `deploy.sh`。
3. 次からは **HOME を押して BUNKI を選ぶ**。

### ターミナルから(FM-1 を USB でつないで)

git も Xcode も要らない手順(Mac の zsh にそのまま貼れるよう、コメント行なし)。
python-rtmidi と mido は先に `pip3 install mido python-rtmidi`。

```sh
cd ~/Downloads
curl -L -o fm1-dock.zip https://github.com/joakimeriksson/fm1-dock/archive/60a89df6554f6df3823f03a4c893b6715bfef9b5.zip
unzip -q -o fm1-dock.zip
curl -L -o bunki.dock https://raw.githubusercontent.com/4j8nfjnzdb-a11y/-/refs/heads/claude/adoring-pascal-lwrjgv/bunki/fm1/bunki.dock
cd fm1-dock-60a89df6554f6df3823f03a4c893b6715bfef9b5
python3 tools/dock.py info
```

`info` に FM-1 のビルドや空きが出れば fm1-dock が入っている。そのまま:

```sh
python3 tools/dock.py deploy ~/Downloads/bunki.dock
```

`info` が答えない(純正のファームウェアのまま)なら、先に fm1-dock を入れる(本体のファームウェアが置き換わる。
書き込む前に確認が出る。いまの最新リリースは v0.9.0):

```sh
curl -L -o ~/Downloads/fm1-dock-0.9.0.fwsc https://github.com/joakimeriksson/fm1-dock/releases/download/v0.9.0/fm1-dock-0.9.0.fwsc
python3 tools/fm1_install.py ~/Downloads/fm1-dock-0.9.0.fwsc
python3 tools/dock.py info
python3 tools/dock.py deploy ~/Downloads/bunki.dock
```

外す:`python3 tools/dock.py delete BUNKI`。落ちたときの記録:`python3 tools/dock.py logs`。
FM-1 の MIDI ポートは名前(Felucca / FM1-DOCK / FM-1)で自動で見つかる。見つからないときは `--port 名前` を足す。
git がある環境なら `bunki/fm1/deploy.sh`(`check` / 引数なしで deploy / `delete` / `logs`)が同じことをする。

## 操作

1 つの鍵は **N 本のサイン波の網**。どのサイン波も自分のロジスティック写像を持ち、1 本の **ステップの時計**(RATE)で
いっせいに 1 歩ずつ進む。歩くたびに、写像の値で決まる音程へ弧を描いて滑る(GLIDE)。だから写像の数が音の形で聞こえる:
不動点では鍵の音程の純音、周期 2 は 2 音の往復、4 は 4 音の型、8 は 8 音の型、カオスでは戻ってこない線と、1 本が雲に裂ける
こと、窓では突然 3 音の型。

| | |
|---|---|
| 鍵盤 / MIDI | 最大 8 音。1 音だけ、R が低いうちは純音 |
| KNOB1 / SELECT | R(粗調 1/16 単位、速く回すと 2〜4 倍 / 微調 1/512 単位。1 単位 = 倍化 1 段) |
| KNOB2 | RATE:ステップの速さ 0.25〜64 回/秒(12 目盛りで 1 オクターブ)。遅いと長い弧、速いとアルペジオから音色へ |
| KNOB3 | ε:サイン波どうしの引き合い。0 でばらばら、0.3 前後で 2 群、0.4 前後で群が組み替わり続け、0.5 以上で 1 本 |
| KNOB4 | CENTS:1 歩で音程が動く幅(0〜2400) |
| ALGORITHM | N:1 音あたりのサイン波の本数(1〜8) |
| PRESETS | GLIDE:ステップの何割をかけて次の音程へ滑るか(0 で跳ぶ) |
| PLAY | **HOLD**:離した鍵も鳴り続ける(MIDI CC 64 でも) |
| ARP | **CHOP**:OFF → GATE(写像が不動点より上のとき鳴る:写像が刻むリズム)→ ARP(1 歩に 1 本、いちばん高いものだけ) |
| SEQ | **EVOLVE**:OFF → SLOW(約 3 分で登る)→ FAST(約 45 秒)。R が自分で分岐を登り、窓では長く留まり、R = 4 で崩れてノブの位置まで戻る |
| GLO | **TOPO**:誰が誰を引くか。1 音の中だけ → 全部(和音のサイン波どうしも)→ 輪(隣どうし) |
| EDIT | **FREEZE**:ステップの時計を止める(いまの音程のまま伸びる) |
| REC | **MUTATE**:全部のサイン波を少しだけ揺らす。周期の中では元に戻り、カオスの中では別の道に入る |
| FX | **TIMBRE**:写像を基本周期ごとに回す FM の層(最初の版の音:周期倍がサブハーモニクスとして聞こえる)を重ねる |
| SEL | TIMBRE 層の LIN / SQRT |
| ENV / LFO | seed − / + |
| SAVE | いまの設定を保存(次に選んだときにその設定で始まる) |
| MIDI CC | 16 + 48 R(14 bit)、17 RATE、18 ε、19 CENTS、20 N、21 GLIDE、64 HOLD、120 / 123 全音停止。fm1-dock の **KNOBS CC**(OPTIONS)が ON でも、CC 74 / 71 / 73 / 72 を KNOB1〜4 として受ける |

ボタンの LED が、ON になっているもの(HOLD / CHOP / EVOLVE / TOPO / FREEZE / TIMBRE)を示す。

画面:上が **各サイン波の音程の軌跡**(左から右へ 8 秒で一周、中央の線が鍵の音程、色はボイス)。中が分岐図(横軸は伸縮済み:
上の目盛りが倍化点、赤い縦線が今鳴っている R、点線が手の R、白い点がサイン波の写像の今の値)。いちばん上の行は ON になって
いるもの。下の 2 行:

- `R 3.5441  P 8 2.00s  C 2`:R、型の長さ(ステップ数と秒数、`~` は周期なし、`..` は計測中)、群の数(写像の値が 0.01 以内のもの)
- `N4 4.0Hz 700c E38 L-0.12`:N、RATE、CENTS、ばらつき(写像の値の 8 区分エントロピー、0〜99)、Lyapunov 指数

## 元に戻す

- **BUNKI だけ外す**:console のモジュール一覧から削除、または `tools/dock.py delete BUNKI`。他は何も変わらない。
- **BUNKI が落ちたら**:fm1-dock は SINE に戻る。2 回落ちたモジュールは、次に選ぶまで起動時に飛ばされる。
  `tools/dock.py logs` に記録が残る。
- **M-VAVE 純正のファームウェアに戻す**:<https://fm1.designburgapps.com>(FM-1 Firmware Hub)を Chrome / Edge で開き、
  純正を入れる。fm1-dock は Hub の更新を受け付ける。
- **起動しなくなったら**:**OCT− を押しながら電源を入れる**と USB レスキューで立ち上がり、そこから入れ直せる。
  それも駄目なら [FM-1-transporter](https://github.com/kurogedelic/FM-1-transporter)(チップの ROM の更新機能を使う)。

## 確かめたこと(fm1-emu の中、fm1-dock 0.9.0 のリリースパッケージの上で)

- 配置 → 起動 → MIDI とパネルで操作。落ちず、ブロックの遅れ 0 件。
- 音声処理の負荷(1 ブロック 5.8 ms のうち、エミュレータの命令数):1 音・4 本 6.4 %、3 音・4 本 11.9 %、
  8 音・8 本・全部結合・64 回/秒 42.0 %、それに TIMBRE 層と C8 までの高音を重ねた最悪 51.4 %
  (fm1-dock の目安は半分以下。最悪の組み合わせだけ少し超える)。第 2 コアは使っていない。
- 8 音 × 8 本でもクリップしない。
- 「ノブ R を回しても音が変わらない」の切り分け(`bunki_dbg/`、ログを出す版):ノブのイベントは全部届く(15 / 15、284 / 284)、
  u → R の換算は正しい(0.5 → 2.8000、1.4375 → 3.1966、18.25 → 3.8991)、写像は R で変わる(2.8 で 0.6429 の連続、3.2 で
  0.5143 / 0.7985 の交互、3.9 で不規則)、インデックスは鳴っているボイスに毎周期書かれている、インデックスを最大に固定すると
  音が変わる(第 2 倍音 −109 → −17 dB)。断線はなかった。実機で変わらなかったとすれば、(1) OPTIONS > KNOBS CC が ON
  (ノブが CC になってモジュールに来ない:今は CC でも受ける)、(2) 最初の版の音は R 3.0 まで純音のままで、周期 2 の
  サブハーモニクス(C4 なら 131 Hz)は FM-1 の小さなスピーカーではほとんど鳴らない。今の版は、写像の周期を音程の型として出す。
- 実機用コンパイラ(JieLi clang)の出力がデスクトップと同じ軌道をたどること:R = 4 で 3 秒間、エミュレータとデスクトップの
  音の相関 0.998(最初の版で確認)。モジュールの経路(スロットとキュー)がエンジンと同じビットを出すこと:`sim/` の偽ホスト
  で、ボタンとノブを一通り使う演奏を台本に変換し、ハッシュが一致。

**まだ確かめていないこと**:実機の FM-1、fm1-dock 1.0、SMK-37。エミュレータは 1 命令 = 1 サイクルで数えるので、実機では
フラッシュから実行するコードのキャッシュミスの分、負荷が上がりうる(最悪の組み合わせは要注意)。

## ビルドし直す

```sh
bunki/fm1/build.sh        # fm1-dock(固定したリビジョン)を取得し、JieLi のツールチェーンで bunki.dock を作る
```

`sim/sim.c` はデスクトップで fm1-dock のふりをする偽ホスト(`make -C bunki fm1sim`)。
`bunki_dbg/` はログを出す版(BUNKIDBG):EDIT でノブ・u・R・インデックス・写像の直近 20 個を `tools/dock.py logs` に出し、
GLO で写像を外してインデックスを最大に固定する。音が変わらないときの切り分け用。

ライセンス:このディレクトリ(`fm1/`)は fm1-dock の `hb_module.h` を使うので GPL-3.0-only。エンジン(`core/`)は別。

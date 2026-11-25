# BUNKI を FM-1 に入れる

`bunki.dock` が FM-1 に入れるファイルです(fm1-dock のモジュール、14 KB)。
M-VAVE のファームウェアを置き換えるのではなく、fm1-dock の上に追加する 1 つのシンセです。

![fm1-emu の中の BUNKI:8 音が周期 5 の窓にいる](emu_panel.png)

## 入れ方

1. **FM-1 に fm1-dock がまだ入っていなければ**:パソコンの Chrome か Edge で
   <https://joakimeriksson.github.io/fm1-dock/#install> を開き、FM-1 を USB の**データ**ケーブルでつないで
   **Connect over USB** → **Install fm1-dock**。ここで本体のファームウェアが fm1-dock に替わる
   (元に戻す方法は下)。ファームウェアの書き換えは自己責任。
2. 同じページの **console**(<https://joakimeriksson.github.io/fm1-dock/#console>)の **Deploy a module** で
   `bunki.dock` を選ぶ。数秒で入り、そのまま BUNKI が立ち上がる。
   コマンドなら fm1-dock のリポジトリで `tools/dock.py deploy bunki.dock`(python-rtmidi が要る)。
3. 次からは **HOME を押して BUNKI を選ぶ**。

## 操作

| | |
|---|---|
| 鍵盤 / MIDI | 最大 8 音。1 音だけなら最初は純音 |
| KNOB1 | R(粗調。1 目盛り 1/16 単位、速く回すと 2〜4 倍。1 単位 = 倍化 1 段) |
| SELECT | R(微調、1/512 単位) |
| KNOB2 | D:R が自分で歩く(0 で手の R のまま) |
| KNOB3 | ε:ボイス同士の結合 |
| KNOB4 | C:2 経路の協調(+)/ 競合(−)。経路 BOTH のとき |
| ALGORITHM | 経路:MAP / FB-T(1 周期遅れフィードバック)/ BOTH / FB-1(DX7 型、比較用) |
| PRESETS | インデックスの深さ |
| SEL | LIN / SQRT(深い段を持ち上げる) |
| FX | モジュレータの比 1 / 2 / 3 |
| ENV / LFO | seed − / + |
| SAVE | いまの設定を保存(次に選んだときにその設定で始まる) |
| MIDI CC 16 + 48 | R を 14 bit で(0..16383 → u 0..22)。CC 17 D、18 ε、19 C、120 / 123 全音停止 |

画面:分岐図(横軸は伸縮済み:上の目盛りが倍化点)、赤い縦線が今鳴っている R、点線が手の R(D を上げると離れる)、
各ボイスの直近 64 点、下の帯が R の歩いた跡。下段の文字は `R 値  P 各ボイスの周期`(`~` は周期なし、`.` は計測中)と
`L Lyapunov 指数  D  E(ε)  C`。

## 元に戻す

- **BUNKI だけ外す**:console のモジュール一覧から削除、または `tools/dock.py delete BUNKI`。他は何も変わらない。
- **BUNKI が落ちたら**:fm1-dock は SINE に戻る。2 回落ちたモジュールは、次に選ぶまで起動時に飛ばされる。
  `tools/dock.py logs` に記録が残る。
- **M-VAVE 純正のファームウェアに戻す**:<https://fm1.designburgapps.com>(FM-1 Firmware Hub)を Chrome / Edge で開き、
  純正を入れる。fm1-dock は Hub の更新を受け付ける。
- **起動しなくなったら**:**OCT− を押しながら電源を入れる**と USB レスキューで立ち上がり、そこから入れ直せる。
  それも駄目なら [FM-1-transporter](https://github.com/kurogedelic/FM-1-transporter)(チップの ROM の更新機能を使う)。

## 確かめたこと(fm1-emu、fm1-dock 0.7 のパッケージの上で)

- 配置 → 起動(`bunki: ready`)→ MIDI で発音。落ちず、ブロックの遅れ 0 件。
- 音声処理の負荷(1 ブロック 5.8 ms のうち):1 音 4.4 %、8 音・MAP・中音域 12.6 %、
  8 音・BOTH・カオス・C8 までの高音(最悪)45.7 %。fm1-dock の目安(半分以下)に収まる。第 2 コアは使っていない。
- 8 音の和音でもクリップしない(ピーク 7665 / 16384)。
- 実機用コンパイラ(JieLi clang)の出力がデスクトップと同じ軌道をたどること:R = 4(λ = ln 2、1 ビットの差が約 0.25 秒で
  全体に広がる)で 3 秒間、エミュレータの音とデスクトップの音の相関 0.998(残りは本体の音量処理の丸め)。
- モジュールの経路(キューとスロット)がエンジンと同じビットを出すこと:`sim/` の偽ホストで同じ操作をデスクトップの台本に
  変換し、ハッシュが一致。

**まだ確かめていないこと**:実機の FM-1、fm1-dock 1.0(この環境ではビルドに要る JieLi AC79 SDK を取れなかったので、
リポジトリにある 0.7 のパッケージで試した。モジュールの ABI は同じ 2)、SMK-37。
エミュレータは 1 命令 = 1 サイクルで数えるので、実機ではフラッシュから実行するコードのキャッシュミスの分、負荷が上がりうる。

## ビルドし直す

```sh
bunki/fm1/build.sh        # fm1-dock(固定したリビジョン)を取得し、JieLi のツールチェーンで bunki.dock を作る
```

`sim/sim.c` はデスクトップで fm1-dock のふりをする偽ホスト(`make -C bunki fm1sim`)。

ライセンス:このディレクトリ(`fm1/`)は fm1-dock の `hb_module.h` を使うので GPL-3.0-only。エンジン(`core/`)は別。

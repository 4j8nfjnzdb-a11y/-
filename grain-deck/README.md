# GrainDeck

Ina GRM の *GRM Tools Atelier* に含まれる **grmplay**（複数の再生ヘッド（カーソル）を持つグラニュラー・サンプラー）から着想を得た、ブラウザだけで動く実験用グラニュラーシンセです。Web Audio API のみで実装しており、ビルド不要でそのまま動きます。

## 元アプリの調査メモ

- GRM Tools Atelier は Ina GRM（Pierre Schaeffer が設立した GRM を母体とする組織）が 2025年10月に発表したモジュール型サウンド環境。
- 内蔵モジュールの一つ `grmplay` は「仮想テープレコーダー」のようにオーディオを取り込み、**最大8個の再生ヘッド（カーソル）を同時に走らせて**再生できるサンプラー。
- 各カーソルは Position / Duration / Mix / Fade / Slant / Spread / Ease / Declick / Gain といったエンベロープ・パラメータを持ち、ボーカルなどの素材からポリフォニックでドローン的な質感を作る。

参考: [Sounding Future](https://soundingfuture.com/tools/grm-tools-atelier) / [KVR Audio](https://www.kvraudio.com/product/grm-tools-atelier-by-ina-grm) / [Sound on Sound](https://www.soundonsound.com/reviews/grm-tools-atelier)

本アプリはこの「複数カーソル＋エンベロープ制御によるグラニュラー再生」という機能コンセプトを元に、独自のUI/実装として一から作成したものです（GRM Tools のブランドやビジュアルデザインの複製ではありません）。

## 機能

- オーディオファイルのドラッグ＆ドロップ / ファイル選択で読み込み
- マイクからの録音（`REC`ボタン）でその場でバッファに取り込み
- 最大8個の独立したグラニュラー再生カーソル（追加・削除・有効/無効切替）
- カーソルごとのパラメータ: `Position` `Duration` `Mix` `Fade` `Spread` `Slant` `Gain` `Ease` `Declick` `Density`
- 波形上をドラッグしてカーソル位置をスクラブ
- `Scan` トグルでテープ走行のように位置を自動スイープ
- `Export` ボタンで出力をWebMファイルとして書き出し
- グリッドスナップ、スペースキーでの再生/停止

## 使い方

ブラウザのセキュリティ制約（マイク利用など）のため、`file://` ではなくローカルサーバー経由での起動を推奨します。

```bash
cd grain-deck
python3 -m http.server 8000
# ブラウザで http://localhost:8000 を開く
```

1. 波形エリアに音声ファイルをドラッグ＆ドロップ、または `REC` でマイク録音
2. `＋` でカーソルを追加し、下部の数字タブで選択したカーソルのパラメータを調整
3. 波形をドラッグしてカーソルの再生位置を変更
4. `▶` で再生。複数カーソルが同時に鳴り、ドローン/グラニュラーな質感が得られます

## 実装メモ（グラニュラーエンジン）

- ルックアヘッド方式のスケジューラ（25ms間隔、150ms先まで先読みしてグレインをスケジュール）で `AudioBufferSourceNode` を短時間だけ再生
- 各グレインのエンベロープは `Fade`（フェード量）・`Slant`（アタック/リリースの配分）・`Ease`（カーブ形状）・`Declick`（最低フェード量の下限）から `GainNode.gain.setValueCurveAtTime` 用のカーブを都度計算
- `Density` がグレイン同士のオーバーラップ量（発音間隔）を決定
- `Spread` はグレイン発音位置のランダムジッター量

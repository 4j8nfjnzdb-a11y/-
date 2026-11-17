# 結び目 musubime

M-VAVE FM-1 のための、8 つの別々の実験ファームウェアです（1〜6 は全部入りの 1 つにもまとめてある。流転と連動は単独）。C で書いてあり、[fm1-base](https://github.com/charlesvestal/fm1-base) の上で動きます。

どれも、ほぼ一本のサイン波というシンプルな位置から始まります。そこから数学の規則と手の動き（つまみを回す速さ、向きを変える回数、止まっている時間、急に動き出す瞬間、鍵の押し込み）によって、非線形に複雑なほうへ動いていきます。

| | 名前 | 方法 |
| --- | --- | --- |
| 1 | 崩し KUZUSHI | 音の数値を直接崩し（UNDERFLOW の発展）、壊れた出力を FM キャリアの位相へ戻す。崩す元は FM のペアか、キック・スネア・ハット・シンセの声 |
| 2 | 変化 HENKA | Digitakt 的なロック・条件・ポリメーターを、4 つの FM の声（キック・スネア・ハット・シンセ）の中身の数に当てる。抜き差しでき、XMOD で互いに FM 変調する |
| 3 | 線 SEN | 近藤譲「線の音楽」: 一音ずつ。一周に一か所だけ変わり、戻らない（ファイゲンバウム点のロジスティック写像、無理数の回転） |
| 4 | フェルドマン FELDMAN | ほぼ同じだが同じにならない。3 層のずれ、1/f のアブラッシュ、戻らない crippling。小さく静か |
| 5 | PMVRS | 佐藤允彦の P / M / V / R / S: 5 種類の時間を混ぜずに切り替える |
| 6 | 適応 TEKIOU | 自分の音を聴いて自分の配線を変える（恒常性と Ashby の超安定性） |

- 設計、出典、未確認のこと、批判と穴: [docs/DESIGN.md](docs/DESIGN.md)
- FM-1 への入れ方、戻し方、壊れたとき: [docs/INSTALL.md](docs/INSTALL.md)

## 試す

- **ブラウザ**: `index.html` を開いて「音を出す」を押します。FM-1 用の C をそのまま WebAssembly にしたもので、画面も同じ C が描いています。
- **fm1-base のシミュレーター**: `fm1/assemble.sh kuzushi host ~/fm1-base`（ツールチェーン不要）
- **FM-1**: `fm1/assemble.sh kuzushi fwsc ~/fm1-base` で `.fwsc` を作り、`fm1_install.py` で入れます（INSTALL.md）

## 中身

```
src/            共通の C（FM-1 とブラウザで同じ）: m.h（libm なしの数学）、shell.c（耳を守る、手の録音、画面）、
                body.c（身体）、scr.c（ピクセルフォント）、fm.h、fmvox.h（FM の声）、e1〜e6（プロジェクト）
fm1/            fm1-base とのつなぎ（app.c）、設定のひな形、assemble.sh、シミュレーターのテスト
web/            ブラウザのプレビュー: hw_web.c、worklet.js、page.html、build.sh（clang で wasm32）
tools/          ネイティブのレンダラー（render.c）とその台本、フォント生成
app.html        プレビュー（このリポジトリのほかのアプリと同じ形）、index.html はそれを包んだもの
```

## 状態

| | |
| --- | --- |
| 6 つすべてが fm1-base のホストシミュレーターでビルドされ、テストに通る | 確認済み |
| ブラウザのプレビュー（Chromium、file:// と http://） | 確認済み |
| 実機用 `.fwsc` のビルド、実機での負荷とインストール | 未確認（INSTALL.md の 1） |
| USB オーディオを崩す元にする | fm1-base では未対応（INSTALL.md の 7） |

# FM-1 に入れる方法

musubime の 6 つのプロジェクトは、それぞれ独立した FM-1 用ファームウェアとして **fm1-base**（Charles Vestal、MPL-2.0）の上に書いてあります。ここでは、Mac でビルドして FM-1 に入れるまでと、戻し方・壊れたときの戻し方をまとめます。

調べた範囲は 2026 年 11 月時点の公開リポジトリと記事です（末尾の出典）。**確認済み**と**未確認**を分けて書きます。

## いちばん簡単な入れ方（Mac、ターミナルに 1 行）

FM-1 を USB でつないで電源を入れ、音楽アプリを閉じてから、ターミナルに次の 1 行を貼って return:

```
curl -fsSL https://raw.githubusercontent.com/4j8nfjnzdb-a11y/-/refs/heads/claude/eloquent-mendel-xx2vgi/musubime/install-mac.sh | bash
```

`install-mac.sh` が道具の確認と準備、ファイルのダウンロード（GitHub の prerelease「musubime-latest」と公式 V15）、FM-1 の今のバージョンの読み取りをして、公式 V16 や FM1 Open なら先に V15 に戻し、それから **6 つ全部入り（musubime）** を書き込みます。書き込みの前には毎回 y / n を聞きます。1 つだけ入れるときは最後に ` -s kuzushi` のように名前を付けます。

全部入りでは、HOME を押さえている間に 6 つが画面に並びます。SELECT を回すか白鍵 1〜6 を押し、HOME を離すとそこへ移ります（白鍵 7 は今のものを最初から）。それぞれ離れた所から続きます。画面右下の C は音の計算の負荷（%）、X は音が間に合わなかった回数です。

## まとめ: 入れるデータと手順

- **入れるデータ**: 全部入りの `musubime.fwsc`、またはプロジェクトごとの `.fwsc`（`kuzushi.fwsc`、`henka.fwsc` など）。FM-1 のファームウェア一式で、USB-MIDI で書き込みます。FM-1 に入るファームウェアは一度に 1 つなので、6 つを切り替えて使うなら全部入りを入れます。音源（28 種類の FM の音色とスロット）はファームウェアの中に入っているので、別のファイルは要りません。
- **手に入れ方**: リポジトリの Actions の「musubime firmware」が、`musubime/` を変えて push するたびに 6 つの `.fwsc` を作ります。実行結果のページの下の Artifacts にある **musubime-fwsc**（zip）をダウンロードして解凍します（GitHub へのログインが必要、90 日で消える）。自分でビルドするなら下の 2〜4。
- **入れ方**:
  1. 公式ファームを V15 にしておく
  2. FM-1 を USB でつなぎ、MIDI を使っているアプリを閉じる
  3. `python3 ~/fm1-base/tools/fm1_install.py kuzushi.fwsc`
  4. 1 分ほどで書き込まれ、FM-1 が再起動する
- **戻し方**: M-VAVE の M-UPGRADE で公式ファーム（V15 か V16）を入れ直す（下の 5）。

## 0. 先に知っておくこと

**フラッシュへの書き込みは自己責任です。** FM-1 のフラッシュは 1 バンクで、基板にデバッグ端子がありません（awesome-fm-1 の注意書き）。入れる前に「5. 戻し方」と「6. 動かなくなったとき」を読んでください。

- **公式ファームの V15 にしておく。** コミュニティのファームウェアの多くは V15 からの導入を前提にしています。V15 の `.fwsc` は M-VAVE の FM1 Open リポジトリにあります。
- **新しい個体のフラッシュチップ。** 2026 年秋以降の FM-1 には、Puya ではなく UC25HQ80 が載っているものがあります。Puya しか知らないファームウェアでは保存が RAM に残るだけになり、以後のインストールも拒みます。fm1-base は両方を許可しています（`device/fm1_flash_ok.h`: `0x856014`, `0xB36014`）。musubime はこれをそのまま使います。
- **ほかのアプリを閉じる。** FM-1 の MIDI ポートを使っているアプリ（DAW、エディタ）は、インストール前に終了してください。

## 1. いま確かめられていること

| 項目 | 状態 |
| --- | --- |
| 6 つすべてが fm1-base の**ホストシミュレーター**でビルド・動作し、各テスト（無音でない、-2.5 dBFS を超えない）に通る | 確認済み（この環境で） |
| 6 つすべてを同じ C から WebAssembly にしたブラウザのプレビュー | 確認済み（Chromium） |
| 実機用の `.fwsc` のビルド | 確認済み（GitHub Actions、JieLi のツールチェーンと AC79 SDK で 6 つとも。fm1-base の検査: double なし、アプリ約 100 KB / 581 KB、RAM 約 32 KB / 96 KB、プール約 102 KB / 336 KB） |
| 実機での CPU 負荷、鍵の圧力の感じ、画面の速さ | **未確認** |
| 実機へのインストール | **未確認** |

ホストシミュレーターは fm1-base の `plat.h` をそのまま実装しているので、API の使い方の誤りはここで出ます。ただし CPU の重さとタイミングは実機でしか分かりません。

## 2. 用意するもの（Mac）

1. **Docker Desktop**（起動しておく）。JieLi のツールチェーンは Linux x86-64 専用です。fm1-base の `tools/build.py` は、macOS では各ツールを `linux/amd64` コンテナの中で自動的に動かします（`JIELI_DOCKER`）。Apple Silicon ではエミュレーションになり、遅くなります。
2. **Python 3** と、インストーラー用の `mido` と `python-rtmidi`:
   ```sh
   python3 -m pip install mido python-rtmidi
   ```
3. **fm1-base**（felucca-bsp をサブモジュールとして含む）:
   ```sh
   git clone --recursive https://github.com/charlesvestal/fm1-base ~/fm1-base
   ```
4. **JieLi のツールチェーン**:
   ```sh
   ~/fm1-base/tools/get_toolchain.sh          # ~/.jieli/toolchain に展開
   export JIELI_TOOLCHAIN=~/.jieli/toolchain
   ```
   配布元は `pkgman.jieliapp.com` です（スクリプトに書かれている URL）。
5. **JieLi AC79 SDK のチェックアウト**。パッケージには、SDK 内の 3 つのファイル（`uboot.boot`、`cfg_tool.bin`、`eq_cfg_hw.bin`）が必要です。置き場所は `~/fw-AC79_AIoT_SDK`、または `export AC79_SDK=...` で指定します。fm1-base は `AC79NN_SDK_V1.2.1_2023-12-13` で確認されています（`build.py` の記述）。取得元は、コミュニティの共有ビルダー（zvenson/fm1-build）が使っている JieLi の gitee です:
   ```sh
   git clone --depth 1 --branch AC79NN_SDK_V1.2.1_2023-12-13 \
       https://gitee.com/Jieli-Tech/fw-AC79_AIoT_SDK.git ~/fw-AC79_AIoT_SDK
   ```

## 3. まずシミュレーターで（ツールチェーン不要）

```sh
cd musubime
fm1/assemble.sh kuzushi host ~/fm1-base     # あるいは all
```

`fm1/build/kuzushi/build/out/` に `boot.png`・`play.png`（画面）、`kuzushi.wav`（音）、テストの結果が出ます。

fm1-base は、アプリのディレクトリの中にあるソースしかコンパイルしません。そのため `assemble.sh` が、共通の C（`src/`）とプロジェクトを `fm1/build/<名前>/` に集めてから `build.py` を呼びます。

## 4. ビルドしてインストール

```sh
fm1/assemble.sh kuzushi fwsc ~/fm1-base
# -> fm1/build/kuzushi/build/kuzushi.fwsc

python3 ~/fm1-base/tools/fm1_install.py fm1/build/kuzushi/build/kuzushi.fwsc
```

- インストーラーは USB-MIDI の SysEx で更新します（公式の M-UPGRADE と同じ経路）。途中で切れても、もう一度実行すれば続きから書きます（`fm1_install.py` の説明）。
- ブラウザ（Chrome / Edge）から入れる場合は、fm1-base の `tools/make_site.py` でインストーラーページを作るか、The FM-1 Firmware Hub のような汎用インストーラーを使います。
- **ID（id_prefix）**: `fm1/fm1.toml.in` では `FM-1_61`〜`FM-1_66` を仮に使っています。人に配る前に、Firmware Hub の一覧と重ならない番号を選んでください（**未確認**: この 6 つが空いているかは確かめていません）。

プロジェクトは別々のファームウェアなので、切り替えるには入れ直します（1 分ほど）。前のプロジェクトの状態は残りません。

## 5. 戻し方

- **公式に戻す**: M-VAVE の M-UPGRADE（Windows / macOS）で公式ファーム（V16 または V15）を入れます。または fm1-base の `fm1_install.py` で、FM1 Open リポジトリの V15 `.fwsc` を入れます。
- **ほかのコミュニティのファームウェアへ**: 各インストーラーから、そのまま上書きできます（felucca-bsp の更新ローダーを積んでいるため）。

## 6. 動かなくなったとき

fm1-base 系のファームウェアは、起動に 2 回失敗すると USB が使える SAFE MODE を開き、4 回でチップ自身の更新モードに入ります（ECHOFIELD の README の説明。musubime はこの仕組みを fm1-base からそのまま受け継いでいますが、実機では試していません）。

それでも USB から見えなくなった場合（awesome-fm-1 の「Firmware update and recovery」より）:

- **M-Flasher**、**m-bootloader**（jvitkauskas）: チップのダウンロードモード経由で、壊れた個体にもバックアップ・復元・インストールができる。
- **MvaveFM1Unbricker**（Quixotic7）: 普通の USB ケーブルで、jl-uboot-tool を使って復旧する。先にフラッシュ全体をバックアップする。
- **FM-1 Transporter**（kurogedelic）: Seeed XIAO RP2040 を USB のデータ線につないで、Mac からフラッシュを読み書きする。
- **flipper-fm1-recovery**: Flipper Zero で ROM のリカバリーモードに入れる。
- **The Firmware Hub の rescue ページ / `fm1_rescue.py`**（Linux）。

## 7. 前提の訂正（依頼文の「FM-1 の条件」との違い）

| 依頼文 | 調べた結果 |
| --- | --- |
| つまみ 7 個 | 7 個とも**無限回転のエンコーダー**（1 クリックごとの相対値）。ポテンショメーターは MASTER だけ。速さや向きの変化は、クリックの時間間隔から読みます |
| 圧力を読める鍵 27 個 | 27 鍵のうち**圧力が読めるのは 20 鍵（F3〜C5）**。上の 7 鍵（C#5〜G5）はベロシティだけ（fm1-base `lib/touch.h`） |
| 128 フレーム単位 | ブロックの長さは**アプリが決める**（`APP_BLOCK`）。fm1-base の既定は 256 フレーム（5.8 ms）で、musubime もこれを使っています |
| RAM 約 512KB | アプリが使えるのは `.data` / `.bss` に 96 KB と、大きなバッファ用のプール 336 KB。フラッシュのアプリ領域は 581 KB（fm1-base README） |
| 単精度 FPU のみ（double なし） | 正しい（`-mfprev1`）。libm もリンクされないので、musubime は自前の数学（`src/m.h`）を使います。ビルドは double の混入を検査します。なお foma は「FPU なし・整数のみ」を自分の規則にしているので、musubime の C はそのままでは foma に載りません |
| スマホや Mac の録音を USB で流し込んで崩せる | **fm1-base では、まだできません。** コンピューターからの USB オーディオは、アプリの描画の**後で**ミックスされ、アプリはその音を読めません（`device/uac_mix.h`）。別の土台の foma（Felucca 系）には `audio_in()` があり、アプリに渡ります。fm1-base で同じことをするには、felucca-bsp の `uac_play` に手を入れて、リングバッファの中身をアプリへ渡す必要があります（**未確認・未実装**）。プレビューでは、ファイルとマイクを崩す元として試せます（崩し・適応） |
| Bluetooth で音を受け取る | fm1-base の Bluetooth オーディオは**出力**（ヘッドホンへ）だけ。受け取りは foma の `mvave` プラットフォーム（M-VAVE の SDK 上）にある `bt_audio_in()`（foma の README による。**未確認**） |
| Mac なら fm1-base、公式 FM1 Open は Windows のみ | 調べた範囲では、そのとおり。FM1 Open は、ワークベンチ（ブラウザ）は Mac でも使えるが、ビルドは Windows（記事による）。M-VAVE の音源部分はバイナリの SDK で、foma の説明では空きは約 46 KiB |

## 出典

- awesome-fm-1（全体の地図、復旧手段、V15 の場所、フラッシュチップの注意）: https://github.com/cicloid/awesome-fm-1
- fm1-base（README、DESIGN.md、`include/plat.h`、`tools/build.py`、`device/uac_mix.h`、`device/fm1_flash_ok.h`、`lib/touch.h`、template）: https://github.com/charlesvestal/fm1-base
- felucca-bsp（`chip/usb.c` の `uac_play`）: https://github.com/hugelton/felucca-bsp
- foma（`audio_in()`、整数のみの規則、mvave プラットフォーム）: https://github.com/konsumer/foma
- ECHOFIELD（fm1-base 系の安全策の説明）: https://github.com/Philip-Bos/echofield-fm1
- FM1 Open（公式）: https://github.com/m-vave/fm1_open 、記事 https://www.synthtopia.com/content/2026/10/20/m-vave-officially-opens-fm-1-firmware-to-developers-with-new-workbench-sdk/ 、https://synthanatomy.com/2026/10/m-vave-fm-1-open-the-green-light-for-custom-firmware-and-community-hacks.html
- Felucca: https://github.com/hugelton/Felucca
- fm1-build（共有ビルダー: ツールチェーンと SDK の取得元）: https://github.com/zvenson/fm1-build

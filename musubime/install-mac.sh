#!/bin/bash
# musubime: FM-1 に入れる（Mac）。ターミナルにこの 1 行を貼って return:
#   curl -fsSL https://raw.githubusercontent.com/4j8nfjnzdb-a11y/-/refs/heads/claude/eloquent-mendel-xx2vgi/musubime/install-mac.sh | bash
# 別のプロジェクトを入れるときは最後に名前を付ける: ... | bash -s kuzushi   (henka kuzushi sen feldman pmvrs tekiou)
#
# やること: 道具の確認と準備 -> ファイルのダウンロード -> FM-1 の今のバージョンを読む -> 公式 V15 でなければ先に V15 へ
# （公式の V16 や FM1 Open から直接は入れない、コミュニティの手順どおり）-> 選んだプロジェクトを書き込む。
# 書き込む前には必ず y / n を聞く。書き込みは fm1-base の fm1_install.py（書く前にファイルと機器を確かめる）。
set -u
NAME="${1:-henka}"
case "$NAME" in henka|kuzushi|sen|feldman|pmvrs|tekiou) ;; *) echo "名前は henka kuzushi sen feldman pmvrs tekiou のどれか"; exit 1 ;; esac
REL="https://github.com/4j8nfjnzdb-a11y/-/releases/download/musubime-latest"
V15_URL="https://github.com/m-vave/fm1_open/raw/main/sdk/firmware/FM-1_015.fwsc"
WORK="$HOME/musubime-fm1"
BASE="$WORK/fm1-base"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }
stop() { say "止めました: $*"; note "この画面の文字をそのままコピーして送ってください。"; exit 1; }
ask() { local a; printf '\n\033[1m%s\033[0m  y = はい / n = いいえ: ' "$1"; read -r a </dev/tty; [ "$a" = y ] || [ "$a" = Y ]; }
inst() { python3 "$BASE/tools/fm1_install.py" "$@"; }

# the identity the FM-1 answers (FM-1_016, FM-1_015, FM-1_6200 ...), or nothing
identity() {
  local out
  out=$(inst --info 2>&1)
  printf '%s\n' "$out" | sed -n 's/^\([A-Za-z0-9_-]*_[A-Za-z0-9_]*\)  \[.*/\1/p' | head -1
}

say "1/5 Mac の道具を確かめます"
if ! xcode-select -p >/dev/null 2>&1; then
  note "Apple の開発ツール（無料）が必要です。今から出る窓で「インストール」を押してください。"
  note "終わったら、もう一度同じ 1 行をターミナルに貼って return してください。"
  xcode-select --install >/dev/null 2>&1
  exit 0
fi
command -v python3 >/dev/null || stop "python3 が見つかりません"
if ! python3 -c 'import mido, rtmidi' 2>/dev/null; then
  note "USB-MIDI の部品（mido, python-rtmidi）を入れます…"
  python3 -m pip install --user --quiet mido python-rtmidi 2>/dev/null ||
    python3 -m pip install --user --quiet --break-system-packages mido python-rtmidi ||
    stop "部品を入れられませんでした"
fi
mkdir -p "$WORK"
if [ ! -f "$BASE/tools/fm1_install.py" ]; then
  note "書き込み用の道具（fm1-base）を取ってきます…"
  rm -rf "$BASE"
  git clone --quiet --recursive https://github.com/charlesvestal/fm1-base "$BASE" || stop "fm1-base を取ってこられませんでした"
fi
note "OK"

say "2/5 ファイルをダウンロードします（$NAME と、公式 V15）"
curl -fsSL -o "$WORK/$NAME.fwsc.part" "$REL/$NAME.fwsc" && mv "$WORK/$NAME.fwsc.part" "$WORK/$NAME.fwsc" ||
  stop "$NAME.fwsc をダウンロードできませんでした"
if [ ! -s "$WORK/FM-1_015.fwsc" ]; then
  curl -fsSL -o "$WORK/FM-1_015.fwsc.part" "$V15_URL" && mv "$WORK/FM-1_015.fwsc.part" "$WORK/FM-1_015.fwsc" ||
    stop "公式 V15 をダウンロードできませんでした"
fi
note "OK（保存先: $WORK）"

say "3/5 FM-1 を探します"
note "FM-1 を USB ケーブルで Mac につなぎ、電源を入れておいてください。"
note "DAW や音楽アプリ、MIDI を使うアプリは閉じてください。"
printf '  準備ができたら return を押してください'; read -r _ </dev/tty
ID=$(identity)
if [ -z "$ID" ]; then
  inst --info 2>&1 | sed 's/^/  /'
  stop "FM-1 が見つかりません（ケーブル・電源・ほかのアプリを確かめて、もう一度 1 行を貼ってください）"
fi
case "$ID" in
  FM-1_015) note "今の FM-1: 公式ファーム V15（このまま入れられます）"; NEED15=0 ;;
  FM-1_0[0-9][0-9]) note "今の FM-1: 公式ファーム V${ID#FM-1_0}"; NEED15=1 ;;
  FM1_*) note "今の FM-1: M-VAVE の FM1 Open（$ID）"; NEED15=1 ;;
  *) note "今の FM-1: コミュニティのファームウェア（$ID）。そのまま上書きできます"; NEED15=0 ;;
esac

if [ "$NEED15" = 1 ]; then
  say "4/5 先に公式ファームの V15 にします（約 1 分）"
  note "コミュニティのファームウェアは V15 から入れるのが決まりです。"
  note "書き込み中は USB を抜かないでください。"
  ask "V15 を書き込みますか？" || { say "やめました。何も書き込んでいません。"; exit 0; }
  inst --yes "$WORK/FM-1_015.fwsc" || stop "V15 の書き込みで止まりました"
  note "FM-1 の再起動を待っています…"
  for i in 1 2 3 4 5 6 7 8 9 10; do
    sleep 3
    ID=$(identity)
    [ "$ID" = "FM-1_015" ] && break
  done
  [ "$ID" = "FM-1_015" ] || stop "V15 になったことを確かめられませんでした（今の答え: ${ID:-なし}）"
  note "V15 になりました"
else
  say "4/5 V15 への切り替えは要りません"
fi

say "5/5 $NAME を書き込みます（約 1 分）"
note "書き込み中は USB を抜かないでください。"
ask "$NAME を書き込みますか？" || { say "やめました。FM-1 は今のままです。"; exit 0; }
inst --yes "$WORK/$NAME.fwsc" || stop "$NAME の書き込みで止まりました"
say "できました。FM-1 の画面に $(printf '%s' "$NAME" | tr a-z A-Z) と出ていれば成功です。"
note "公式に戻すとき: M-VAVE の M-UPGRADE で公式ファームを入れ直す。"
note "別のプロジェクトにするとき: 同じ 1 行の最後に「 -s kuzushi」のように名前を付ける。"

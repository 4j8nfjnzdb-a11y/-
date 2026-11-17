#!/bin/bash
# musubime: FM-1 に入れる（Mac）。ターミナルにこの 1 行を貼って return:
#   curl -fsSL https://raw.githubusercontent.com/4j8nfjnzdb-a11y/-/refs/heads/claude/eloquent-mendel-xx2vgi/musubime/install-mac.sh | bash
# 何も付けなければ 6 つ全部入り（musubime: HOME を押さえて選ぶ）。1 つだけ入れるときは最後に名前を付ける:
#   ... | bash -s kuzushi   (musubime henka kuzushi sen feldman pmvrs tekiou ruten rendo)
# 前の版を入れるときは、名前の後に版の名前（GitHub の Releases にある musubime-b番号-…）を付ける:
#   ... | bash -s ruten musubime-b12-fa1302b
#
# 要るもの: Python 3.12（python.org、数十 MB）。Apple の開発ツールも git も要らない。
# やること: 道具の確認と準備 -> ファイルのダウンロード -> FM-1 の今のバージョンを読む -> 公式 V15 でなければ先に V15 へ
# （公式の V16 や FM1 Open から直接は入れない、コミュニティの手順どおり）-> 選んだプロジェクトを書き込む。
# 書き込む前には必ず y / n を聞く。書き込みは fm1-base の fm1_install.py（書く前にファイルと機器を確かめる）。
set -u
NAME="${1:-musubime}"
case "${NAME}" in musubime|henka|kuzushi|sen|feldman|pmvrs|tekiou|ruten|rendo) ;;
  *) echo "名前は musubime henka kuzushi sen feldman pmvrs tekiou ruten rendo のどれか"; exit 1 ;; esac
VER="${2:-musubime-latest}"              # a kept version (Releases: musubime-bN-xxxxxxx), or the latest
case "${VER}" in musubime-*) ;; *) echo "版の名前は musubime- で始まります（例: musubime-b12-fa1302b）"; exit 1 ;; esac
REL="https://github.com/4j8nfjnzdb-a11y/-/releases/download/${VER}"
V15_URL="https://github.com/m-vave/fm1_open/raw/main/sdk/firmware/FM-1_015.fwsc"
WORK="${HOME}/musubime-fm1"
BASE="${WORK}/fm1-base"
FM1B=c8e05997ce970875038156d2bbd69e712eac1543   # the fm1-base commit the firmwares were built and tested with

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
note() { printf '  %s\n' "$*"; }
stop() { say "止めました: $*"; note "この画面の文字をそのままコピーして送ってください。"; exit 1; }
ask() { local a; printf '\n\033[1m%s\033[0m  y = はい / n = いいえ: ' "$1"; read -r a </dev/tty; [ "$a" = y ] || [ "$a" = Y ]; }

# the identity the FM-1 answers (FM-1_016, FM-1_015, FM-1_6200 ...), or nothing
identity() {
  local out
  out=$(inst --info 2>&1)
  printf '%s\n' "$out" | sed -n 's/^\([A-Za-z0-9_-]*_[A-Za-z0-9_]*\)  \[.*/\1/p' | head -1
}

say "1/5 Mac の道具を確かめます"
# Python 3.12 (python.org): the MIDI parts (python-rtmidi) come ready-made for it; Apple's developer tools are not
# needed (they ask for about 19 GB). Git is not needed either: fm1-base comes as a zip (curl and unzip are built in).
PY=""
for c in /Library/Frameworks/Python.framework/Versions/3.12/bin/python3.12 /usr/local/bin/python3.12 \
         /opt/homebrew/bin/python3.12 "$(command -v python3.12 2>/dev/null)"; do
  if [ -n "$c" ] && [ -x "$c" ]; then PY="$c"; break; fi
done
if [ -z "${PY}" ]; then
  note "Python 3.12（無料、数十 MB）が必要です。今からブラウザでダウンロードのページを開きます。"
  note "ページの下の方の「macOS 64-bit universal2 installer」を押してダウンロードし、"
  note "ダウンロードしたファイルを開いて「続ける」「同意する」「インストール」と進めてください。"
  note "（3.13 や 3.14 ではなく 3.12 を入れてください。MIDI の部品が 3.12 用しかありません）"
  note "終わったら、もう一度同じ 1 行をターミナルに貼って return してください。"
  open "https://www.python.org/downloads/release/python-31210/" 2>/dev/null
  exit 0
fi
inst() { "${PY}" "${BASE}/tools/fm1_install.py" "$@"; }
if ! "${PY}" -c 'import mido, rtmidi' 2>/dev/null; then
  note "USB-MIDI の部品（mido, python-rtmidi）を入れます…"
  "${PY}" -m pip install --user --quiet --only-binary=:all: mido python-rtmidi 2>/dev/null ||
    "${PY}" -m pip install --user --quiet --only-binary=:all: --break-system-packages mido python-rtmidi ||
    stop "部品を入れられませんでした"
fi
mkdir -p "${WORK}"
if [ ! -f "${BASE}/tools/fm1_install.py" ]; then
  note "書き込み用の道具（fm1-base）を取ってきます…"
  rm -rf "${BASE}" "${WORK}/fm1-base.zip" "${WORK}/fm1-base-${FM1B}"
  curl -fsSL -o "${WORK}/fm1-base.zip" "https://github.com/charlesvestal/fm1-base/archive/${FM1B}.zip" &&
    unzip -q "${WORK}/fm1-base.zip" -d "${WORK}" && mv "${WORK}/fm1-base-${FM1B}" "${BASE}" && rm -f "${WORK}/fm1-base.zip" ||
    stop "fm1-base を取ってこられませんでした"
fi
note "OK"

say "2/5 ファイルをダウンロードします（${NAME} と、公式 V15）"
curl -fsSL -o "${WORK}/${NAME}.fwsc.part" "${REL}/${NAME}.fwsc" && mv "${WORK}/${NAME}.fwsc.part" "${WORK}/${NAME}.fwsc" ||
  stop "${NAME}.fwsc をダウンロードできませんでした"
if [ ! -s "${WORK}/FM-1_015.fwsc" ]; then
  curl -fsSL -o "${WORK}/FM-1_015.fwsc.part" "${V15_URL}" && mv "${WORK}/FM-1_015.fwsc.part" "${WORK}/FM-1_015.fwsc" ||
    stop "公式 V15 をダウンロードできませんでした"
fi
note "OK（保存先: ${WORK}）"

say "3/5 FM-1 を探します"
note "FM-1 を USB ケーブルで Mac につなぎ、電源を入れておいてください。"
note "DAW や音楽アプリ、MIDI を使うアプリは閉じてください。"
printf '  準備ができたら return を押してください'; read -r _ </dev/tty
ID=$(identity)
if [ -z "${ID}" ]; then
  inst --info 2>&1 | sed 's/^/  /'
  stop "FM-1 が見つかりません（ケーブル・電源・ほかのアプリを確かめて、もう一度 1 行を貼ってください）"
fi
case "${ID}" in
  FM-1_015) note "今の FM-1: 公式ファーム V15（このまま入れられます）"; NEED15=0 ;;
  FM-1_0[0-9][0-9]) note "今の FM-1: 公式ファーム V${ID#FM-1_0}"; NEED15=1 ;;
  FM1_*) note "今の FM-1: M-VAVE の FM1 Open（${ID}）"; NEED15=1 ;;
  *) note "今の FM-1: コミュニティのファームウェア（${ID}）。そのまま上書きできます"; NEED15=0 ;;
esac

if [ "${NEED15}" = 1 ]; then
  say "4/5 先に公式ファームの V15 にします（約 1 分）"
  note "コミュニティのファームウェアは V15 から入れるのが決まりです。"
  note "書き込み中は USB を抜かないでください。"
  ask "V15 を書き込みますか？" || { say "やめました。何も書き込んでいません。"; exit 0; }
  inst --yes "${WORK}/FM-1_015.fwsc" || stop "V15 の書き込みで止まりました"
  note "FM-1 の再起動を待っています…"
  for i in 1 2 3 4 5 6 7 8 9 10; do
    sleep 3
    ID=$(identity)
    [ "${ID}" = "FM-1_015" ] && break
  done
  [ "${ID}" = "FM-1_015" ] || stop "V15 になったことを確かめられませんでした（今の答え: ${ID:-なし}）"
  note "V15 になりました"
else
  say "4/5 V15 への切り替えは要りません"
fi

say "5/5 ${NAME} を書き込みます（約 1 分）"
note "書き込み中は USB を抜かないでください。"
ask "${NAME} を書き込みますか？" || { say "やめました。FM-1 は今のままです。"; exit 0; }
inst --yes "${WORK}/${NAME}.fwsc" || stop "${NAME} の書き込みで止まりました"
if [ "${NAME}" = musubime ]; then
  say "できました。FM-1 の画面に KUZUSHI と出ていれば成功です（6 つ全部入り）。"
  note "ほかのものへ: HOME を押さえたまま SELECT を回す（か白鍵 1〜6 を押す）→ HOME を離す。"
  note "1 崩し  2 変化  3 線  4 フェルドマン  5 PMVRS  6 適応。白鍵 7 は今のものを最初から。"
else
  say "できました。FM-1 の画面に $(printf '%s' "${NAME}" | tr a-z A-Z) と出ていれば成功です。"
fi
note "公式に戻すとき: M-VAVE の M-UPGRADE で公式ファームを入れ直す。"
note "1 つだけ入れるとき: 同じ 1 行の最後に「 -s kuzushi」のように名前を付ける（何も付けなければ全部入り）。"

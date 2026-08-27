#!/bin/bash
# ダブルクリックで実行してください。
# このフォルダをローカルサーバーとして配信し、ブラウザを自動で開きます。
# 使い終わったら、開いたターミナルのウィンドウを閉じる(またはCtrl+C)でサーバーが止まります。

cd "$(dirname "$0")"

PORT=8000
URL="http://localhost:$PORT/index.html"

echo "=================================================="
echo " drift rack をローカルサーバーで起動します"
echo " URL: $URL"
echo " 終了するには、このウィンドウを閉じるかCtrl+Cを押してください"
echo "=================================================="
echo

# サーバー起動を少し待ってからブラウザを開く
( sleep 1 && open "$URL" ) &

PYTHON_BIN="python3"
if ! command -v python3 >/dev/null 2>&1; then
  PYTHON_BIN="python"
fi

"$PYTHON_BIN" -m http.server "$PORT"

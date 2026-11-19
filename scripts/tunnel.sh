#!/usr/bin/env bash
# 臨時公開網址（etunnel 匿名：每條連線最長 4 小時、1 Mbps；斷線重連時網址可能會變）。
# npm 上的 @easytunnel/et-sdk 1.7.x 漏打包 route.js；改用 scripts/etunnel/（1.7.20＋GitHub 的 route.js）。
# 每行加上台北時間戳記寫入 /tmp/et.log；最新網址寫入 /tmp/et-url.txt
cd /tmp
node /workspace/accusation/app/scripts/etunnel/etunnel.js ${PORT:-8787} 2>&1 | while IFS= read -r l; do
  ts=$(date '+%F %T')
  echo "$ts $l" >> /tmp/et.log
  case "$l" in TUNNEL_URL:*) echo "${l#TUNNEL_URL: } $ts" > /tmp/et-url.txt ;; esac
done

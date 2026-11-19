#!/usr/bin/env bash
# 啟動遊戲伺服器（崩潰自動重啟）
cd "$(dirname "$0")"
export PORT=${PORT:-8787}
while true; do node server.js >> /tmp/accusation.log 2>&1; echo "restart $(date)" >> /tmp/accusation.log; sleep 1; done

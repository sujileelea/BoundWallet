#!/usr/bin/env bash
# 판매자 3인스턴스 기동 — 같은 코드, 설정만 다름 (HANDOFF M5)
set -euo pipefail
cd "$(dirname "$0")/.."

trap 'kill 0' EXIT INT TERM
for id in seller_a seller_b seller_c; do
  SELLER_ID="$id" node seller/server.ts &
done
wait

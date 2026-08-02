#!/usr/bin/env bash
# 전체 스택 기동: policy(:5100) + seller×3(:4001~4003) + executor(:5200)
set -euo pipefail
cd "$(dirname "$0")/.."

trap 'kill 0' EXIT INT TERM
.venv/bin/python -m policy.service &
for id in seller_a seller_b seller_c; do
  SELLER_ID="$id" node seller/server.ts &
done
node executor/server.ts &
wait

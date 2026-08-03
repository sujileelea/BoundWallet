#!/usr/bin/env bash
# 커스텀 도메인 매핑: boundwallet.sigongan.com → web (Cloud Run).
# 선행: deploy.sh 로 web 배포 완료, sigongan.com 도메인 소유 확인(Search Console).
# 실행: bash deploy/domain-map.sh
#
# 주의: 도메인 소유 확인이 안 돼 있으면 먼저 아래로 확인 절차를 띄운다:
#   gcloud domains verify sigongan.com
# 매핑 생성 후 출력되는 DNS 레코드(CNAME 등)를 sigongan.com DNS에 추가해야 발급된다.
set -euo pipefail
PROJECT=boundwallet
REGION=us-central1
DOMAIN=boundwallet.sigongan.com

gcloud beta run domain-mappings create \
  --service=web \
  --domain="$DOMAIN" \
  --region="$REGION" \
  --project="$PROJECT"

echo
echo "아래 DNS 레코드를 sigongan.com DNS에 추가하세요 (위 출력의 rrdata 사용):"
gcloud beta run domain-mappings describe --domain="$DOMAIN" --region="$REGION" --project="$PROJECT" \
  --format='value(status.resourceRecords)'

#!/usr/bin/env bash
# BoundWallet Cloud Run 배포 (devnet 유지). 7개 서비스 — policy·seller×3·executor·agent·web.
# 선행: gcloud 인증(dev-team@sigongan.com), 프로젝트 boundwallet, executor 키 시크릿 등록.
#   executor 키 시크릿 최초 1회:
#     gcloud secrets create executor-keypair --data-file=executor/wallet/executor-keypair.json
# 실행: bash deploy/deploy.sh
set -euo pipefail
cd "$(dirname "$0")/.."

PROJECT=boundwallet
REGION=us-central1
REPO=boundwallet
REG="${REGION}-docker.pkg.dev/${PROJECT}/${REPO}"
COMMON="--region=${REGION} --project=${PROJECT} --allow-unauthenticated --platform=managed"

build() { # build <name> <dockerfile> [build_args]
  echo "▶ build $1"
  gcloud builds submit --project="$PROJECT" --config=deploy/cloudbuild.yaml \
    --substitutions=_DOCKERFILE="$2",_IMAGE="${REG}/$1:latest",_BUILD_ARGS="${3:-}" .
}
url() { gcloud run services describe "$1" --region="$REGION" --project="$PROJECT" --format='value(status.url)'; }

# 0. Artifact Registry 저장소 (최초 1회, 있으면 무시)
gcloud artifacts repositories create "$REPO" --repository-format=docker \
  --location="$REGION" --project="$PROJECT" 2>/dev/null || true

# 1. policy
build policy deploy/Dockerfile.policy
gcloud run deploy policy --image="${REG}/policy:latest" $COMMON

# 2. seller × 3 (같은 이미지, SELLER_ID·검증모드만 다름)
build seller deploy/Dockerfile.seller
for id in a b c; do
  gcloud run deploy "seller-$id" --image="${REG}/seller:latest" $COMMON \
    --set-env-vars="SELLER_ID=seller_$id,SELLER_VERIFY_MODE=onchain"
done
SELLER_A_URL=$(url seller-a); SELLER_B_URL=$(url seller-b); SELLER_C_URL=$(url seller-c)

# 3. executor (키는 Secret Manager, 판매자·정책 URL 주입)
build executor deploy/Dockerfile.executor
POLICY_URL=$(url policy)
gcloud run deploy executor --image="${REG}/executor:latest" $COMMON \
  --set-secrets="EXECUTOR_KEYPAIR=executor-keypair:latest" \
  --set-env-vars="POLICY_URL=${POLICY_URL},SELLER_A_URL=${SELLER_A_URL},SELLER_B_URL=${SELLER_B_URL},SELLER_C_URL=${SELLER_C_URL}"
EXECUTOR_URL=$(url executor)

# 4. agent (Vertex, executor URL 주입)
build agent deploy/Dockerfile.agent
gcloud run deploy agent --image="${REG}/agent:latest" $COMMON \
  --set-env-vars="EXECUTOR_URL=${EXECUTOR_URL},GOOGLE_CLOUD_PROJECT=${PROJECT},GOOGLE_CLOUD_LOCATION=${REGION},GEMINI_MODEL=gemini-2.5-flash"
AGENT_URL=$(url agent)

# 5. web (NEXT_PUBLIC_* 는 빌드 시 주입)
build web deploy/Dockerfile.web "--build-arg NEXT_PUBLIC_EXECUTOR_URL=${EXECUTOR_URL} --build-arg NEXT_PUBLIC_AGENT_URL=${AGENT_URL}"
gcloud run deploy web --image="${REG}/web:latest" $COMMON

echo
echo "배포 완료:"
echo "  policy   : ${POLICY_URL}"
echo "  seller a/b/c : ${SELLER_A_URL} / ${SELLER_B_URL} / ${SELLER_C_URL}"
echo "  executor : ${EXECUTOR_URL}"
echo "  agent    : ${AGENT_URL}"
echo "  web      : $(url web)"
echo
echo "커스텀 도메인 매핑(boundwallet.sigongan.com)은 deploy/domain-map.sh 참조."

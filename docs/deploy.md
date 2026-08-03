# Cloud Run 배포 기록

프로젝트 `boundwallet`, 리전 `us-central1`. 배포: `bash deploy/deploy.sh`.

## 라이브 URL (공개, 검증 완료)

| 서비스 | URL |
|---|---|
| **web (데모 UI)** | https://web-6fpgl7hhqq-uc.a.run.app |
| executor | https://executor-6fpgl7hhqq-uc.a.run.app |
| agent | https://agent-6fpgl7hhqq-uc.a.run.app |
| policy | https://policy-6fpgl7hhqq-uc.a.run.app |
| seller-a / b / c | https://seller-{a,b,c}-6fpgl7hhqq-uc.a.run.app |

## 실측 검증 (클라우드)

- 7개 서비스 공개 200 응답.
- executor가 클라우드 판매자 URL·정책 URL로 정상 배선 (`/catalog`).
- 온체인 위임 잔량 조회 정상, **AP2 mandate 검증 True**.
- **라이브 에이전트 시나리오 1: 클라우드에서 실제 devnet 결제 성공**
  (서명 `61V5gokc…`, 위임 잔량 38.95 → 38.45로 0.5 차감 확인).
- 시나리오 3: `seller_allowlist` BLOCK, 결제 0건.

## 구성 메모

- executor 키는 Secret Manager(`executor-keypair`)로 주입 — 이미지·git에 없음(R1).
- agent는 Vertex AI 사용(compute SA + `roles/aiplatform.user`), 키 없음.
- 상태·로그는 컨테이너 `/tmp`(인스턴스별). 데모용으로 충분하며, 영속화가 필요하면 Firestore로 교체(D7).
- 조직 정책 `iam.allowedPolicyMemberDomains`는 **boundwallet 프로젝트에 한해 `allowAll`로 예외** 적용됨
  (admin@sigongan.com이 설정). 이로써 `allUsers` 공개 invoker 바인딩이 가능해졌다.

## 커스텀 도메인 (boundwallet.sigongan.com) — owner 작업 필요

현재 `sigongan.com`이 이 계정으로 **소유 확인(verify)되어 있지 않아** 매핑이 거부된다
(`You currently have no verified domains`). 두 경로 중 하나를 택한다.

### 경로 A — Google 도메인 매핑 (정석)

1. owner가 소유 확인 실행 → 브라우저에서 Search Console 절차:
   ```
   gcloud domains verify sigongan.com
   ```
   안내되는 TXT 레코드를 Cloudflare DNS(sigongan.com)에 추가하고 확인 완료.
   ※ 확인은 매핑을 만들 계정(dev-team@sigongan.com)으로 해야 한다.
2. 확인 후 매핑 생성:
   ```
   bash deploy/domain-map.sh
   ```
3. 출력되는 레코드를 Cloudflare에 추가 (**DNS only / 회색 구름**, 프록시 끄기).
   인증서 발급까지 보통 15분~1시간.

### 경로 B — Cloudflare 프록시 (도메인 확인 불필요, 빠름)

Cloudflare 대시보드(sigongan.com)에서:
1. DNS: `CNAME  boundwallet  web-6fpgl7hhqq-uc.a.run.app` (**Proxied / 주황 구름**)
2. Rules → Origin Rules: 대상 `boundwallet.sigongan.com`,
   **Host Header Override = `web-6fpgl7hhqq-uc.a.run.app`**
   (이 설정이 없으면 Cloud Run이 Host를 인식하지 못해 404)

경로 B는 Google 소유 확인 없이 즉시 동작하며, TLS는 Cloudflare가 처리한다.

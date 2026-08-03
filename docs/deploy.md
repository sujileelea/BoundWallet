# Cloud Run 배포 기록

프로젝트 `boundwallet`, 리전 `us-central1`. 배포: `bash deploy/deploy.sh`.

## 라이브 URL (공개, 검증 완료)

| 서비스 | URL |
|---|---|
| **데모 UI (제출용)** | **https://boundwallet.sigongan.com** |
| web (Cloud Run 원본) | https://web-6fpgl7hhqq-uc.a.run.app |
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

## 커스텀 도메인: https://boundwallet.sigongan.com — **발급 완료·접속 확인(200)**

Google Cloud Run 도메인 매핑 방식으로 구성했다 (Cloudflare Host Header Override는 유료라 미사용).
DNS 반영 후 인증서 발급까지 약 45분 걸렸다.

구성 완료 상태:
- `dev-team@sigongan.com`으로 Search Console 도메인 소유 확인 (`gcloud domains verify sigongan.com`).
  ※ 확인 계정과 매핑 생성 계정이 같아야 한다. 다른 계정으로 확인했다면 Search Console
  설정 → 사용자 및 권한에서 해당 계정을 **소유자**로 추가해도 된다.
- 매핑 생성: `bash deploy/domain-map.sh` (또는 `gcloud beta run domain-mappings create`).
- Cloudflare DNS: `CNAME  boundwallet → ghs.googlehosted.com`, **DNS only(프록시 끔)**.
  프록시를 켜면 Google이 인증서를 발급하지 못한다.

TLS 인증서는 Google이 자동 발급하며 DNS 반영 후 보통 15분~1시간 걸린다.
상태 확인:
```
gcloud beta run domain-mappings describe --domain=boundwallet.sigongan.com \
  --region=us-central1 --project=boundwallet
```
`CertificateProvisioned=True`가 되면 접속 가능하다.

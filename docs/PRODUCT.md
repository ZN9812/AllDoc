# 제품화 계획과 목표

이 문서는 AllDoc 을 유료 서비스로 운영하기 위한 설계와 순서를 정리한 **계획**입니다. 아직 구현한 것은 없습니다.
LaTeX(논문) 편집 설계는 `docs/LATEX.md` 에 따로 있습니다. 구현이 진행되면 이 문서와 `docs/SPEC.md` 를 함께 고칩니다.

정해진 전제(2026-10 사용자 결정):
- 첫 고객은 **국내 개인**입니다(대학원생·연구자, 직장인·공무원).
- **사업자등록은 아직 없습니다.**
- LaTeX 컴파일은 **서버**에서 합니다.
- **AGPL-3.0 오픈소스를 유지**합니다. 코드는 공개하고 호스팅·AI 사용량·편의 기능으로 수익을 냅니다(Overleaf 와 같은 방식).
- **실시간 공동 편집은 첫 버전에서 뺍니다.**
- **문서 존재 증명(블록체인 시각 기록)과 종단간 암호화 서버 저장은 진행하지 않습니다**(2026-10 사용자 결정). 핵심 가치(AI 제안·LaTeX)를 키우지 않고, 암호화 저장은 AI·서버 컴파일과 부딪치기 때문입니다. 검토 기록은 `docs/TRUST.md` 에 있습니다.

"확인 필요"라고 적은 항목은 이 문서를 쓸 때 공식 자료로 확인하지 못한 것입니다. 법·세무 항목은 모두 전문가 확인이 필요합니다.

## 지금 상태 (코드에서 확인)

| 영역 | 현재 | 유료화에 걸리는 점 |
| --- | --- | --- |
| 로그인 | 구글 OAuth + 서버에 목록이 없는 서명 쿠키(`server/src/auth/session.ts`). 사용자 테이블 없음 | 탈퇴·차단해도 쿠키가 최대 30일 유효. 요금제를 붙일 곳이 없음 |
| 한도 | 전원 같은 `DAILY_AI_LIMIT`(기본 5). SQLite `usage(user_id, day, count)`(`server/src/quota.ts`) | 요금제별 한도 불가 |
| AI 호출 | `server/src/ai/anthropic.ts` 가 응답의 `usage`(토큰)와 실제 응답 모델을 버림. 프롬프트 캐싱 없음. 진짜 API 호출은 시험하지 않음 | 요청 1회 원가를 모름 |
| 문서 | 브라우저 IndexedDB 에만 저장. "서버는 문서를 저장하지 않습니다"(`docs/AI.md`) | 여러 기기·서버 컴파일과 충돌하는 약속 |
| 보안 헤더 | 사이트 전체에 엄격한 CSP·COOP(`server/src/app.ts` `CONTENT_SECURITY_POLICY`) | 결제창 스크립트·팝업이 막힘 |
| Word 엔진 | `@superdoc/docx-engine` 독점 라이선스. 상용 계약 없이는 평가·개발·시험만 허용, 경쟁 제품 조항(`THIRD_PARTY_NOTICES.md`) | 유료 운영 전에 계약하거나 Word 를 꺼야 함 |

## 결제부터 만들어야 하나?

결제는 필요하지만 **다음 작업은 아닙니다.** 결제를 켜려면 먼저 아래가 갖춰져야 합니다. 결제 기능을 먼저 만들어도 이것들이 끝날 때까지 켤 수 없습니다.

1. **사업자등록·통신판매업 신고·결제대행사(PG) 심사.** 심사는 사이트 이름·도메인·하단 사업자 정보·약관·환불정책을 봅니다(경험담 기준, 확인 필요).
2. **원가 실측.** 지금은 요청 1회 원가를 모릅니다. 아래는 **가정으로 한 계산**입니다(실측 아님).
   - Opus 5.5 의 값은 입력 $4, 출력 $20 / 100만 토큰입니다.
   - 입력 2만·출력 3천 토큰짜리 요청 1회: 0.08 + 0.06 = 약 $0.14
   - 하루 5회 × 30일: 사용자 1명에 월 약 $21
   - 그래서 "AI 무제한 월정액"은 성립하지 않습니다. 한도·크레딧·보내는 범위 조절이 필요합니다.
3. **계정과 요금제(권한) 모듈.** 결제는 이 위에 얹습니다.
4. **SuperDoc 결정.** 계약하거나, `VITE_DISABLE_DOCX=1` 빌드(한글·LaTeX·TXT/MD·PDF)로 유료 서비스를 엽니다.

**첫 유료 상품은 선불 이용권(30일·1년)을 권합니다.** 단건 결제라서 다음 짐이 줄어듭니다.
- 자동결제(빌링키) 별도 심사
- 갱신 예약과 결제 실패 재시도
- 정기결제 고지 의무

자동결제 구독은 상태 전이만 설계해 두고 나중에 켭니다.

## 목표

| 번호 | 목표 | 완료 기준 |
| --- | --- | --- |
| G1 | 합법적으로 돈을 받을 수 있음 | 사업자등록·통신판매업 번호를 하단에 표시, 약관·개인정보처리방침·환불정책 전문가 검토 완료, PG 승인, SuperDoc 결정 |
| G2 | 가격의 근거 | 진짜 호출 원장으로 기능별 p50/p95 원가표를 만듦. 베타 2–4주 자료로 가격을 정해 이 문서에 기록 |
| G3 | 한국어 논문을 쓸 수 있는 LaTeX | `docs/LATEX.md` 의 완료 기준 |
| G4 | 결제 | PG 시험 환경에서 구매 → 한도 상향 → 연장 → 만료 → 환불 → 원복을 확인. 중복·순서가 뒤바뀐 웹훅에도 상태가 맞음 |
| G5 | 운영 | 백업 복구 훈련 1회 기록, 전체 AI 비용 차단기, 남용 제한, 문의 창구 |

베타 인원·출시일·가격은 사용자가 정할 값이라 비워 둡니다.

## 마일스톤

| # | 내용 | 완료 기준(확인한 것만) |
| --- | --- | --- |
| M0 측정·결정 | ① AI 사용량 원장(아래 "계측". **구현함**, 진짜 호출로 쌓인 값은 아직 없음) ② 시스템 프롬프트 캐싱(**구현함**, `promptCache`. 진짜 호출로 캐시 적중은 아직 확인 못 함) ③ 진짜 Claude 호출 확인 ④ SuperDoc 문의(`legal@superdoc.dev`) ⑤ 이름·도메인 후보(상표 검색) ⑥ 병행: LaTeX 실험 E1·E3(`docs/LATEX.md`) | 원장에 토큰·원가가 쌓임. 같은 요청을 반복하면 `cache_read_input_tokens > 0`. 기능별 원가를 `docs/AI.md` 에 기록. E1 시간·이미지 크기 기록 |
| M1 계정·요금제(결제 없음) | 사용자 테이블, 세션 무효화, DB 마이그레이션, 요금제·권한 모듈, 탈퇴·파기, 관리자 CLI(수동 요금제 부여), 약관 동의, 백업, 전체 비용 차단기 | 탈퇴 후 옛 쿠키가 401(시험). 수동 부여로 한도가 오름(시험). 기존 종단 시험 통과(`DAILY_AI_LIMIT` 동작 유지). 복구 훈련 기록 |
| M2 LaTeX MVP(AI 없음) | `docs/LATEX.md` | 그 문서의 M2 기준 |
| M3 LaTeX AI | `docs/LATEX.md` | 그 문서의 M3 기준 |
| M4 비공개 베타·가격 | 무료 + 수동 Pro 로 운영, 원장 자료로 가격 결정. 사업자·통신판매업·PG 신청은 외부 일정이라 M2 부터 병행. 약관 법률 검토 | 가격 결정 기록, 하단 사업자 정보, PG 승인 |
| M5 결제 | 결제 제공자 인터페이스, 데모 제공자, 실제 제공자 하나. 이용권부터. 결제 화면, 경로별 보안 헤더, 관리자 화면 | G4 |
| M6 서버 저장 | 문서별로 골라서 서버에 저장, 여러 기기, 충돌 시 사본, 용량 한도, 전체 내보내기 | 두 브라우저 동기화 시험, 복구 훈련에 파일 포함 |
| M7 이후 | SyncTeX 위치 이동, 컴파일 중간 파일 재사용, 자동결제 구독, 공동 편집, Postgres(필요할 때), 컴파일 서버 분리 | 기능별 |

이 순서로 하는 이유:
- 측정 결과가 AI 가격과 컴파일 가격 모두의 근거가 됩니다.
- LaTeX 가 돈을 낼 이유(차별점)이므로 결제보다 먼저 만듭니다.
- 사업자·PG 절차는 외부 일정이라 미리 병행합니다.
- 컴파일 캐시용으로 만드는 파일 저장소(내용 해시)를 M6 서버 저장이 그대로 씁니다.

## 설계

### 계측 (M0, 가장 먼저)

> **구현 상태(2026-10)**: 원장·단가표·보고 명령을 넣었습니다(`server/src/ledger.ts`, `server/src/ai/pricing.ts`, `server/src/ledger-report.ts`, 사용법은 `docs/AI.md`). 응답 `id` 는 남기지 않습니다. 가짜 클라이언트로만 시험했으므로, `usage.iterations` 의 모양과 모델 이름은 진짜 호출로 확인해야 합니다. 프롬프트 캐싱(②)도 넣었고(`docs/AI.md` "프롬프트 캐싱"), 진짜 호출 확인(③)은 아직입니다.

- **응답에서 기록할 것**: `server/src/ai/anthropic.ts` 의 응답 형식(`ParsedMessage`)에 `id`·`model`·`usage` 를 추가하고, `ProviderResult`(`server/src/ai/types.ts`)로 넘깁니다.
  - 필드: `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`
  - 대체 모델(fallbacks)이 응답하면 맨 위 `usage` 는 마지막 시도만 담습니다. 시도별 값인 `usage.iterations` 를 합산합니다(`type: 'fallback_message'` 항목 포함).
  - 각 항목이 모델 이름을 담는지는 진짜 호출로 확인이 필요합니다.
- **거절과 데모**: 거절(refusal)도 과금될 수 있으므로 기록합니다. 데모 AI(`mock.ts`)는 모델 `mock`, 토큰 0 으로 기록합니다.
- **단가표**: `server/src/ai/pricing.ts` 에 날짜와 함께 둡니다. 원가는 정수 마이크로달러로 저장하고, 모르는 모델은 가장 비싼 단가로 계산하고 경고를 남깁니다.

  | 모델 | 입력 | 출력 | 캐시 읽기 | 캐시 쓰기 |
  | --- | --- | --- | --- | --- |
  | `claude-opus-5-5` | $4 | $20 | $0.20 | 입력 단가의 약 1.25배(5분 보관) |
  | `claude-sonnet-5-5` | $2 | $10 | $0.20 | 같은 배수 |
  | `claude-haiku-5-5` | $0.10 | $0.50 | — | — |

  - 단위는 100만 토큰당입니다. Haiku 5.5 는 프롬프트 10만 토큰 이하 기준이고, 넘으면 $0.50/$2.50 입니다.
  - 출처는 Anthropic 가격표(2026-10 기준)이고 출시 전에 다시 확인합니다.
- **원장**: 문서 글은 넣지 않습니다(`docs/AI.md` 의 약속 유지).

  ```sql
  CREATE TABLE ai_events (id INTEGER PRIMARY KEY, at INTEGER, day TEXT, user_id TEXT, plan_id TEXT,
    task TEXT, provider TEXT, model_requested TEXT, model_served TEXT, fallback INTEGER,
    input_tokens INTEGER, output_tokens INTEGER, cache_write_tokens INTEGER, cache_read_tokens INTEGER,
    cost_micro_usd INTEGER, doc_chars INTEGER, proposals INTEGER, dropped INTEGER, ms INTEGER, outcome TEXT);
  CREATE TABLE compile_events (id INTEGER PRIMARY KEY, at INTEGER, day TEXT, user_id TEXT, plan_id TEXT,
    engine TEXT, wall_ms INTEGER, outcome TEXT /* ok|error|timeout|oom|too_large|busy|cached */,
    project_bytes INTEGER, files INTEGER, uploaded_bytes INTEGER, pdf_bytes INTEGER, texlive TEXT);
  ```
- **프롬프트 캐싱**: 시스템 프롬프트를 `cache_control` 블록으로 보냅니다. 캐시가 되는 최소 길이가 있어서, 실제로 캐시되는지는 `cache_read_input_tokens` 로 확인합니다.
  - 문서 본문을 대화 기록 앞으로 옮기면 여러 번 묻는 동안 본문도 캐시됩니다.
  - 다만 제안을 적용하면 본문이 바뀌어 캐시가 깨지므로, 측정한 뒤 정합니다. 그래서 문서 캐시는 설정(`promptCache: "document"`)으로만 켜고 기본은 시스템 프롬프트만 캐시합니다.
- **원가 계산식**(Opus 5.5): `원가($) = (입력×4 + 캐시쓰기×5 + 캐시읽기×0.2 + 출력×20) / 1,000,000`
  - 출력에는 추론(thinking) 토큰이 포함됩니다.
  - 실측값이 나오면 `docs/AI.md` 에 기능별 p50/p95 로 적습니다.
- **모델·추론 강도**: 바꾸는 것은 사용자가 원가 자료를 본 뒤 정합니다. 작업별 설정 방법은 이미 있습니다(`docs/AI.md`).

### 계정과 세션 (M1)

- **세션**: 서명 쿠키 방식은 유지합니다. 쿠키에 `sv`(세션 버전)를 넣고, 요청마다 `users` 를 기본키로 1회 조회합니다.
  - 행이 없거나, 탈퇴했거나, 차단됐거나, `sv` 가 다르면 거부합니다.
  - "모든 기기에서 로그아웃"은 버전을 1 올립니다.
- **가입·로그인**: 로그인 콜백(`/api/auth/callback`)과 개발용 로그인에서 사용자 행을 upsert 합니다.
- **약관 동의**: `/api/me` 가 동의가 필요한지 알려 줍니다. 동의 전에는 AI·컴파일·결제가 `agreement_required` 를 돌려줍니다.
  - 동의 화면은 기존 `ConsentDialog`(`web/src/components/ConsentDialog.tsx`) 방식을 따릅니다.
  - 만 14세 이상 확인을 함께 받습니다.
- **로그인 끈 설치**: `AUTH_MODE=none` 은 지금처럼 익명·무제한입니다(자체 설치용).

```sql
CREATE TABLE users (
  id TEXT PRIMARY KEY,                    -- 'g:<sub>' | 'dev:<name>'
  email TEXT, name TEXT, created_at INTEGER NOT NULL, last_login_at INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'active',  -- active | banned
  role TEXT NOT NULL DEFAULT 'user',      -- user | admin
  session_version INTEGER NOT NULL DEFAULT 1,
  terms_version TEXT, privacy_version TEXT, agreed_at INTEGER, age14_confirmed INTEGER,
  deleted_at INTEGER);
```

새로 만들거나 고칠 곳: `server/src/auth/accounts.ts`(새로), `server/src/auth/session.ts`, `server/src/app.ts`(`userOf`, 콜백, `/api/account/*`), `shared/src/api.ts`(`MeResponseSchema`).

### DB 와 백업 (M1)

- **연결과 마이그레이션**: `server/src/db/index.ts` 가 연결 하나를 열고 번호 붙은 마이그레이션을 `PRAGMA user_version` 기준으로 돌립니다.
  - 1번 마이그레이션은 지금의 `usage` 테이블입니다.
  - `QuotaStore` 와 새 저장 모듈은 경로 대신 이 연결을 받습니다.
- **SQLite 유지**: 예상 규모의 쓰기 양은 작습니다. 예를 들어 1만 명 × 하루 20건이면 초당 2–3건입니다.
  - Postgres 로 옮기는 조건: 앱 서버가 여러 대가 될 때(메모리 잠금·대기열도 함께 옮겨야 함), 관리형 시점 복구가 필요할 때
  - SQL 은 저장 모듈 안에만 둡니다.
- **`node:sqlite` 위험**: Node 22 에서 아직 실험 기능입니다(서버를 `--disable-warning=ExperimentalWarning` 로 띄움). Node 버전을 고정하고, 올릴 때 시험합니다.
- **백업**: 하루 한 번 `VACUUM INTO` 로 스냅숏을 만들어 14개를 보관하고, 서버 밖으로 복사합니다(restic·rclone 등).
  - 결제를 받기 전에 복구 훈련을 한 번 합니다.
  - `docs/DEPLOY.md` 의 "백업"은 "잃어도 큰일은 아닙니다"라고 적혀 있는데, 결제가 생기면 사실이 아니므로 함께 고칩니다.

### 요금제와 권한 (M1)

- **위치**: 서버는 `server/src/billing/{plans,entitlements}.ts`, 화면과 공용 타입은 `shared/src/billing.ts` 에 둡니다.
- **요금제 파일**: `PLANS_CONFIG_PATH` JSON 파일로 읽고 zod 로 검사합니다(`config.ts` 의 AI 설정 파일과 같은 방식).
  - 파일이 없으면 `DAILY_AI_LIMIT` 로 만든 `free` 요금제 하나만 둡니다. 자체 설치와 종단 시험(`DAILY_AI_LIMIT=3`)이 그대로 돕니다.

```ts
PlanLimits = {
  aiRequestsPerDay: number | null, aiRequestsPerMonth: number | null,
  aiMaxDocChars: number,                    // MAX_DOC_CHARS 이하
  aiCostCapMicroUsdPerMonth: number | null, // 숨은 안전 상한(광고하지 않음)
  compileTimeoutSec: number, compilesPerDay: number | null, compileSecondsPerDay: number | null,
  projectMaxBytes: number, storageBytes: number, queuePriority: number,
}
Entitlements = { planId, source: 'anonymous' | 'default' | 'pass' | 'subscription' | 'override', limits, features, validUntil }
```

- **우선순위**: 관리자 수동 부여(베타 시험자) → 유효한 이용권·구독 → 기본 요금제 순서로 고릅니다.
- **사용 횟수**: `usage` 를 `counters(user_id, metric, period)` 로 넓힙니다.
  - `metric` 은 `ai_requests`·`compiles`·`compile_ms`, `period` 는 날짜 또는 월입니다.
  - 지금처럼 한 문장(`ON CONFLICT … WHERE … RETURNING`)으로 확인과 증가를 함께 합니다.
- **`/api/ai/propose` 순서**: 권한 조회 → 글자 상한 → 월 원가 상한 → 전체 하루 비용 차단기(`AI_DAILY_BUDGET_USD`, 넘으면 503) → 횟수 차감 → 호출 → 원장 기록
- **`/api/me`**: `plan`·`limits`·`usage` 를 더합니다. 기존 `quota` 는 남겨서 지금 화면이 그대로 돕니다.

### 결제 (M5)

- **제공자 연결부**: `server/src/billing/providers/{types,mock,…}.ts` 로 나눕니다. AI 연결부(`server/src/ai/providers.ts`)와 같은 구조입니다.
  - 기본값은 `BILLING_PROVIDER=off` 라서 자체 설치에는 영향이 없습니다.
  - 데모 제공자(`mock`)를 먼저 만들고, 실제 제공자는 하나만 붙입니다.

```ts
interface PaymentProvider {
  readonly id: 'mock' | 'toss' | 'portone' | 'paddle';
  createCheckout(i: { orderId; user; item: { planId; kind: 'pass30' | 'pass365' | 'monthly' }; amountKrw; successUrl; failUrl }): Promise<…>;
  confirm(i: { orderId; query }): Promise<PaymentRecord>;   // 금액을 서버에서 다시 대조
  fetchPayment(providerPaymentId: string): Promise<PaymentRecord>;
  refund(p: PaymentRecord, amountKrw: number, reason: string): Promise<RefundRecord>;
  chargeWithBillingKey?(…): Promise<PaymentRecord>;            // 자동결제는 나중에
  parseWebhook(rawBody: string, headers: Headers): { eventId; type; providerPaymentId? } | null;
}
```

- **웹훅**: `POST /api/billing/webhook/:provider` 로 받고, 받은 내용은 "힌트"로만 씁니다.
  - 처리 순서: 서명 확인(제공자가 지원하면) → `fetchPayment()` 로 다시 조회 → 그 상태를 반영
  - 같은 이벤트는 `webhook_events(provider, event_id)` 로 한 번만 처리합니다.
  - 지금의 CSRF 막이(`sameOriginOnly`)는 `Origin` 이 없는 서버 간 요청을 통과시킵니다. 이를 시험으로 고정합니다.
- **상태 전이**: 순수 함수 `server/src/billing/state.ts` 로 만들고 단위 시험합니다.
  - 이용권: `active(until) → expired`. 유효할 때 또 사면 `until` 이 늘어납니다.
  - 구독(나중):
    - `active → past_due(유예) → active` 또는 `→ expired`
    - 해지 예약 → 기간 끝에 `expired`
    - 전액 환불 → 권한 원복
- **테이블**: `subscriptions`, `payments(order_id UNIQUE, provider_payment_id UNIQUE, amount_krw, vat_krw, status, receipt_url …)`, `refunds`, `webhook_events`, `entitlement_overrides`, `audit_log`
  - 주문번호는 결제창을 열기 전에 만들어 중복 방지 키로 씁니다.
  - 빌링키는 AES-256-GCM(`BILLING_ENC_KEY`)으로 암호화합니다.
- **보안 헤더**: `securityHeaders` 를 경로별로 다르게 합니다. 결제 화면에서만 PG 도메인을 `script-src`·`frame-src`·`connect-src`·`form-action` 에 허용하고, 팝업을 쓰면 COOP 도 그 화면에서만 풉니다.
- **PG 후보**(모두 확인 필요):

  | 후보 | 장점 | 확인할 것 |
  | --- | --- | --- |
  | 토스페이먼츠 직접 | 국내 카드·간편결제, 문서가 많음 | 단건 결제 심사 조건, 자동결제(빌링) 별도 계약 조건, 수수료 |
  | 포트원 V2 | 여러 PG 를 묶어 나중에 PG 를 바꾸기 쉬움 | 밑에 붙일 PG 계약은 따로 필요 |
  | Paddle(판매 대행) | 한국 카드·카카오페이·네이버페이 원화 구독 지원(구매자 쪽), 세금 처리 대행 | **한국 거주 개인 판매자가 가입할 수 있는지 미확인**. 판매 대행이어도 국내 사업자등록·신고가 필요한지 세무사 확인 |

### 화면 (M1·M5)

- **요금제·결제 화면**:
  - `/pricing` 은 요금제 비교입니다(`GET /api/billing/plans`). 왼쪽 메뉴(`web/src/components/Nav.tsx`)에 "요금제"를 추가합니다.
  - `/billing/checkout`, `/billing/success`·`/billing/fail` 을 둡니다. 성공 화면은 주소의 값만 믿지 않고 `POST /api/billing/confirm` 으로 확정합니다.
- **설정**(`web/src/pages/SettingsPage.tsx`): 다음 영역을 추가합니다.
  - 계정: 이메일, 가입일, 모든 기기에서 로그아웃, 계정 삭제
  - 요금제와 결제: 요금제, 유효 기간, 결제 내역, 영수증, 환불 요청
  - 사용량: 오늘·이번 달 AI, 컴파일 시간
- **법정 문서**: `/terms`·`/privacy`·`/refund` 는 버전이 붙은 md 문서로 두고, 기존 `marked`·`DOMPurify` 로 보여 줍니다.
- **하단 사업자 정보**: 새 `Footer` 컴포넌트에 상호·대표자·사업자등록번호·통신판매업 신고번호·주소·연락처·개인정보 보호책임자·호스팅 제공자를 넣습니다.
  - 값은 `GET /api/site` 로 실행할 때 설정합니다. 이미지를 다시 빌드할 필요가 없고, 포크한 쪽도 자기 값을 넣습니다.
- **한도 안내**: 한도에 닿으면 대화 창(`web/src/editor/ChatPane.tsx`)에 요금제 안내를 보여 줍니다. 해지는 가입보다 단계가 많지 않게 만듭니다(다크패턴 금지).

### 탈퇴와 보관 (M1)

`POST /api/account/delete` 를 확인 단계를 거쳐 실행합니다.
1. 진행 중인 자동결제를 해지합니다. 환불은 환불정책을 따르며 자동으로 하지 않습니다.
2. 사용자 행에 `deleted_at` 을 넣고 이메일·이름을 지운 뒤 `session_version` 을 올립니다. 그러면 모든 쿠키가 무효가 됩니다.
3. 원장(`ai_events`·`compile_events`)의 `user_id` 를 가명 `del:<hmac>` 으로 바꿉니다. 통계는 남고 신원은 사라집니다.
4. 결제·환불 기록은 법정 보관 기간 동안 가명으로 둔 뒤 지웁니다. 기간은 확인 필요입니다(전자상거래 거래 기록은 5년으로 알려져 있음).
5. 서버 저장 문서(M6)를 지우고, 브라우저 문서를 지울지 묻습니다(`removeDoc` 재사용).
6. 구글 계정 식별값의 해시를 표식으로 남깁니다. 탈퇴 후 다시 가입해 무료 한도를 되돌리는 것을 막기 위해서입니다.
7. 개인정보처리방침에 "백업에는 보관 기간(14일) 동안 남을 수 있음"을 적습니다.

### 서버 저장 (M6)

- **원칙**: 브라우저가 기본이고, 서버 저장은 문서별로 고르는 기능입니다(지금의 약속을 깨지 않음).
- **저장 방식**: 파일은 내용 해시 이름으로 저장합니다(`DATA_DIR/blobs`, 나중에 S3 호환 저장소). 메타데이터는 SQLite 의 `documents`·`revisions(manifest JSON)` 에 둡니다.
- **해시 확인 범위**: "이 해시가 있나요?" 확인은 **요청한 사용자가 올린 것만** 대조합니다(`user_blobs`). 그래야 다른 사람의 파일이 있는지 알아낼 수 없습니다.
- **충돌**: 저장할 때 기준 버전을 보내고, 다르면 409 를 받습니다.
  - 한글·Word 같은 이진 파일은 합치지 않고 "충돌본" 사본을 만듭니다.
  - LaTeX 는 파일 단위로 판단합니다.
- **기타**: 용량 한도는 `limits.storageBytes` 를 따릅니다. "전체 내보내기(zip)"를 제공하고, `navigator.storage.persist()` 를 요청합니다.

### 관리

- **1단계**: 관리자 CLI `server/scripts/admin.mjs` 를 둡니다.
  - 기능: 사용자 찾기, 요금제 부여·회수, 원가 집계, 차단
  - 모든 명령은 `audit_log` 에 남습니다.
- **2단계**: `role='admin'` 만 들어가는 `/admin` 화면을 둡니다(사용자 상세, 환불, 웹훅 기록, 하루 원가).

## 결제 전에 반드시 끝낼 것

1. 진짜 Claude 호출을 모든 기능에서 확인합니다: 대체 모델 베타 수락, `usage` 값, 캐시 적중
2. 원장을 켜고 베타 자료 2–4주를 모은 뒤, 가격 결정을 문서로 남깁니다.
3. SuperDoc 결정(계약 또는 Word 끄고 출시)을 `THIRD_PARTY_NOTICES.md`·`docs/DEPLOY.md` 에 기록합니다.
4. 최종 이름·도메인을 정합니다. PG 심사가 사이트 이름을 봅니다.
5. 사용자 테이블, 세션 무효화, 탈퇴, 약관 동의를 갖춥니다.
6. 사업자등록·통신판매업 신고를 마치고 하단 정보를 채운 뒤 법률 검토와 PG 승인을 받습니다.
7. 백업 복구 훈련, 전체 비용 차단기, Anthropic 콘솔 월 지출 한도를 갖춥니다.

## 사업·법 점검표 (전문가 확인 필요)

| 항목 | 내용 | 상태 |
| --- | --- | --- |
| 사업자등록 | 개인사업자(간이·일반 과세 판단은 세무사) | 미진행 |
| 통신판매업 신고 | 구청·정부24. PG 심사 전에 필요하다는 경험담이 있음. 구매안전서비스 확인증 필요 여부 | 확인 필요 |
| 하단 표시 | 상호, 대표자, 사업자등록번호, 통신판매업 신고번호, 주소, 연락처, 개인정보 보호책임자, 호스팅 제공자 | 설계만 |
| 이용약관·환불정책 | 청약철회, 디지털 콘텐츠 예외는 사전에 분명히 알려야 함, 부가세 포함 가격 표시 | 초안 필요 |
| 정기결제 | 전자상거래법 제13조 제6항(2025-02-14 시행): 정기결제 대금 인상·무료→유료 전환 때 추가 동의와 고지. 다크패턴 규제(숨은 갱신, 해지 방해 등). 고지 기간은 미확인 | 이용권부터 시작해 부담을 줄임 |
| 개인정보처리방침 | 수집 항목(구글 이메일·이름), 처리 위탁(호스팅·PG), **국외 이전**(문서 글을 미국 Anthropic 으로 보냄: 항목·시기·방법·보관), 보관·파기, 만 14세 미만 처리 | 초안 필요 |
| SuperDoc | 상용 계약 또는 Word 끄고 출시 | 문의 전 |
| 상표·이름 | "AllDoc" 은 임시 이름(비슷한 이름의 앱이 있음). KIPRIS 검색 | 미진행 |
| AGPL | 서비스 이용자에게 소스 제공(`VITE_SOURCE_URL`). 남이 같은 코드로 서비스할 수 있음을 전제로 함. 외부 기여를 받기 전에 기여 동의서(CLA) 여부 결정 | 결정 필요 |

## 큰 위험과 대응

| 위험 | 대응 |
| --- | --- |
| AI 원가가 구독료를 넘음 | 원장, 글자 상한, 일·월 한도, 숨은 원가 상한, 전체 비용 차단기, 콘솔 지출 한도, 캐싱, 보내는 범위 선택. 모델·추론 강도 변경은 사용자가 결정 |
| 무료 계정 대량 생성 | 탈퇴 표식, IP 기준 요청 제한(로그인·컴파일), 필요하면 추가 확인 |
| SuperDoc 라이선스 | 계약 전까지 유료 배포는 `VITE_DISABLE_DOCX=1`. 경쟁 제품 조항 때문에 계약이 안 될 수도 있음 |
| 컴파일 서버 탈출·자원 고갈 | `docs/LATEX.md` 의 이중 격리와 탈출 시험 |
| 서버 한 대 한계 | 컴파일 일꾼은 처음부터 분리. 앱은 SQLite·메모리 잠금 때문에 1프로세스 전제(Postgres 로 옮기는 조건으로 기록) |
| 개인정보 약속과 실제가 어긋남 | 서버 컴파일·서버 저장을 넣는 변경에서 동의 안내·처리방침·`docs/AI.md`·`docs/DEPLOY.md`·README 를 함께 고침 |
| 브라우저 저장소 삭제 | `navigator.storage.persist()`, 내려받기 안내, M6 서버 저장 |

## 사용자가 정할 것

1. 사업자등록 시점, PG(토스 직접 또는 포트원), Paddle 을 알아볼지
2. 유료 판매를 Word 없이 시작할지, SuperDoc 계약을 기다릴지
3. 무료 사용자에게 컴파일을 줄지, 준다면 시간 제한(E1 측정 뒤)
4. 작업·요금제별 모델과 추론 강도(M0 원가 자료를 본 뒤)
5. 첫 유료 상품: 이용권(권장) 또는 월 자동결제
6. 템플릿 라이선스(CC0 또는 MIT), 최종 제품명과 도메인
7. 베타 인원, 출시 시기, 가격

## 참고 (2026-10 검색, 바뀔 수 있음)

- Overleaf 무료 컴파일 시간은 10초(2025-08 적용), 유료는 240초입니다: [무료 컴파일 시간 변경](https://www.overleaf.com/blog/changes-to-free-compile-timeout), [요금제 한도](https://cn.overleaf.com/learn/how-to/Overleaf_plan_limits)
- Overleaf Community Edition(AGPL)에는 격리 컴파일이 없습니다(Server Pro 전용): [비교표](https://docs.overleaf.com/on-premises/welcome/server-pro-vs.-community-edition)
- Paddle 의 한국 결제 수단: [Korean cards](https://developer.paddle.com/concepts/payment-methods/korean-cards), [지원 국가](https://developer.paddle.com/concepts/sell/supported-countries-locales)
- 포트원 빌링키 결제: [V2 문서](https://docs.iamport.kr/docs/v2-payment/unauthpay/billing-key/1/pg/1). PG 비교: [포트원 블로그](https://blog.portone.io/pgcompare/)
- 국내 PG 심사와 Stripe(경험담): [브런치 글](https://brunch.co.kr/@chunja07/196)
- 정기결제·다크패턴 규제: [서울시 안내](https://news.seoul.go.kr/economy/archives/566114), [다크패턴 문답](https://www.newsis.com/view/NISX20250213_0003063585)
- SuperDoc 이중 라이선스: [README](https://cdn.jsdelivr.net/npm/superdoc@1.45.0/README.md), [DOCX 엔진 라이선스](https://docs.superdoc.dev/resources/docx-engine-license)

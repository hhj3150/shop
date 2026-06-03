# PayAction 무통장입금 자동확인 연동 — 설계

- 일자: 2026-06-03
- 작성: Claude (CTO 위임)
- 상태: 승인됨 — 구현 진행

## 1. 목표 / 범위

무통장입금(계좌이체) 결제를 자동화한다. 구매자가 디투오 법인계좌(농협 351-1051-9755-13)로
입금하면 PayAction이 주문과 자동 매칭하여 우리 서버 웹훅으로 통보 → 주문을 `입금확인`으로
자동 전환한다. 입금확인 알림톡/문자는 **PayAction이 직접 발송**한다(우리 Solapi 미사용).

- 결제수단 관계: **무통장입금 전담**. 카드·간편결제는 기존 PortOne 유지, PortOne 가상계좌(VA)는 제거.
- 입금확인 문자: PayAction 직접 발송. 단, 주문 등록 시 `orderer_phone_number` 포함 필수.
- 웹훅 수신 후 최종 상태: `입금확인` (PortOne 웹훅과 동일 — 이후 배송준비는 관리자 단계 유지).

## 2. 비즈니스 흐름

1. 무통장입금으로 주문 → DB 주문 생성(`입금대기`) → PayAction 주문등록 API 호출
2. 구매자가 농협 351-1051-9755-13(디투오)로 입금
3. PayAction이 입금자명+금액으로 자동 매칭 → 우리 웹훅으로 `매칭완료` 전송
4. 웹훅 수신 → `입금대기 → 입금확인` 전환(+구독 슬롯 활성화/연장 부수효과)
5. 입금확인 문자는 PayAction이 발송

## 3. 아키텍처 원칙 (기존 PortOne 패턴 차용)

- **시크릿은 서버 전용.** `PAYACTION_API_KEY`가 필요한 주문등록은 브라우저에서 직접 호출 금지 → 서버 라우트 경유.
- **금액 권위값은 DB.** 등록 금액은 클라이언트 값이 아니라 `orders.total_amount`를 시크릿 게이트 RPC로 재조회(C1).
- **웹훅은 키 검증 + trace-id 멱등 + 시크릿 게이트 RPC.**
- **슬롯 로직 비복제.** `payaction_confirm`이 내부적으로 기존 `confirm_payment`를 재사용한다.
  PayAction이 정확금액 매칭을 보장하므로 DB의 `total_amount`를 `paid_amount`로 전달 → 금액검증 통과 +
  구독 슬롯 활성화/연장 부수효과를 그대로 재사용(기존 결제 코드 변경 없음).

## 4. 환경변수 (서버 전용, 커밋 금지)

```
PAYACTION_API_BASE=https://api.payaction.app
PAYACTION_API_KEY=...        # 대시보드 API Key
PAYACTION_MALL_ID=...        # 상점 ID
PAYACTION_WEBHOOK_KEY=...    # 웹훅 검증 키
```

RPC 시크릿은 기존 Vault `confirm_payment_secret`(env `CONFIRM_PAYMENT_SECRET`)을 재사용한다(동일 서버 신뢰영역).

## 5. 파일 구조

| 파일 | 변경 | 역할 |
|------|------|------|
| `lib/payaction.ts` | 신규 | 클라이언트: `registerOrder()`, `isPayActionConfigured`, `normalizePhone`, `validateOrderNumber` |
| `app/api/payaction/register/route.ts` | 신규 | 주문등록: orderNo+연락처 → 권위필드 RPC 조회 → PayAction `/order` |
| `app/api/payaction/webhook/route.ts` | 신규 | 매칭완료 웹훅: 키검증 → 멱등 → `payaction_confirm` → 200 |
| `supabase/migration-payaction.sql` | 신규 | `payaction_webhook_events` + `payaction_confirm` + `payaction_order_payload` |
| `lib/orders.ts` | 수정 | 주문생성 후 등록 라우트 호출 헬퍼 |
| `app/checkout/page.tsx` | 수정 | 무통장 선택 시 등록 연결 |
| `app/order-once/page.tsx` | 수정 | 동일(게스트 포함) |
| `components/PayMethodSelect.tsx` | 수정 | 무통장입금/카드/간편결제(VA 제거) |
| `lib/portone.ts` | 수정 | `PayMethod`에서 `VIRTUAL_ACCOUNT` 제거 |
| `.env.example` | 수정 | `PAYACTION_*` 4개 키 |

## 6. API 계약

### (A) 주문등록 — PayAction `POST /order`
Headers: `x-api-key`, `x-mall-id`. Body:
`order_number`(우리 주문번호 `SYYYYYMMDD-NNNN`, 15자), `order_amount`(DB 권위), `order_date`(ISO+09:00, KST),
`billing_name`(=depositor_name, 매칭 기준), `orderer_name`, `orderer_phone_number`(숫자만), `orderer_email`(선택).
응답 `{status:"success"|"error"}`.

### (B) 매칭완료 웹훅 — PayAction → `POST /api/payaction/webhook`
Headers: `x-webhook-key`, `x-mall-id`, `x-trace-id`. Body: `{order_number, order_status:"매칭완료", processing_date}`.
- 검증: `x-webhook-key==env && x-mall-id==env`, 불일치 401.
- 멱등: `x-trace-id` 저장/중복방어.
- `매칭완료`만 확정 처리, 그 외 상태는 200 + 로깅.
- 응답: 검증통과 시 항상 `200 {status:"success"}`(비-200은 PayAction이 최대 3회 재전송 후 발송중단).
- 우리는 문자 발송 안 함(PayAction이 발송).

## 7. DB 설계 (`migration-payaction.sql`)

- `payaction_webhook_events(trace_id text PK, order_no text, order_status text, processing_date timestamptz, received_at timestamptz default now())` — RLS enable, 정책 없음(SECURITY DEFINER RPC만 접근).
- `payaction_confirm(p_order_no, p_secret, p_trace_id, p_order_status, p_processing_date) returns jsonb`
  - 시크릿 검증(Vault `confirm_payment_secret`)
  - `insert ... on conflict(trace_id) do nothing` → 중복이면 `{changed:false, idempotent:true}`
  - 주문 없으면 `{error:'order_not_found'}`
  - `order_status<>'매칭완료'` 면 `{changed:false, ignored:status}`
  - `confirm_payment(p_order_no, p_secret, total_amount, '무통장입금', p_trace_id)` 호출 결과 반환
- `payaction_order_payload(p_order_no, p_secret) returns jsonb` — 시크릿 검증 후 order_no/total_amount/depositor_name/ship_name/ship_phone/is_gift/gifter_name/status/order_date(KST ISO) 반환.

## 8. 결정 사항

- 선물 주문: `orderer_phone = 보내는 분(로그인 회원) 전화` 로 등록 → 입금확인 문자가 주문자에게 감.
- 접수 안내 문자(`order_received`, Solapi)는 유지 — *입금 전 안내*로 PayAction의 *입금확인*과 역할이 다름.
- 등록 실패는 non-fatal: 주문 유지, 로깅, 관리자 재등록 가능(현금영수증 패턴).
- 입금자명(depositor_name)은 매칭 기준이므로 무통장 결제 시 필수 입력화.
- PayAction 미설정 시 무통장은 기존 수동 흐름으로 동작(등록 호출 skip).

## 9. 테스트 (TDD)

- `lib/payaction.test.ts`: `normalizePhone`(하이픈/+82 정규화), `validateOrderNumber`(22자 가드), `registerOrder` 성공/실패/미설정(fetch mock).
- 웹훅 검증 헬퍼: 키 불일치 거부, 매칭완료만 처리.
- 멱등은 RPC 레벨(`on conflict`)로 보장 — DB 통합은 수동/스테이징 검증.

## 10. 보안 메모

- 채팅에 노출된 키는 대시보드에서 재발급(사용자 진행 예정).
- 모든 PayAction 키는 `.env.local` + Netlify env 전용, 레포 커밋 금지.
- 웹훅 신뢰경계 = `x-webhook-key`/`x-mall-id` 검증. 금액은 PayAction이 매칭 시점에 보장.

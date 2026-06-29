// 카카오 알림톡 템플릿 레지스트리(서버 전용).
//
// 키 → templateId 환경변수명 매핑. 실제 templateId 값은 솔라피 검수 승인 후
// Netlify 환경변수로만 주입한다(공개 repo에 절대 커밋 금지).
//
// 변수(variables)는 등록된 템플릿의 `#{변수명}` 자리표시자와 "정확히" 일치해야
// 발송된다. 아래 VARS는 등록 시 맞춰야 할 변수명을 코드 쪽에서 명시해 둔 것으로,
// 검수 단계에서 실제 템플릿 본문의 변수명과 동일하게 등록하면 된다.

export type NotifyTemplateKey =
  | "EXPIRE_SOON" // 구독 만료 임박 (D-7) — 트리거(cron) 별도 작업
  | "PAYMENT_DEADLINE" // 미입금 마감 임박 — 트리거(cron) 별도 작업
  | "PAYMENT_GUIDE" // 주문 접수 + 입금 안내
  | "PAYMENT_CONFIRMED" // 입금 확인
  | "WELCOME" // 회원가입 환영
  | "SHIPPED" // 발송 안내(송장 등록)
  | "FIRST_SHIPPED" // 첫 배송 안내(1회차) — 브랜드필름 버튼 포함. 미등록 시 SHIPPED→LMS 폴백.
  | "DELIVERED" // 배송 완료 안내
  | "SUBSCRIPTION_CANCELLED" // 구독 해지 접수
  | "GIFT_RECIPIENT" // 선물 도착 안내(받는 분)
  | "RENEW_GUIDE" // 구독 연장 접수 + 입금 안내
  | "RENEW_CONFIRMED"; // 구독 연장 입금 확인

// 키 → templateId 를 담는 환경변수 이름.
const TEMPLATE_ENV: Record<NotifyTemplateKey, string> = {
  EXPIRE_SOON: "SOLAPI_TEMPLATE_EXPIRE_SOON",
  PAYMENT_DEADLINE: "SOLAPI_TEMPLATE_PAYMENT_DEADLINE",
  PAYMENT_GUIDE: "SOLAPI_TEMPLATE_PAYMENT_GUIDE",
  PAYMENT_CONFIRMED: "SOLAPI_TEMPLATE_PAYMENT_CONFIRMED",
  WELCOME: "SOLAPI_TEMPLATE_WELCOME",
  SHIPPED: "SOLAPI_TEMPLATE_SHIPPING",
  FIRST_SHIPPED: "SOLAPI_TEMPLATE_FIRST_SHIPPING",
  DELIVERED: "SOLAPI_TEMPLATE_DELIVERED",
  SUBSCRIPTION_CANCELLED: "SOLAPI_TEMPLATE_SUBSCRIPTION_CANCEL",
  GIFT_RECIPIENT: "SOLAPI_TEMPLATE_GIFT_ARRIVAL",
  RENEW_GUIDE: "SOLAPI_TEMPLATE_RENEW_GUIDE",
  RENEW_CONFIRMED: "SOLAPI_TEMPLATE_RENEW_CONFIRMED",
};

// 템플릿별 변수명(등록 시 본문의 `#{...}` 와 동일하게 맞출 것). 문서·검증용.
//
// ★ Solapi 알림톡 검수 등록 시 LMS 본문과 맞춰야 할 항목(알림톡 전환 전 필수):
//   - RENEW_GUIDE / RENEW_CONFIRMED: 본문에 "#{회차}회분이 더 이어집니다" 처럼 #{회차} 포함.
//     (코드가 #{회차} 를 전달한다. 회차수가 없는 레거시 주문은 빈 값→자동 LMS 폴백되므로 안전.)
//   - EXPIRE_SOON: 재구독 링크(https://shop.a2jerseymilk.com/account)는 변수가 아니라
//     템플릿 본문의 고정 텍스트(또는 웹링크 버튼)로 등록한다 — URL 이 고정이라 변수 불필요.
//   - FIRST_SHIPPED: SHIPPED 와 동일 변수 + 본문에 '왜 이 우유' 한 줄, 브랜드필름
//     (https://youtu.be/bI5EmgK0i2A)은 변수가 아니라 '웹링크 버튼'으로 고정 등록한다.
//     env(SOLAPI_TEMPLATE_FIRST_SHIPPING) 미설정이면 자동으로 LMS(첫배송 ritual 본문)로 폴백.
export const TEMPLATE_VARS: Record<NotifyTemplateKey, readonly string[]> = {
  EXPIRE_SOON: ["#{고객명}", "#{만료일}"],
  PAYMENT_DEADLINE: ["#{고객명}", "#{주문번호}", "#{금액}", "#{마감일}"],
  PAYMENT_GUIDE: ["#{고객명}", "#{주문번호}", "#{금액}", "#{입금계좌}"],
  PAYMENT_CONFIRMED: ["#{고객명}", "#{주문번호}"],
  WELCOME: ["#{고객명}"],
  SHIPPED: ["#{고객명}", "#{주문번호}", "#{택배사}", "#{송장번호}"],
  FIRST_SHIPPED: ["#{고객명}", "#{주문번호}", "#{택배사}", "#{송장번호}"],
  DELIVERED: ["#{고객명}", "#{주문번호}"],
  SUBSCRIPTION_CANCELLED: ["#{고객명}", "#{환불금액}"],
  GIFT_RECIPIENT: ["#{받는분}", "#{보내는분}", "#{제품요약}"],
  RENEW_GUIDE: ["#{고객명}", "#{주문번호}", "#{금액}", "#{입금계좌}", "#{회차}"],
  RENEW_CONFIRMED: ["#{고객명}", "#{주문번호}", "#{회차}"],
};

// 검수 승인 후 env 에 templateId 가 들어왔을 때만 값을 반환. 비어 있으면 undefined.
export function resolveTemplateId(key: NotifyTemplateKey): string | undefined {
  const v = process.env[TEMPLATE_ENV[key]];
  return v && v.trim() ? v.trim() : undefined;
}

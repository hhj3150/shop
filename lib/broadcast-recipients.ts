// 단체문자 수신자 선별 — 순수 로직(React/네트워크 비의존) → 단위 테스트 대상.
//   발송 자체는 BroadcastPanel + /api/broadcast(Solapi)가 담당. 여기선 '누구에게 갈지'만 정한다.
//
// ★ 2026-08-12 실사고: 하절기 휴가 안내를 「광고」 체크가 켜진 채 발송해, 서버가 광고
//   수신동의자만 남기고 38명을 잘라냈다. 구매 이력이 있는 고객 77명 중 39명만 받았고
//   (활성 구독자 64명 중 29명 미수신), 정작 받은 57명 중 20명은 아무것도 안 산 가입자였다.
//   화면은 "수신자 57명"만 보여줄 뿐 '몇 명이 잘려나갔는지'를 알려주지 않아 아무도 몰랐다.
//   → 그래서 이 모듈은 (1) 필터 매칭과 (2) 광고 동의 필터를 분리해서 계산하고,
//     잘려나간 인원수(adExcluded)를 항상 함께 돌려준다. 화면은 그 수를 반드시 노출한다.

import type { DeliveryDay } from "./cart";

// 요일 목록. cart.tsx 의 DELIVERY_DAYS 와 같은 값이지만, 그쪽은 "use client" 모듈이라
//   순수 로직에서 값으로 끌어오지 않는다(production-demand.ts 의 WEEKDAYS 와 같은 규칙).
const WEEKDAYS: readonly DeliveryDay[] = ["mon", "tue", "wed", "thu", "fri"];

export type RecipientProfile = {
  id: string;
  name: string;
  phone: string;
  marketing_consent?: boolean;
};

export type RecipientSlot = {
  user_id: string;
  delivery_day: DeliveryDay;
  status: string;
};

export type RecipientOrder = {
  user_id: string;
  order_type: string; // '구독' | '단품'
  status: string; // 입금대기 | 입금확인 | 배송준비 | 배송중 | 배송완료 | 취소
};

// 수신자 필터 키. 여러 개를 고르면 합집합이다.
//   all      전체 회원
//   customer 구매 고객 전체 — 구독 이력(상태 무관) 또는 취소 아닌 주문 이력
//   active   활성 구독자
//   once     단품 구매 고객 — 취소 아닌 '단품' 주문 이력
//   nosub    미구독 회원 — 구독 슬롯이 한 번도 없던 회원
//   mon..fri 요일별 활성 구독자
export type FilterKey = "all" | "customer" | "active" | "once" | "nosub" | DeliveryDay;

// 주문 이력으로 인정하지 않는 상태. 취소된 주문만 제외한다 —
//   입금대기도 '주문한 사람'이므로 배송 일정 공지 대상에 포함한다.
const VOID_ORDER_STATUS = "취소";

function hasUsablePhone(phone: string | null | undefined): boolean {
  const digits = String(phone ?? "").replace(/[^0-9]/g, "");
  return digits.length >= 9 && digits.length <= 11;
}

export type SelectRecipientsInput = {
  profiles: RecipientProfile[];
  slots: RecipientSlot[];
  orders: RecipientOrder[];
  filters: Iterable<FilterKey>;
  /** 광고성 발송이면 true — 수신동의 회원만 남긴다(정보통신망법). */
  isAd: boolean;
};

export type SelectRecipientsResult = {
  /** 필터에 걸린 회원 전체(광고 동의 무관). */
  matched: RecipientProfile[];
  /** 실제 발송 후보 — 광고면 수신동의자만. */
  candidates: RecipientProfile[];
  /** 광고 동의가 없어 제외된 인원수. 화면에 반드시 노출한다. */
  adExcluded: number;
};

/**
 * 필터에 걸리는 회원과, 그중 광고 동의로 걸러지고 남은 후보를 함께 계산한다.
 * 번호가 없는(또는 자릿수가 안 맞는) 회원은 애초에 발송할 수 없으므로 양쪽 모두에서 뺀다.
 */
export function selectRecipients({
  profiles,
  slots,
  orders,
  filters,
  isAd,
}: SelectRecipientsInput): SelectRecipientsResult {
  const keys = new Set<FilterKey>(filters);
  if (keys.size === 0) return { matched: [], candidates: [], adExcluded: 0 };

  const activeUserIds = new Set<string>();
  const everSubUserIds = new Set<string>();
  const dayUserIds = new Map<DeliveryDay, Set<string>>();
  for (const d of WEEKDAYS) dayUserIds.set(d, new Set());
  for (const s of slots) {
    everSubUserIds.add(s.user_id);
    if (s.status === "활성") {
      activeUserIds.add(s.user_id);
      dayUserIds.get(s.delivery_day)?.add(s.user_id);
    }
  }

  const orderedUserIds = new Set<string>();
  const onceUserIds = new Set<string>();
  for (const o of orders) {
    if (o.status === VOID_ORDER_STATUS) continue;
    orderedUserIds.add(o.user_id);
    if (o.order_type === "단품") onceUserIds.add(o.user_id);
  }

  const matched = profiles.filter((p) => {
    if (!hasUsablePhone(p.phone)) return false;
    if (keys.has("all")) return true;
    if (keys.has("customer") && (everSubUserIds.has(p.id) || orderedUserIds.has(p.id))) return true;
    if (keys.has("active") && activeUserIds.has(p.id)) return true;
    if (keys.has("once") && onceUserIds.has(p.id)) return true;
    if (keys.has("nosub") && !everSubUserIds.has(p.id)) return true;
    for (const d of WEEKDAYS) {
      if (keys.has(d) && dayUserIds.get(d)?.has(p.id)) return true;
    }
    return false;
  });

  const candidates = isAd ? matched.filter((p) => p.marketing_consent === true) : matched;
  return { matched, candidates, adExcluded: matched.length - candidates.length };
}

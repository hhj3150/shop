// 연장 신청 폼의 순수 헬퍼 — 프리필(현재 활성 블록 → 카탈로그 product_id 매칭),
//   RPC 입력 변환, 본인이 이미 점유한 요일 산출. React 비의존(단위 테스트 대상).

import { PRODUCTS } from "./products";
import type { DeliveryDay } from "./cart";
import type { MySubscription } from "./subscriptions";
import {
  normalizeBlocks,
  activeBlockForRound,
  totalWeeks as blockTotalWeeks,
  type BlockItem,
} from "./subscription-timeline";
import { computeSchedule } from "./subscription-schedule";

// 폼 내부 품목 상태(불변). qty 0 이면 제출에서 제외된다.
export type FormItem = { productId: string; qty: number };

// product_name + volume 으로 카탈로그 product_id 를 역참조한다.
//   MySubscription.blocks 의 BlockItem 에는 product_id 가 없으므로(원장은 이름·용량만 보관),
//   PRODUCTS(정적 카탈로그) 의 (name, volume) 조합으로 매칭한다. 이 조합은 카탈로그에서 유일하다.
export function productIdFor(productName: string, volume: string): string | null {
  const hit = PRODUCTS.find((p) => p.name === productName && p.volume === volume);
  return hit ? hit.id : null;
}

// 현재 슬롯의 "활성 블록" 품목 — 발송 중인 회차가 속한 블록의 구성을 그대로 돌려준다.
//   computeSchedule 로 현재 회차(delivered, 최소 1)를 구하고 그 회차의 블록을 찾는다.
//   미시작이면 1회차 기준(첫 블록). 블록이 없으면(레거시/미로드) 빈 배열.
export function activeBlockItems(sub: MySubscription): BlockItem[] {
  if (sub.blocks.length === 0) return [];
  const resolved = normalizeBlocks(sub.blocks);
  const total = blockTotalWeeks(sub.blocks);
  const sched = computeSchedule({
    startedAt: sub.startedAt,
    totalWeeks: total,
    paused: sub.paused,
    pausedAt: sub.pausedAt,
    pausedDays: sub.pausedDays,
  });
  const round = sub.startedAt ? Math.max(1, sched.delivered) : 1;
  const block = activeBlockForRound(resolved, round);
  return block ? block.items : [];
}

// 활성 블록 구성을 폼 품목(productId·qty)으로 프리필한다.
//   카탈로그에서 매칭되지 않는 품목(단종 등)은 조용히 제외한다 — 사용자가 다시 고를 수 있다.
//   같은 product_id 가 여러 블록 항목으로 나뉘어 있으면 수량을 합산한다(불변 누적).
export function prefillFormItems(sub: MySubscription): FormItem[] {
  const items = activeBlockItems(sub);
  const byId = items.reduce<Record<string, number>>((acc, it) => {
    const id = productIdFor(it.productName, it.volume);
    if (!id) return acc;
    return { ...acc, [id]: (acc[id] ?? 0) + it.qty };
  }, {});
  return Object.entries(byId).map(([productId, qty]) => ({ productId, qty }));
}

// 폼 품목 → request_renewal 입력(product_id·qty). qty>0 만 남긴다.
export function buildRenewalItems(
  items: FormItem[]
): { product_id: string; qty: number }[] {
  return items
    .filter((it) => it.qty > 0)
    .map((it) => ({ product_id: it.productId, qty: it.qty }));
}

// qtyById 에서 "선택 가능한(active) 상품"에 없는 id 를 제거한 새 맵을 돌려준다.
//   프리필은 정적 PRODUCTS 전체에서 매칭되므로, 카탈로그 로드 후 판매종료(active=false)된
//   상품의 유령 수량이 남을 수 있다 — 화면에 행이 없는데 견적·제출엔 끼는 정합 깨짐을 막는다.
//   변경이 없으면(제거 대상 없음) 입력 객체를 그대로 반환해 무한 렌더 루프를 방지한다.
export function pruneToActive(
  qtyById: Record<string, number>,
  activeIds: readonly string[]
): Record<string, number> {
  const active = new Set(activeIds);
  const staleIds = Object.keys(qtyById).filter((id) => !active.has(id));
  if (staleIds.length === 0) return qtyById;
  return Object.fromEntries(
    Object.entries(qtyById).filter(([id]) => active.has(id))
  );
}

// 회원이 "다른" 활성 슬롯에서 이미 점유 중인 요일 집합.
//   연장 폼에서 이 요일들은(현재 슬롯의 요일은 제외) 비활성 처리한다 —
//   한 회원이 한 요일에 둘 이상의 활성 구독을 갖지 못하게 막는 UX 가드.
export function usedDeliveryDays(
  subs: readonly MySubscription[],
  currentSlotId: number
): Set<DeliveryDay> {
  const days = subs
    .filter((s) => s.slotId !== currentSlotId && s.status === "활성")
    .map((s) => s.deliveryDay);
  return new Set(days);
}

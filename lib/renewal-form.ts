// 연장 신청 폼의 순수 헬퍼 — 프리필(현재 활성 블록 → 카탈로그 product_id 매칭),
//   RPC 입력 변환, 본인이 이미 점유한 요일 산출. React 비의존(단위 테스트 대상).

import { PRODUCTS } from "./products";
import type { DeliveryDay } from "./cart";
import type { MySubscription, ShipTo } from "./subscriptions";
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

// 고른 품목 한 줄 요약 — "그대로 연장"이 대다수라, 품목 칸을 접어 두고 이 줄만 보여준다.
//   접힌 상태에서도 무엇이 이어지는지 한눈에 확인돼야 안심하고 신청한다.
//   목록 순서(카탈로그 진열 순서)를 그대로 따른다 — 화면을 펼쳤을 때와 같은 차례로 읽힌다.
export function summarizeItems(
  products: readonly { id: string; name: string; volume: string }[],
  qtyById: Readonly<Record<string, number>>
): string {
  return products
    .filter((p) => (qtyById[p.id] ?? 0) > 0)
    .map((p) => `${p.name} ${p.volume} ${qtyById[p.id]}개`)
    .join(" · ");
}

// ─── 받는 곳 ────────────────────────────────────────────────────────────────
//
//   [왜 연장 화면에 띄우나]
//     연장 폼은 품목·요일·기간·금액을 다 보여주면서 '어디로 가는지'는 한 줄도 없었다.
//     이사하고 내 정보를 안 고친 손님은 옛 주소로 간다는 걸 끝까지 모르고 결제한다.
//     우유가 엉뚱한 집에 도착하고 나서야 안다 — 되돌릴 수 없는 종류의 사고다.
//
//   [왜 프로필 주소가 아니라 주문 배송지인가]
//     연장분의 주소는 request_renewal 이 '원 구독 주문'에서 승계한다. 프로필이 아니다.
//     운영 DB 실측(2026-10-18): 활성 구독 97건 중 9건이 프로필 주소와 주문 배송지가
//     서로 다르다. 프로필을 띄웠다면 그 9명에게 실제와 다른 주소를 보여준 셈이 된다.
//     화면은 '예쁜 값'이 아니라 '실제로 쓰일 값'을 보여야 한다.

export type ShipToView =
  // 택배 — 내 정보 수정이 진행 중인 주문에 반영되므로(sync_my_order_shipping) 바꿀 수 있다.
  | { kind: "택배"; name: string; phone: string; lines: string[]; editable: true }
  // 선물 — 받는 분 주소다. sync_my_order_shipping 이 선물 주문을 제외하므로 내 정보를
  //   고쳐도 바뀌지 않는다. 바꾸기 링크를 걸면 거짓말이 된다(운영 중 5건).
  | { kind: "선물"; name: string; phone: string; lines: string[]; editable: false }
  // 방문수령 — 목장에서 직접 받는다. 주소 자체가 없다(운영 중 3건, 전부 주소 공란).
  | { kind: "방문수령"; editable: false }
  // 주소가 비었는데 택배다 — 이대로 두면 배송이 안 나간다. 숨기지 말고 드러낸다.
  | { kind: "주소없음"; editable: true };

/** 전화번호를 읽기 좋게. 숫자만 남기고 국내 규칙으로 끊는다(형식이 낯설면 원본 유지). */
export function formatPhone(raw: string): string {
  const d = (raw ?? "").replace(/[^0-9]/g, "");
  if (d.length === 11) return `${d.slice(0, 3)}-${d.slice(3, 7)}-${d.slice(7)}`;
  if (d.length === 10 && d.startsWith("02")) return `${d.slice(0, 2)}-${d.slice(2, 6)}-${d.slice(6)}`;
  if (d.length === 10) return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
  return raw ?? "";
}

export function shipToView(shipTo: ShipTo): ShipToView {
  if (shipTo.method === "방문수령") return { kind: "방문수령", editable: false };

  const address = (shipTo.address ?? "").trim();
  if (address === "") return { kind: "주소없음", editable: true };

  // 주소 한 줄 + 상세주소·우편번호 한 줄. 상세주소를 본주소에 이어 붙이면 길어져
  //   모바일에서 두 줄로 꺾이는데, 그때 어디까지가 주소인지 읽기 어렵다.
  const detail = (shipTo.addressDetail ?? "").trim();
  const postcode = (shipTo.postcode ?? "").trim();
  const second = [detail, postcode ? `(${postcode})` : ""].filter(Boolean).join(" ");
  const lines = [address, ...(second ? [second] : [])];
  const name = (shipTo.name ?? "").trim();
  const phone = formatPhone(shipTo.phone ?? "");

  return shipTo.isGift
    ? { kind: "선물", name, phone, lines, editable: false }
    : { kind: "택배", name, phone, lines, editable: true };
}

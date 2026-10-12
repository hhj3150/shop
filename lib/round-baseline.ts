// 구독 회차의 '확정 기준점' — 관리자가 한 번 선언하면 그 뒤로는 기록이 진실이 된다.
//
//   [왜 필요한가]
//     2026-06~10 로젠 송장 994건을 대조한 결과, 실제로 나갔는데 우리 기록에 없는
//     구독 회차가 상당수 있었다(출고 버튼이 송장번호를 요구해 그 입력이 빠지면 기록이
//     통째로 남지 않았다 — #199 에서 고쳤다). 그런데 과거분은 복구할 수 없다.
//     로젠 파일에는 '이 상자가 구독분이었나 홍보분이었나'가 없기 때문이다
//     (물품명은 전부 '농산물', 수량도 운임도 동일). 보낼 때의 의도이지 데이터가 아니다.
//
//   [그래서] 과거를 추론으로 메우지 않는다. 대신 관리자가 '지금까지 몇 회 나갔는지'를
//     고객별로 한 번 확정하고, 그 시점부터 기록으로 정확히 센다.
//
//   [기존 질서를 건드리지 않는다 — 이 설계의 핵심]
//     · shipment_log 에 가짜 행을 만들지 않는다 → 손님 마이페이지의 배송 이력이
//       송장 없는 유령 행으로 더럽혀지지 않는다.
//     · started_at · paused_days 를 손대지 않는다 → 배송 요일·휴무 이월·정지 보정이
//       그대로다. 이것들을 흔들면 전 회차 일정이 통째로 밀린다.
//     · 총 회차(block_weeks + extended_weeks)도 그대로 → 환불 금액 체계가 안 바뀐다.
//     · 확정 전에는 null 을 돌려준다 → 호출처가 옛 방식(달력)으로 떨어져 지금과 똑같이
//       동작한다. 한 명 확정할 때마다 그 구독만 정확해지는 점진 적용이다.

export type RoundBaseline = {
  // 관리자가 확정한 '확정일까지 나간 회차 수'. 미확정이면 null.
  confirmedCount: number | null;
  // 확정 기준일 'YYYY-MM-DD'. 이 날짜까지는 confirmedCount 가 진실이다.
  confirmedAt: string | null;
};

// 이 슬롯이 실제로 내보낸 회차 수.
//   확정 전이면 null — 호출처(computeSchedule 등)가 옛 동작을 유지한다.
//
//   ★ 한 날짜 = 한 회차다. 날짜를 중복 제거해 센다.
//     구독은 원주문과 연장주문이 한 슬롯에 묶이므로, 실수로 두 주문을 같은 날 출고하면
//     shipment_log 행이 둘 생긴다. 그대로 세면 손님이 결제한 회차가 하나 사라진다.
export function confirmedShippedCount(
  baseline: RoundBaseline,
  shipDates: readonly string[]
): number | null {
  const { confirmedCount, confirmedAt } = baseline;
  if (confirmedCount == null || !confirmedAt) return null;
  const after = new Set<string>();
  for (const d of shipDates) {
    if (d && d > confirmedAt) after.add(d);
  }
  return Math.max(0, Math.floor(confirmedCount)) + after.size;
}

// 관리자 확정 화면 한 줄 — 판단 재료를 모아 보여준다.
//   사장님이 '지금까지 몇 회 나갔나'를 숫자 하나로 끝낼 수 있게, 근거를 한 줄에 다 올린다.
export type BaselineRow = {
  slotId: number;
  name: string;
  phone: string;
  deliveryDay: string;
  startedAt: string | null;
  paused: boolean;
  paidRounds: number; // 결제한 총 회차(원주문 + 연장)
  recordedCount: number; // 우리 기록(shipment_log) — 서로 다른 발송일 수
  calendarRounds: number; // 지금 시스템이 '나갔다'고 믿는 회차(달력 기준)
  lastShipDate: string | null;
  confirmedCount: number | null; // 이미 확정했다면 그 값
  confirmedAt: string | null;
  confirmedNote: string | null;
};

// 아직 확정 안 된 줄이 위로 — 사장님이 할 일만 보이게 한다.
//   같은 미확정끼리는 '기록과 달력이 많이 벌어진 쪽'이 위다. 틀어진 폭이 클수록
//   손님이 회차를 잃고 있을 위험이 크기 때문이다.
export function sortBaselineRows(rows: readonly BaselineRow[]): BaselineRow[] {
  return [...rows].sort((a, b) => {
    const ac = a.confirmedAt ? 1 : 0;
    const bc = b.confirmedAt ? 1 : 0;
    if (ac !== bc) return ac - bc;
    const ag = a.calendarRounds - a.recordedCount;
    const bg = b.calendarRounds - b.recordedCount;
    if (ag !== bg) return bg - ag;
    return a.name.localeCompare(b.name, "ko");
  });
}

// 추천 확정값 — '애매하면 손님에게 유리하게'.
//   우리 기록과 택배사 송장이 다르면 '적은 쪽'을 받은 것으로 본다. 덜 세면 회차가 남고,
//   더 세면 손님이 결제한 회차를 잃는다. 되돌릴 수 없는 쪽을 피한다.
//   결제 회차를 넘겨 셀 수는 없다(넘치면 구독이 이미 끝난 것이므로 상한으로 자른다).
export function suggestBaseline(input: {
  paidRounds: number;
  recordedCount: number;
  courierCount: number | null;
}): number {
  const { paidRounds, recordedCount, courierCount } = input;
  const candidates = [recordedCount, ...(courierCount == null ? [] : [courierCount])];
  const lower = Math.min(...candidates);
  return Math.max(0, Math.min(lower, Math.max(0, paidRounds)));
}

// 슬롯별 '실제로 내보낸 회차 수' 맵 — 배송 명단·배송 시트가 이것으로 종료를 판정한다.
//
//   입력은 관리자 화면이 이미 들고 있는 것들뿐이다. 서버를 한 번 더 부르지 않는다.
//     shipmentKeys  `${주문id}|${발송일}` (shipment_log 에서 만든 키)
//     slotIdByOrder 원주문·연장주문 id → 슬롯 id
//     baselines     확정된 슬롯만 담긴 기준점
//
//   ★ 확정된 슬롯만 결과에 넣는다. 미확정 슬롯이 맵에 없으면 호출처가 '모름'으로 보고
//     옛(달력) 경로로 떨어진다 — 0 을 넣으면 '한 번도 안 나갔다'는 뜻이 되어, 이미
//     받은 손님에게 처음부터 다시 보내는 과배송이 된다. 둘은 전혀 다른 값이다.
export function shippedRoundsBySlot(
  shipmentKeys: Iterable<string>,
  slotIdByOrder: ReadonlyMap<string, number>,
  baselines: ReadonlyMap<number, RoundBaseline>
): Map<number, number | null> {
  const datesBySlot = new Map<number, string[]>();
  for (const key of shipmentKeys) {
    // 발송일은 키의 마지막 '|' 뒤. 주문 id 자체에 '|' 가 있어도 안전하게 뒤에서 자른다.
    const cut = key.lastIndexOf("|");
    if (cut < 0) continue;
    const slotId = slotIdByOrder.get(key.slice(0, cut));
    if (slotId == null) continue;
    const list = datesBySlot.get(slotId);
    if (list) list.push(key.slice(cut + 1));
    else datesBySlot.set(slotId, [key.slice(cut + 1)]);
  }
  const out = new Map<number, number | null>();
  for (const [slotId, baseline] of baselines) {
    out.set(slotId, confirmedShippedCount(baseline, datesBySlot.get(slotId) ?? []));
  }
  return out;
}

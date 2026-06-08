// 배송 명단 '이월(지연)' 판정 — 순수. React/DB 비의존.
//   단품은 발송예정일(ship_date)이 고정이라, 그날 못 보내면 다음날 명단에서 사라진다.
//   선택일 이하의 '아직 안 보낸(배송중 아님)' 단품을 그날 명단으로 끌어와 누락을 막는다.
//   (구독은 요일마다 다시 떠서 사라지지 않으므로 이월 대상이 아니다.)

type OverdueOrder = {
  order_type: string;
  ship_date: string | null; // YYYY-MM-DD
  status: string;
};

// 선택일(dateISO) 기준, 이 단품이 '지난 미출고분(이월)'인가.
//   단품 · ship_date < dateISO · 아직 '배송중' 아님.
export function isCarriedOver(o: OverdueOrder, dateISO: string): boolean {
  if (o.order_type !== "단품") return false;
  if (o.ship_date === null) return false;
  if (o.ship_date >= dateISO) return false; // 당일·미래는 이월 아님(YYYY-MM-DD 문자열 비교 = 날짜 비교)
  return o.status !== "배송중";
}

// 발송예정일이 선택일보다 며칠 지났는지(달력 일수). 같은 날·미래·null 은 0.
export function overdueDays(shipDateISO: string | null, dateISO: string): number {
  if (shipDateISO === null) return 0;
  const from = Date.parse(`${shipDateISO}T00:00:00`);
  const to = Date.parse(`${dateISO}T00:00:00`);
  if (Number.isNaN(from) || Number.isNaN(to) || to <= from) return 0;
  return Math.round((to - from) / 86_400_000);
}

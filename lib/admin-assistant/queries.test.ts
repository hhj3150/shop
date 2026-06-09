import { describe, it, expect } from "vitest";
import {
  weekdayOf,
  enumerateDates,
  rosterForDate,
  deliveryRoster,
  productionDemand,
  salesSummary,
  findOrders,
  recruitmentStatus,
  confirmedIds,
  pausedOrderIds,
  canceledOrderIds,
  slotInfoByOrder,
  type OrderLite,
  type ItemLite,
  type SlotLite,
} from "./queries";

// SlotLite 픽스처(권위 게이팅 필드 기본값 포함).
const subSlot = (over: Partial<SlotLite> & { order_id: string }): SlotLite => ({
  delivery_day: "wed",
  status: "활성",
  paused: false,
  started_at: null,
  first_ship_date: null,
  paused_at: null,
  paused_days: 0,
  extended_weeks: 0,
  ...over,
});

// 2026-06-10 = 수요일.
describe("weekdayOf", () => {
  it("평일은 요일키, 주말은 null", () => {
    expect(weekdayOf("2026-06-10")).toBe("wed");
    expect(weekdayOf("2026-06-13")).toBe(null); // 토
    expect(weekdayOf("2026-06-14")).toBe(null); // 일
  });
});

describe("enumerateDates", () => {
  it("from~to 포함, to<from 이면 from 하루", () => {
    expect(enumerateDates("2026-06-10", "2026-06-12")).toEqual(["2026-06-10", "2026-06-11", "2026-06-12"]);
    expect(enumerateDates("2026-06-10", "2026-06-09")).toEqual(["2026-06-10"]);
  });
  it("cap 으로 상한", () => {
    expect(enumerateDates("2026-01-01", "2026-12-31", 5)).toHaveLength(5);
  });
});

const order = (o: Partial<OrderLite> & { id: string }): OrderLite => ({
  order_no: "SY-1",
  status: "입금확인",
  order_type: "구독",
  ship_date: null,
  total_amount: 100000,
  depositor_name: "홍길동",
  ship_name: "홍길동",
  ship_phone: "01012345678",
  ship_postcode: "12345",
  ship_address: "서울시",
  ship_address_detail: "101호",
  created_at: "2026-06-10T00:00:00",
  ...o,
});
const item = (i: Partial<ItemLite> & { order_id: string }): ItemLite => ({
  product_name: "헤이밀크",
  volume: "750mL",
  delivery_day: "wed",
  qty: 3,
  ...i,
});

describe("rosterForDate", () => {
  const orders = [
    order({ id: "A", order_type: "구독", status: "입금확인" }),
    order({ id: "B", order_type: "구독", status: "입금대기" }), // 미확정 → 제외
    order({ id: "C", order_type: "단품", ship_date: "2026-06-10", ship_name: "김단품" }),
  ];
  const items = [
    item({ order_id: "A", delivery_day: "wed", qty: 2 }),
    item({ order_id: "B", delivery_day: "wed", qty: 5 }),
    item({ order_id: "C", delivery_day: null, qty: 1 }),
  ];

  it("확정 정기(수요일)와 단품(ship_date)만 포함, 미확정 제외", () => {
    const rows = rosterForDate("2026-06-10", orders, items, confirmedIds(orders), pausedOrderIds([]));
    const names = rows.map((r) => r.name);
    expect(names).toContain("홍길동"); // A 정기
    expect(names).toContain("김단품"); // C 단품
    expect(names).not.toContain(undefined);
    expect(rows.find((r) => r.name === "홍길동")?.kind).toBe("정기");
    expect(rows.find((r) => r.name === "김단품")?.kind).toBe("단품");
  });

  it("일시정지 구독은 제외", () => {
    const slots: SlotLite[] = [{ order_id: "A", delivery_day: "wed", status: "활성", paused: true }];
    const rows = rosterForDate("2026-06-10", orders, items, confirmedIds(orders), pausedOrderIds(slots));
    expect(rows.map((r) => r.name)).not.toContain("홍길동");
  });

  it("주말은 정기 없음(단품만)", () => {
    const rows = rosterForDate("2026-06-13", orders, items, confirmedIds(orders), pausedOrderIds([]));
    expect(rows.map((r) => r.name)).not.toContain("홍길동");
  });

  it("해지 구독은 제외(admin 로스터와 동일)", () => {
    const slots: SlotLite[] = [subSlot({ order_id: "A", status: "해지" })];
    const rows = rosterForDate(
      "2026-06-10",
      orders,
      items,
      confirmedIds(orders),
      pausedOrderIds(slots),
      slotInfoByOrder(slots)
    );
    expect(rows.map((r) => r.name)).not.toContain("홍길동");
  });
});

// 권위 로스터(buildRosterForDate)와 통일: 시작 전·회차소진·첫배송 공휴일 시프트 반영(과다집계 방지).
describe("rosterForDate — 권위 게이팅", () => {
  const subOrder = order({ id: "A", order_type: "구독", status: "입금확인", block_weeks: 4 });
  const subItem = item({ order_id: "A", delivery_day: "wed", qty: 2 });

  it("시작일(started_at) 이전 날짜는 제외", () => {
    const slots = [subSlot({ order_id: "A", started_at: "2026-06-17" })]; // 시작 미래
    const rows = rosterForDate(
      "2026-06-10",
      [subOrder],
      [subItem],
      confirmedIds([subOrder]),
      pausedOrderIds(slots),
      slotInfoByOrder(slots)
    );
    expect(rows.map((r) => r.name)).not.toContain("홍길동");
  });

  it("회차 소진(종료일 지난 날짜)은 제외", () => {
    const o = order({ id: "A", order_type: "구독", status: "입금확인", block_weeks: 1 });
    const slots = [subSlot({ order_id: "A", started_at: "2026-06-10" })]; // 1회차 → 종료일 06-10
    const rows = rosterForDate(
      "2026-06-17", // 다음 수요일 → 소진
      [o],
      [item({ order_id: "A", delivery_day: "wed" })],
      confirmedIds([o]),
      pausedOrderIds(slots),
      slotInfoByOrder(slots)
    );
    expect(rows.map((r) => r.name)).not.toContain("홍길동");
  });

  it("시작·기간 내 정상 날짜는 포함(대조군)", () => {
    const slots = [subSlot({ order_id: "A", started_at: "2026-06-10" })];
    const rows = rosterForDate(
      "2026-06-10",
      [subOrder],
      [subItem],
      confirmedIds([subOrder]),
      pausedOrderIds(slots),
      slotInfoByOrder(slots)
    );
    expect(rows.map((r) => r.name)).toContain("홍길동");
  });

  it("첫배송 공휴일 시프트: 앵커(수) 당일 제외, 시프트일(목) 포함", () => {
    const slots = [subSlot({ order_id: "A", started_at: "2026-06-10", first_ship_date: "2026-06-11" })];
    const conf = confirmedIds([subOrder]);
    const sbo = slotInfoByOrder(slots);
    const pz = pausedOrderIds(slots);
    expect(
      rosterForDate("2026-06-10", [subOrder], [subItem], conf, pz, sbo).map((r) => r.name)
    ).not.toContain("홍길동"); // 앵커(공휴일) 당일 제외
    expect(
      rosterForDate("2026-06-11", [subOrder], [subItem], conf, pz, sbo).map((r) => r.name)
    ).toContain("홍길동"); // 다음 영업일에 포함
  });
});

describe("canceledOrderIds", () => {
  it("해지 슬롯의 order_id 만 모은다", () => {
    const slots: SlotLite[] = [
      subSlot({ order_id: "A", status: "해지" }),
      subSlot({ order_id: "B", status: "활성" }),
    ];
    expect(canceledOrderIds(slots).has("A")).toBe(true);
    expect(canceledOrderIds(slots).has("B")).toBe(false);
  });
});

describe("deliveryRoster", () => {
  it("기간 내 배송 있는 날짜만 반환", () => {
    const orders = [order({ id: "A", order_type: "구독" })];
    const items = [item({ order_id: "A", delivery_day: "wed", qty: 2 })];
    const days = deliveryRoster(orders, items, [], "2026-06-10", "2026-06-12");
    expect(days).toHaveLength(1);
    expect(days[0].date).toBe("2026-06-10");
    expect(days[0].weekday).toBe("wed");
  });
});

describe("productionDemand", () => {
  it("기간 제품별 합계 — 정기는 요일마다 반복", () => {
    const orders = [order({ id: "A", order_type: "구독" })];
    const items = [item({ order_id: "A", delivery_day: "wed", qty: 4 })];
    // 6/10(수)~6/17(수) = 수요일 2회
    const r = productionDemand(orders, items, [], "2026-06-10", "2026-06-17");
    expect(r.total["헤이밀크 750mL"]).toBe(8);
  });

  it("해지 구독은 생산수요에서 제외", () => {
    const orders = [order({ id: "A", order_type: "구독" })];
    const items = [item({ order_id: "A", delivery_day: "wed", qty: 4 })];
    const slots: SlotLite[] = [{ order_id: "A", delivery_day: "wed", status: "해지", paused: false }];
    const r = productionDemand(orders, items, slots, "2026-06-10", "2026-06-17");
    expect(r.total["헤이밀크 750mL"]).toBeUndefined();
  });
});

describe("salesSummary", () => {
  it("기간 내 확정 주문 건수·매출 합계", () => {
    const orders = [
      order({ id: "A", status: "입금확인", total_amount: 100000, created_at: "2026-06-10T00:00:00" }),
      order({ id: "B", status: "입금대기", total_amount: 50000, created_at: "2026-06-10T00:00:00" }), // 미확정
      order({ id: "C", status: "배송완료", total_amount: 30000, created_at: "2026-06-01T00:00:00" }), // 기간 밖
    ];
    const r = salesSummary(orders, "2026-06-10", "2026-06-10");
    expect(r.count).toBe(1);
    expect(r.revenue).toBe(100000);
  });
});

describe("findOrders", () => {
  const orders = [
    order({ id: "A", ship_name: "우혜원", order_no: "SY-100" }),
    order({ id: "B", ship_name: "문성진", order_no: "SY-200", status: "배송중" }),
  ];
  it("이름·주문번호 부분일치", () => {
    expect(findOrders(orders, { query: "우혜원" }).map((o) => o.order_no)).toEqual(["SY-100"]);
    expect(findOrders(orders, { query: "sy-200" }).map((o) => o.ship_name)).toEqual(["문성진"]);
  });
  it("상태 필터", () => {
    expect(findOrders(orders, { status: "배송중" }).map((o) => o.ship_name)).toEqual(["문성진"]);
  });
});

describe("recruitmentStatus", () => {
  it("요일별 신청·활성 수 + 대기자 수", () => {
    const slots: SlotLite[] = [
      { order_id: "1", delivery_day: "wed", status: "활성", paused: false },
      { order_id: "2", delivery_day: "wed", status: "신청", paused: false },
      { order_id: "3", delivery_day: "mon", status: "활성", paused: false },
      { order_id: "4", delivery_day: "wed", status: "대기", paused: false },
      { order_id: "5", delivery_day: "wed", status: "해지", paused: false },
    ];
    const r = recruitmentStatus(slots);
    expect(r.byDay.wed).toBe(2);
    expect(r.byDay.mon).toBe(1);
    expect(r.waitlist).toBe(1);
  });
});

import { describe, it, expect } from "vitest";
import { splitDemandByKind, buildWeeklyMatrix, type MatrixSlotInput } from "./production-demand";
import type { DeliveryEntry } from "./delivery-roster";
import type { RawBlock } from "./subscription-timeline";
import type { DeliveryDay } from "./cart";

// 테스트용 최소 주문/품목 형태. splitDemandByKind 는 items 와 kind 만 본다.
type O = { id: string };
type I = { product_name: string; volume: string; qty: number };

function entry(
  kind: "정기" | "단품",
  items: I[],
  id = "o"
): DeliveryEntry<O, I> {
  return { order: { id }, items, sig: "", kind };
}

describe("splitDemandByKind", () => {
  it("정기/단품을 제품키별 수량으로 분리한다", () => {
    const entries = [
      entry("정기", [{ product_name: "플레인", volume: "180mL", qty: 2 }], "a"),
      entry("정기", [{ product_name: "플레인", volume: "180mL", qty: 3 }], "b"),
      entry("단품", [{ product_name: "헤이밀크", volume: "750mL", qty: 5 }], "c"),
    ];
    const r = splitDemandByKind(entries);
    expect(r.정기).toEqual({ "플레인 180mL": 5 });
    expect(r.단품).toEqual({ "헤이밀크 750mL": 5 });
  });

  it("한 엔트리에 여러 품목이면 각 제품키로 합산한다", () => {
    const entries = [
      entry("정기", [
        { product_name: "플레인", volume: "500mL", qty: 1 },
        { product_name: "헤이밀크", volume: "180mL", qty: 4 },
      ]),
    ];
    const r = splitDemandByKind(entries);
    expect(r.정기).toEqual({ "플레인 500mL": 1, "헤이밀크 180mL": 4 });
    expect(r.단품).toEqual({});
  });

  it("같은 제품이 정기·단품 양쪽에 있어도 kind별로 따로 센다", () => {
    const entries = [
      entry("정기", [{ product_name: "플레인", volume: "180mL", qty: 2 }], "a"),
      entry("단품", [{ product_name: "플레인", volume: "180mL", qty: 7 }], "b"),
    ];
    const r = splitDemandByKind(entries);
    expect(r.정기).toEqual({ "플레인 180mL": 2 });
    expect(r.단품).toEqual({ "플레인 180mL": 7 });
  });

  it("빈 입력은 두 빈 객체", () => {
    const r = splitDemandByKind([]);
    expect(r.정기).toEqual({});
    expect(r.단품).toEqual({});
  });

  // 회귀 가드: 정기/단품으로 나눠도 제품별 총량은 변하지 않는다(분리는 총합 보존).
  it("정기+단품 합 == kind 무시 전체 제품 합", () => {
    const entries = [
      entry("정기", [{ product_name: "플레인", volume: "180mL", qty: 2 }], "a"),
      entry("단품", [{ product_name: "플레인", volume: "180mL", qty: 7 }], "b"),
      entry("정기", [
        { product_name: "헤이밀크", volume: "750mL", qty: 3 },
        { product_name: "플레인", volume: "500mL", qty: 1 },
      ], "c"),
      entry("단품", [{ product_name: "헤이밀크", volume: "750mL", qty: 4 }], "d"),
    ];
    const r = splitDemandByKind(entries);

    const merged: Record<string, number> = { ...r.정기 };
    for (const [k, v] of Object.entries(r.단품)) merged[k] = (merged[k] ?? 0) + v;

    const naive: Record<string, number> = {};
    for (const e of entries) {
      for (const it of e.items) {
        const key = `${it.product_name} ${it.volume}`;
        naive[key] = (naive[key] ?? 0) + it.qty;
      }
    }
    expect(merged).toEqual(naive);
    expect(merged).toEqual({ "플레인 180mL": 9, "플레인 500mL": 1, "헤이밀크 750mL": 7 });
  });
});

// ── buildWeeklyMatrix (활성 블록 게이팅) ──
//   이번 주 각 요일의 실제 날짜를 받아, 슬롯별 활성 블록 1개만 그 블록 요일 칸에 1회 계상.
//   레거시(단일 블록, 활성 구간 내)는 기존 매트릭스(요일별 확정 품목 합)와 동일.
const WEEK: Record<DeliveryDay, string> = {
  mon: "2026-06-15",
  tue: "2026-06-16",
  wed: "2026-06-17",
  thu: "2026-06-18",
  fri: "2026-06-19",
};

function emptyRow(): Record<DeliveryDay, number> {
  return { mon: 0, tue: 0, wed: 0, thu: 0, fri: 0 };
}

// 시작 2026-06-01(월). 4주 슬롯이면 06-01,06-08,06-15,06-22 발송 → 06-15(3회차) 활성.
function slotInput(over: Partial<MatrixSlotInput>): MatrixSlotInput {
  return {
    startedAt: "2026-06-01",
    status: "활성",
    paused: false,
    pausedAt: null,
    pausedDays: 0,
    blocks: [],
    ...over,
  };
}

const milk: RawBlock = {
  orderId: "o0",
  weeks: 4,
  deliveryDay: "mon",
  shippingPerWeek: 4000,
  items: [{ productName: "우유", volume: "180ml", qty: 1, unitPrice: 3000 }],
};
const yogurt: RawBlock = {
  orderId: "o1",
  weeks: 4,
  deliveryDay: "tue",
  shippingPerWeek: 4000,
  items: [{ productName: "요거트", volume: "85g", qty: 2, unitPrice: 2000 }],
};

describe("buildWeeklyMatrix", () => {
  it("레거시(단일 블록) 슬롯은 기존 매트릭스와 동일(요일 칸 1회 계상)", () => {
    const m = buildWeeklyMatrix([slotInput({ blocks: [milk] })], ["우유 180ml"], WEEK);
    expect(m["우유 180ml"]).toEqual({ ...emptyRow(), mon: 1 });
  });

  it("다블록 슬롯은 이중계상 안 함 — 활성 블록만 그 요일에 1회", () => {
    // 06-15 = 3회차 → 블록0(우유·월) 활성. 블록1(요거트·화)은 5회차부터 → 미계상.
    const m = buildWeeklyMatrix(
      [slotInput({ blocks: [milk, yogurt] })],
      ["우유 180ml", "요거트 85g"],
      WEEK
    );
    expect(m["우유 180ml"]).toEqual({ ...emptyRow(), mon: 1 });
    expect(m["요거트 85g"]).toEqual(emptyRow()); // 블록1 미활성 → 0
  });

  it("블록1 활성 주에는 블록1만 계상(블록0 미계상)", () => {
    const laterWeek: Record<DeliveryDay, string> = {
      mon: "2026-07-13",
      tue: "2026-07-14",
      wed: "2026-07-15",
      thu: "2026-07-16",
      fri: "2026-07-17",
    };
    // 07-14(화) = 7회차 → 블록1(요거트·화) 활성.
    const m = buildWeeklyMatrix(
      [slotInput({ blocks: [milk, yogurt] })],
      ["우유 180ml", "요거트 85g"],
      laterWeek
    );
    expect(m["요거트 85g"]).toEqual({ ...emptyRow(), tue: 2 });
    expect(m["우유 180ml"]).toEqual(emptyRow());
  });

  it("해지·정지 슬롯은 계상하지 않는다", () => {
    const canceled = buildWeeklyMatrix([slotInput({ blocks: [milk], status: "해지" })], ["우유 180ml"], WEEK);
    expect(canceled["우유 180ml"]).toEqual(emptyRow());
    const paused = buildWeeklyMatrix([slotInput({ blocks: [milk], paused: true })], ["우유 180ml"], WEEK);
    expect(paused["우유 180ml"]).toEqual(emptyRow());
  });

  it("소진된 슬롯은 활성 블록 없음 → 계상 안 함", () => {
    const afterWeek: Record<DeliveryDay, string> = {
      mon: "2026-06-29",
      tue: "2026-06-30",
      wed: "2026-07-01",
      thu: "2026-07-02",
      fri: "2026-07-03",
    };
    const m = buildWeeklyMatrix([slotInput({ blocks: [milk] })], ["우유 180ml"], afterWeek);
    expect(m["우유 180ml"]).toEqual(emptyRow());
  });
});

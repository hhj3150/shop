import { describe, it, expect } from "vitest";
import { computeDeliveryStats, type ShipmentStatRow } from "@/lib/delivery-stats";

const asOfISO = "2026-06-22T00:00:00Z";

describe("computeDeliveryStats", () => {
  it("발송·배송완료·진행중·완료율을 센다", () => {
    const rows: ShipmentStatRow[] = [
      { shipped_at: "2026-06-10T00:00:00Z", delivered_at: "2026-06-11T00:00:00Z", courier: "cj" },
      { shipped_at: "2026-06-12T00:00:00Z", delivered_at: "2026-06-14T00:00:00Z", courier: "cj" },
      { shipped_at: "2026-06-20T00:00:00Z", delivered_at: null, courier: "logen" }, // 진행중(2일 전)
      { shipped_at: null, delivered_at: null, courier: "cj" }, // 미출고 → 집계 제외
    ];
    const s = computeDeliveryStats(rows, { asOfISO });
    expect(s.shipped).toBe(3);
    expect(s.delivered).toBe(2);
    expect(s.inTransit).toBe(1);
    expect(s.deliveredRate).toBe(67); // 2/3
  });

  it("리드타임 평균·중앙값(발송→도착)을 일 단위로 계산한다", () => {
    const rows: ShipmentStatRow[] = [
      { shipped_at: "2026-06-01T00:00:00Z", delivered_at: "2026-06-02T00:00:00Z", courier: "cj" }, // 1일
      { shipped_at: "2026-06-01T00:00:00Z", delivered_at: "2026-06-03T00:00:00Z", courier: "cj" }, // 2일
      { shipped_at: "2026-06-01T00:00:00Z", delivered_at: "2026-06-07T00:00:00Z", courier: "cj" }, // 6일
    ];
    const s = computeDeliveryStats(rows, { asOfISO });
    expect(s.avgLeadDays).toBe(3); // (1+2+6)/3
    expect(s.medianLeadDays).toBe(2); // 중앙값
  });

  it("미도착 + 출고 후 임계일 초과를 지연으로 센다", () => {
    const rows: ShipmentStatRow[] = [
      { shipped_at: "2026-06-10T00:00:00Z", delivered_at: null, courier: "cj" }, // 12일 경과 → 지연
      { shipped_at: "2026-06-21T00:00:00Z", delivered_at: null, courier: "cj" }, // 1일 경과 → 정상
    ];
    const s = computeDeliveryStats(rows, { asOfISO, overdueDays: 3 });
    expect(s.overdue).toBe(1);
  });

  it("택배사별로 건수·평균 리드타임을 분리하고 건수 내림차순 정렬한다", () => {
    const rows: ShipmentStatRow[] = [
      { shipped_at: "2026-06-01T00:00:00Z", delivered_at: "2026-06-03T00:00:00Z", courier: "cj" }, // 2일
      { shipped_at: "2026-06-01T00:00:00Z", delivered_at: "2026-06-05T00:00:00Z", courier: "cj" }, // 4일
      { shipped_at: "2026-06-01T00:00:00Z", delivered_at: "2026-06-02T00:00:00Z", courier: "logen" }, // 1일
    ];
    const s = computeDeliveryStats(rows, { asOfISO });
    expect(s.byCourier[0].courier).toBe("cj"); // 건수 더 많음
    expect(s.byCourier[0].avgLeadDays).toBe(3); // (2+4)/2
    expect(s.byCourier[1].courier).toBe("logen");
    expect(s.byCourier[1].avgLeadDays).toBe(1);
  });

  it("빈 입력은 0·null 로 안전하게 반환한다", () => {
    const s = computeDeliveryStats([], { asOfISO });
    expect(s.shipped).toBe(0);
    expect(s.deliveredRate).toBe(0);
    expect(s.avgLeadDays).toBeNull();
    expect(s.byCourier).toEqual([]);
  });
});

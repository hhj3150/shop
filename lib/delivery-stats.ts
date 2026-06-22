// 배송 통계 — shipment_log(회차별 배송 레코드)에서 발송/배송완료 건수, 리드타임(발송→도착),
//   택배사별 분포, 지연(미도착 N일+) 을 집계하는 순수 로직. 관리자 배송 통계 패널의 SSOT.
//   외부 시계 비의존: '현재'(asOfISO)를 인자로 받아 결정적 — 테스트·서버 모두 동일 결과.

export type ShipmentStatRow = {
  shipped_at: string | null; // 출고 시각(ISO)
  delivered_at: string | null; // 도착확인 시각(ISO)
  courier: string | null; // 택배사 id
};

export type CourierStat = {
  courier: string; // 택배사 id ('' = 미지정)
  shipped: number;
  delivered: number;
  avgLeadDays: number | null; // 그 택배사 배송완료 건의 평균 리드타임(일)
};

export type DeliveryStats = {
  shipped: number; // 출고 건수(shipped_at 있음)
  delivered: number; // 배송완료 건수(delivered_at 있음)
  inTransit: number; // 출고됐으나 미도착
  deliveredRate: number; // 배송완료율(0~100, 정수 반올림)
  avgLeadDays: number | null; // 전체 평균 리드타임(일, 소수1)
  medianLeadDays: number | null; // 중앙값 리드타임(일, 소수1) — 이상치 완화
  overdue: number; // 미도착 + 출고 후 overdueDays 초과
  byCourier: CourierStat[]; // 택배사별(건수 내림차순)
};

const MS_PER_DAY = 24 * 3600 * 1000;

function leadDays(shippedAt: string, deliveredAt: string): number | null {
  const s = Date.parse(shippedAt);
  const d = Date.parse(deliveredAt);
  if (Number.isNaN(s) || Number.isNaN(d) || d < s) return null;
  return (d - s) / MS_PER_DAY;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function mean(xs: number[]): number | null {
  if (xs.length === 0) return null;
  return round1(xs.reduce((a, b) => a + b, 0) / xs.length);
}

function median(xs: number[]): number | null {
  if (xs.length === 0) return null;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  const m = s.length % 2 === 0 ? (s[mid - 1] + s[mid]) / 2 : s[mid];
  return round1(m);
}

// rows = 기간 내 shipment_log 회차들. overdueDays = 미도착 지연 임계(기본 3일).
export function computeDeliveryStats(
  rows: readonly ShipmentStatRow[],
  opts: { asOfISO: string; overdueDays?: number }
): DeliveryStats {
  const overdueDaysThreshold = opts.overdueDays ?? 3;
  const asOf = Date.parse(opts.asOfISO);

  const shippedRows = rows.filter((r) => r.shipped_at);
  const shipped = shippedRows.length;

  const leads: number[] = [];
  let delivered = 0;
  let overdue = 0;

  // 택배사별 누적기.
  const courierMap = new Map<string, { shipped: number; delivered: number; leads: number[] }>();
  const bump = (id: string) => {
    let c = courierMap.get(id);
    if (!c) {
      c = { shipped: 0, delivered: 0, leads: [] };
      courierMap.set(id, c);
    }
    return c;
  };

  for (const r of shippedRows) {
    const id = r.courier ?? "";
    const c = bump(id);
    c.shipped += 1;

    if (r.delivered_at) {
      delivered += 1;
      c.delivered += 1;
      const ld = leadDays(r.shipped_at as string, r.delivered_at);
      if (ld != null) {
        leads.push(ld);
        c.leads.push(ld);
      }
    } else if (!Number.isNaN(asOf)) {
      // 미도착: 출고 후 임계일 초과면 지연.
      const s = Date.parse(r.shipped_at as string);
      if (!Number.isNaN(s) && (asOf - s) / MS_PER_DAY > overdueDaysThreshold) overdue += 1;
    }
  }

  const byCourier: CourierStat[] = [...courierMap.entries()]
    .map(([courier, c]) => ({
      courier,
      shipped: c.shipped,
      delivered: c.delivered,
      avgLeadDays: mean(c.leads),
    }))
    .sort((a, b) => b.shipped - a.shipped || a.courier.localeCompare(b.courier));

  return {
    shipped,
    delivered,
    inTransit: shipped - delivered,
    deliveredRate: shipped > 0 ? Math.round((delivered / shipped) * 100) : 0,
    avgLeadDays: mean(leads),
    medianLeadDays: median(leads),
    overdue,
    byCourier,
  };
}

"use client";

// 관리자: 방문수령 전용 화면 — 택배 발송 대상이 아닌 '목장 방문수령' 주문만 모아
//   누가 언제 무엇을 받으러 오는지(구독 회차 포함) 한눈에 보여 준다.
//   배송 탭(DispatchPanel)에서 방문수령은 제외되므로, 수령 담당자용 별도 명단이 필요하다.
import { useMemo } from "react";
import { DELIVERY_DAY_LABEL, type DeliveryDay } from "@/lib/cart";
import { computeSchedule } from "@/lib/subscription-schedule";
import { downloadXlsx } from "@/lib/xlsx-export";

type PickupOrder = {
  id: string;
  order_no: string;
  status: string;
  order_type: string; // '구독' | '단품'
  block_weeks: number | null;
  renews_slot_id: number | null; // 연장 결제(유령행)면 제외
  delivery_method: string | null; // '방문수령'만 대상
  ship_date: string | null; // 단품 수령 예정일
  ship_name: string;
  ship_phone: string;
  created_at: string;
};
type PickupItem = {
  product_name: string;
  volume: string;
  qty: number;
  delivery_day: DeliveryDay | null;
};
type PickupSlot = {
  order_id: string | null;
  started_at: string | null;
  first_ship_date: string | null;
  status: string;
  paused: boolean;
  paused_at: string | null;
  paused_days: number;
  extended_weeks: number | null;
  delivery_day: DeliveryDay | null;
};

// 결제 후(취소·미입금 제외) 상태만 명단에 노출.
const SHOW_STATUS = ["입금확인", "배송준비", "배송중", "배송완료"];

function fmtDate(iso: string | null): string {
  if (!iso) return "-";
  const [, mo, da] = iso.slice(0, 10).split("-");
  return mo && da ? `${Number(mo)}월 ${Number(da)}일` : iso;
}

type PickupRow = {
  id: string;
  name: string;
  phone: string;
  productSummary: string;
  dayLabel: string;
  roundLabel: string; // 구독: "2/8회" / 단품: "단품"
  pickupDate: string; // 수령 예정(다음 회차) — 정지·완료 표기 포함
  pickupSort: string; // 정렬용(YYYY-MM-DD, 없으면 빈값→뒤로)
  status: string;
};

export function PickupPanel({
  orders,
  itemsByOrder,
  slots = [],
}: {
  orders: PickupOrder[];
  itemsByOrder: Map<string, PickupItem[]>;
  slots?: PickupSlot[];
}) {
  // 주문 → 슬롯(회차·요일 판정). 연장은 원주문을 가리키므로 order_id 로 매핑.
  const slotByOrder = useMemo(() => {
    const m = new Map<string, PickupSlot>();
    for (const s of slots) if (s.order_id) m.set(s.order_id, s);
    return m;
  }, [slots]);

  const rows = useMemo<PickupRow[]>(() => {
    const out: PickupRow[] = [];
    for (const o of orders) {
      if (o.delivery_method !== "방문수령") continue; // 방문수령만
      if (o.renews_slot_id != null) continue; // 연장 결제 유령행 제외(수령은 원주문에서)
      if (!SHOW_STATUS.includes(o.status)) continue; // 취소·미입금 제외

      const items = itemsByOrder.get(o.id) ?? [];
      const productSummary = items
        .map(
          (it) =>
            `${it.product_name} ${it.volume}${it.qty > 1 ? ` ${it.qty}개` : ""}`
        )
        .join(", ");

      const isOnce = o.order_type === "단품";
      let dayLabel = "-";
      let roundLabel = "단품";
      let pickupDate = "-";
      let pickupSort = "";

      if (isOnce) {
        pickupDate = fmtDate(o.ship_date);
        pickupSort = o.ship_date?.slice(0, 10) ?? "";
      } else {
        const slot = slotByOrder.get(o.id);
        const day = slot?.delivery_day ?? items[0]?.delivery_day ?? null;
        dayLabel = day ? DELIVERY_DAY_LABEL[day] : "-";
        if (slot && slot.started_at) {
          const total = (o.block_weeks ?? 0) + (slot.extended_weeks ?? 0);
          const sch = computeSchedule({
            startedAt: slot.started_at,
            firstShipDate: slot.first_ship_date,
            totalWeeks: total,
            paused: slot.paused,
            pausedAt: slot.paused_at,
            pausedDays: slot.paused_days,
          });
          roundLabel = total > 0 ? `${sch.delivered}/${total}회` : "-";
          if (sch.paused) {
            pickupDate = "정지 중";
          } else if (sch.done) {
            pickupDate = "완료";
          } else {
            pickupDate = fmtDate(sch.nextDate);
            pickupSort = sch.nextDate?.slice(0, 10) ?? "";
          }
        } else {
          roundLabel = "시작 전";
          pickupDate = "입금확인 후";
        }
      }

      out.push({
        id: o.id,
        name: o.ship_name || "고객",
        phone: o.ship_phone ?? "",
        productSummary,
        dayLabel,
        roundLabel,
        pickupDate,
        pickupSort,
        status: o.status,
      });
    }
    // 수령 예정일 이른 순(미정·완료는 뒤로), 그다음 이름.
    out.sort((a, b) => {
      const ak = a.pickupSort || "9999";
      const bk = b.pickupSort || "9999";
      if (ak !== bk) return ak < bk ? -1 : 1;
      return a.name.localeCompare(b.name, "ko");
    });
    return out;
  }, [orders, itemsByOrder, slotByOrder]);

  async function exportXlsx() {
    const header = ["이름", "연락처", "제품·수량", "배송요일", "회차", "수령예정일", "상태"];
    const body = rows.map((r) => [
      r.name,
      r.phone,
      r.productSummary,
      r.dayLabel,
      r.roundLabel,
      r.pickupDate,
      r.status,
    ]);
    await downloadXlsx(`방문수령명단_${todayISO()}.xlsx`, [header, ...body], "방문수령");
  }

  return (
    <div className="mt-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="font-serif-kr text-lg text-ink">방문수령 명단</h2>
          <p className="mt-1 text-[13px] text-mute">
            목장에서 직접 받으시는 분들이에요. 택배 발송 대상이 아닙니다. (총 {rows.length}명)
          </p>
        </div>
        <button
          onClick={exportXlsx}
          disabled={rows.length === 0}
          className="shrink-0 rounded-full border border-line px-4 py-2 text-[13px] text-ink-soft transition-colors hover:border-gold hover:text-gold disabled:opacity-40"
        >
          📋 방문수령 명단 엑셀
        </button>
      </div>

      {rows.length === 0 ? (
        <p className="mt-6 rounded-2xl border border-line bg-cream px-5 py-8 text-center text-[14px] text-mute">
          방문수령 주문이 아직 없어요.
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto rounded-2xl border border-line">
          <table className="w-full min-w-[760px] border-collapse text-[14px]">
            <thead>
              <tr className="border-b border-line bg-paper-2 text-left text-[12px] text-mute">
                <th className="px-4 py-3 font-medium">이름</th>
                <th className="px-4 py-3 font-medium">연락처</th>
                <th className="px-4 py-3 font-medium">제품·수량</th>
                <th className="px-4 py-3 font-medium">배송요일</th>
                <th className="px-4 py-3 font-medium">회차</th>
                <th className="px-4 py-3 font-medium">수령 예정일</th>
                <th className="px-4 py-3 font-medium">상태</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-line/60 last:border-0">
                  <td className="px-4 py-3 text-ink">{r.name}</td>
                  <td className="px-4 py-3 tabular-nums text-ink-soft">{r.phone}</td>
                  <td className="px-4 py-3 text-ink-soft">{r.productSummary}</td>
                  <td className="px-4 py-3 text-ink-soft">{r.dayLabel}</td>
                  <td className="px-4 py-3 tabular-nums text-ink">{r.roundLabel}</td>
                  <td className="px-4 py-3 text-ink">{r.pickupDate}</td>
                  <td className="px-4 py-3">
                    <span className="rounded-full bg-ink/5 px-2.5 py-1 text-[12px] text-ink-soft">
                      {r.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function todayISO(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

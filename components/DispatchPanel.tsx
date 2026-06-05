"use client";

// 관리자: 배송 일괄처리 — 결제완료(입금확인 이후) 주문을 한 화면에서 모아
//   택배사·송장번호를 입력하고 상태를 일괄 전환한다.
//   단품은 발송예정일(ship_date), 구독은 요일(delivery_day)로 날짜 필터.
import { useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { notify } from "@/lib/notify";
import { COURIERS, COURIER_IDS } from "@/lib/couriers";
import { DELIVERY_DAY_LABEL, type DeliveryDay } from "@/lib/cart";

// 배송 처리에 필요한 최소 주문 필드(관리자 페이지 OrderRow 의 부분집합).
type DispatchOrder = {
  id: string;
  order_no: string;
  status: string;
  order_type: string;
  ship_date: string | null;
  ship_name: string;
  ship_phone: string;
  ship_postcode: string | null;
  ship_address: string;
  ship_address_detail: string | null;
  courier: string | null;
  tracking_no: string | null;
  shipped_at: string | null;
};

type DispatchItem = {
  product_name: string;
  volume: string;
  qty: number;
  delivery_day: DeliveryDay | null;
};

// 결제 후 배송 대상 상태(완료·취소·미입금 제외).
const SHIPPABLE = ["입금확인", "배송준비", "배송중"];
const WEEKDAY: readonly (DeliveryDay | null)[] = [
  null, // 일
  "mon",
  "tue",
  "wed",
  "thu",
  "fri",
  null, // 토
];

function todayISO(): string {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 10);
}

// 엑셀(한글) 호환 CSV 다운로드 — UTF-8 BOM 포함.
function downloadCsv(filename: string, rows: string[][]) {
  const csv = rows
    .map((r) => r.map((c) => `"${String(c ?? "").replace(/"/g, '""')}"`).join(","))
    .join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function DispatchPanel({
  orders,
  itemsByOrder,
  onReload,
}: {
  orders: DispatchOrder[];
  itemsByOrder: Map<string, DispatchItem[]>;
  onReload: () => Promise<void> | void;
}) {
  const [date, setDate] = useState(todayISO());
  const [useDateFilter, setUseDateFilter] = useState(true);
  const [courier, setCourier] = useState<string>("cj");
  const [tracking, setTracking] = useState<Record<string, string>>({});
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 선택 날짜의 요일(구독 매칭용). 주말이면 null → 구독은 매칭 안 됨.
  const dayOfDate = useMemo<DeliveryDay | null>(() => {
    const d = new Date(`${date}T00:00:00`);
    return WEEKDAY[d.getDay()] ?? null;
  }, [date]);

  // 배송 큐 — 배송 가능 상태만, 날짜 필터 적용 시 단품=ship_date / 구독=요일 일치.
  const queue = useMemo(() => {
    return orders.filter((o) => {
      if (!SHIPPABLE.includes(o.status)) return false;
      if (!useDateFilter) return true;
      if (o.order_type === "단품") return o.ship_date === date;
      const its = itemsByOrder.get(o.id) ?? [];
      return dayOfDate !== null && its.some((it) => it.delivery_day === dayOfDate);
    });
  }, [orders, itemsByOrder, useDateFilter, date, dayOfDate]);

  const allSelected = queue.length > 0 && queue.every((o) => selected.has(o.id));

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected(allSelected ? new Set() : new Set(queue.map((o) => o.id)));
  }

  function trackingOf(o: DispatchOrder): string {
    return tracking[o.id] ?? o.tracking_no ?? "";
  }

  // 제품을 4개 칸으로 분리: 우유180 / 우유750 / 요거트180 / 요거트500.
  function productBucket(name: string, volume: string): number {
    const yog = name.includes("요거트");
    const v = volume.replace(/[^0-9]/g, "");
    if (yog && v === "180") return 2;
    if (yog && v === "500") return 3;
    if (!yog && v === "180") return 0;
    if (!yog && v === "750") return 1;
    return -1;
  }

  // 배송 담당자용 발송 명단 엑셀 — 제품별 수량 칸 + 합계 행(빠뜨림 방지). 현재 목록(queue) 기준.
  function exportDispatchCsv() {
    const PCOLS = ["우유 180", "우유 750", "요거트 180", "요거트 500"];
    const header = [
      "발송일", "이름", "연락처", "구분", "배송요일", "우편번호", "주소", "상세주소",
      ...PCOLS, "택배사", "송장번호", "소득공 발행일", "상태",
    ];
    const rows: string[][] = [header];
    const totals = [0, 0, 0, 0];
    for (const o of queue) {
      const its = itemsByOrder.get(o.id) ?? [];
      const q = [0, 0, 0, 0];
      let day = "";
      for (const it of its) {
        const b = productBucket(it.product_name, it.volume);
        if (b >= 0) q[b] += it.qty;
        if (it.delivery_day) day = DELIVERY_DAY_LABEL[it.delivery_day];
      }
      for (let i = 0; i < 4; i++) totals[i] += q[i];
      const isOnce = o.order_type === "단품";
      const courierLabel = o.courier ? COURIERS[o.courier]?.label ?? o.courier : "";
      rows.push([
        o.ship_date ?? (useDateFilter ? date : ""),
        o.ship_name,
        o.ship_phone,
        isOnce ? "단품" : "구독",
        day || (isOnce ? "단품" : ""),
        o.ship_postcode ?? "",
        o.ship_address,
        o.ship_address_detail ?? "",
        q[0] ? String(q[0]) : "",
        q[1] ? String(q[1]) : "",
        q[2] ? String(q[2]) : "",
        q[3] ? String(q[3]) : "",
        courierLabel,
        trackingOf(o),
        "", // 소득공 발행일 — 담당자 기입용
        o.status,
      ]);
    }
    // 합계 행
    rows.push([
      "합계", "", "", "", "", "", "", "",
      String(totals[0]), String(totals[1]), String(totals[2]), String(totals[3]),
      "", "", "", `${queue.length}건`,
    ]);
    const tag = useDateFilter ? date : "전체";
    downloadCsv(`발송명단_${tag}.csv`, rows);
  }

  // 선택분 일괄 발송: 송장 입력된 건만 배송중 전환 + 발송일·택배사 기록 + 알림.
  async function bulkShip() {
    const targets = queue.filter((o) => selected.has(o.id) && trackingOf(o).trim());
    if (targets.length === 0) {
      setError("송장번호가 입력된 선택 주문이 없습니다.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const sb = getSupabase();
      await Promise.all(
        targets.map((o) =>
          sb
            .from("orders")
            .update({
              courier,
              tracking_no: trackingOf(o).trim(),
              shipped_at: o.shipped_at ?? date,
              status: "배송중",
            })
            .eq("id", o.id)
        )
      );
      for (const o of targets) void notify({ kind: "shipped", orderId: o.id });
      setSelected(new Set());
      await onReload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "일괄 발송 처리 실패");
    } finally {
      setBusy(false);
    }
  }

  // 선택분 상태 일괄 전환(배송준비 / 배송완료).
  async function bulkStatus(status: string) {
    const targets = queue.filter((o) => selected.has(o.id));
    if (targets.length === 0) {
      setError("선택된 주문이 없습니다.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const sb = getSupabase();
      await Promise.all(
        targets.map((o) => sb.from("orders").update({ status }).eq("id", o.id))
      );
      setSelected(new Set());
      await onReload();
    } catch (e) {
      setError(e instanceof Error ? e.message : "상태 전환 실패");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif-kr text-lg text-ink">배송 일괄처리</h2>
        <div className="flex items-center gap-3 no-print">
          <span className="text-[12.5px] text-mute">
            배송 대상 {queue.length}건 · 선택 {selected.size}건
          </span>
          {queue.length > 0 && (
            <button
              type="button"
              onClick={exportDispatchCsv}
              className="rounded-full border border-gold/50 bg-gold/10 px-3.5 py-1.5 text-[13px] font-semibold text-gold-deep transition-colors hover:bg-gold/20"
            >
              📋 발송 명단 엑셀
            </button>
          )}
        </div>
      </div>

      {/* 필터 + 일괄 도구 */}
      <div className="mt-4 flex flex-wrap items-center gap-2 rounded-2xl border border-line bg-paper p-3 no-print">
        <label className="flex items-center gap-1.5 text-[13px] text-ink-soft">
          <input
            type="checkbox"
            checked={useDateFilter}
            onChange={(e) => setUseDateFilter(e.target.checked)}
          />
          날짜 필터
        </label>
        <input
          type="date"
          value={date}
          disabled={!useDateFilter}
          onChange={(e) => setDate(e.target.value)}
          className="rounded-lg border border-line bg-cream px-2.5 py-1.5 text-[13px] text-ink disabled:opacity-40"
        />
        <span className="mx-1 h-5 w-px bg-line" />
        <select
          value={courier}
          onChange={(e) => setCourier(e.target.value)}
          className="rounded-lg border border-line bg-cream px-2.5 py-1.5 text-[13px] text-ink"
        >
          {COURIER_IDS.map((id) => (
            <option key={id} value={id}>
              {COURIERS[id].label}
            </option>
          ))}
        </select>
        <button
          onClick={bulkShip}
          disabled={busy || selected.size === 0}
          className="rounded-lg bg-ink px-3 py-1.5 text-[13px] text-cream transition-colors hover:bg-gold-deep disabled:opacity-30"
        >
          선택 발송(배송중)
        </button>
        <button
          onClick={() => bulkStatus("배송준비")}
          disabled={busy || selected.size === 0}
          className="rounded-lg border border-line px-3 py-1.5 text-[13px] text-ink-soft transition-colors enabled:hover:border-gold enabled:hover:text-gold disabled:opacity-30"
        >
          배송준비
        </button>
        <button
          onClick={() => bulkStatus("배송완료")}
          disabled={busy || selected.size === 0}
          className="rounded-lg border border-line px-3 py-1.5 text-[13px] text-ink-soft transition-colors enabled:hover:border-gold enabled:hover:text-gold disabled:opacity-30"
        >
          배송완료
        </button>
      </div>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-600">
          {error}
        </p>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[900px] border-collapse text-[14px]">
          <thead>
            <tr className="border-b border-line text-left text-[12.5px] text-mute">
              <th className="py-2.5 pr-3">
                <input type="checkbox" checked={allSelected} onChange={toggleAll} />
              </th>
              <th className="py-2.5 pr-3 font-medium">주문번호</th>
              <th className="py-2.5 pr-3 font-medium">받는 분</th>
              <th className="py-2.5 pr-3 font-medium">품목</th>
              <th className="py-2.5 pr-3 font-medium">배송지</th>
              <th className="py-2.5 pr-3 font-medium">상태</th>
              <th className="py-2.5 font-medium">송장번호</th>
            </tr>
          </thead>
          <tbody>
            {queue.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-[14px] text-mute">
                  배송 대상 주문이 없습니다.
                </td>
              </tr>
            ) : (
              queue.map((o) => {
                const its = itemsByOrder.get(o.id) ?? [];
                return (
                  <tr key={o.id} className="border-b border-line/70 align-top">
                    <td className="py-3 pr-3">
                      <input
                        type="checkbox"
                        checked={selected.has(o.id)}
                        onChange={() => toggle(o.id)}
                      />
                    </td>
                    <td className="py-3 pr-3">
                      <p className="tabular-nums text-ink">{o.order_no}</p>
                      <p className="text-[12px] text-mute">
                        {o.order_type}
                        {o.order_type === "단품" && o.ship_date
                          ? ` · ${o.ship_date}`
                          : ""}
                      </p>
                    </td>
                    <td className="py-3 pr-3">
                      <p className="text-ink">{o.ship_name}</p>
                      <p className="text-[12px] tabular-nums text-mute">{o.ship_phone}</p>
                    </td>
                    <td className="py-3 pr-3 text-[13px] text-ink-soft">
                      {its.length === 0 ? (
                        <span className="text-mute">—</span>
                      ) : (
                        <ul className="space-y-0.5">
                          {its.map((it, idx) => (
                            <li key={idx}>
                              {it.volume}
                              {it.delivery_day
                                ? ` (${DELIVERY_DAY_LABEL[it.delivery_day].charAt(0)})`
                                : ""}{" "}
                              ×{it.qty}
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="py-3 pr-3 text-[12.5px] text-ink-soft">
                      {o.ship_postcode ? `(${o.ship_postcode}) ` : ""}
                      {o.ship_address}
                      {o.ship_address_detail ? ` ${o.ship_address_detail}` : ""}
                    </td>
                    <td className="py-3 pr-3 text-[13px] text-gold-deep">{o.status}</td>
                    <td className="py-3">
                      <input
                        type="text"
                        value={trackingOf(o)}
                        onChange={(e) =>
                          setTracking((prev) => ({ ...prev, [o.id]: e.target.value }))
                        }
                        placeholder="송장번호"
                        className="w-36 rounded-lg border border-line bg-cream px-2.5 py-1.5 text-[13px] tabular-nums text-ink outline-none focus:border-gold"
                      />
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-[12.5px] text-mute">
        ※ ‘선택 발송’은 송장번호가 입력된 주문만 배송중으로 전환하고 발송 알림을 보냅니다.
        택배사는 선택분 전체에 동일 적용됩니다.
      </p>
    </section>
  );
}

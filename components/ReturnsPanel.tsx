"use client";

// 관리자: 환불/교환 워크플로 — 주문에 대한 환불/교환을 접수하고 상태를 처리한다.
//   기록은 order_returns 원장. 실제 송금/재배송은 수기 처리하고 여기서는 상태를 추적.
import { useEffect, useMemo, useState } from "react";
import { formatKRW } from "@/lib/products";
import {
  loadReturns,
  createReturn,
  updateReturn,
  RETURN_STATUSES,
  type OrderReturn,
  type ReturnStatus,
  type ReturnType,
} from "@/lib/returns";
import { refundWarnings, REFUND_WARNING_LABEL } from "@/lib/refund-validate";

// 접수 대상 주문(드롭다운)용 최소 필드.
type ReturnableOrder = {
  id: string;
  order_no: string;
  ship_name: string;
  total_amount: number;
};

const STATUS_TONE: Record<ReturnStatus, string> = {
  접수: "bg-sky-100 text-sky-700",
  승인: "bg-amber-100 text-amber-700",
  완료: "bg-emerald-100 text-emerald-700",
  반려: "bg-ink/10 text-mute",
};

export function ReturnsPanel({ orders }: { orders: ReturnableOrder[] }) {
  const [returns, setReturns] = useState<OrderReturn[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 접수 폼 상태.
  const [orderId, setOrderId] = useState("");
  const [type, setType] = useState<ReturnType>("환불");
  const [reason, setReason] = useState("");
  const [amount, setAmount] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const orderById = useMemo(
    () => new Map(orders.map((o) => [o.id, o])),
    [orders]
  );

  // 핸들러(접수·상태변경)에서 재조회할 때 사용. 초기 로드는 effect 안에서 직접 한다.
  async function refresh() {
    try {
      setReturns(await loadReturns());
    } catch (e) {
      setError(e instanceof Error ? e.message : "불러오기 실패");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rows = await loadReturns();
        if (alive) setReturns(rows);
      } catch (e) {
        if (alive) setError(e instanceof Error ? e.message : "불러오기 실패");
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const counts = useMemo(() => {
    const open = returns.filter((r) => r.status === "접수" || r.status === "승인").length;
    const refundDue = returns
      .filter((r) => r.type === "환불" && r.status !== "완료" && r.status !== "반려")
      .reduce((s, r) => s + r.amount, 0);
    return { open, refundDue };
  }, [returns]);

  async function handleCreate() {
    if (!orderId) {
      setError("주문을 선택해 주세요.");
      return;
    }
    // 실수 방지: 오타로 인한 과다 환불(주문금액 초과)·환불 금액 누락(0원)을 사전에 확인한다.
    const orderTotal = orderById.get(orderId)?.total_amount ?? 0;
    const warnings = refundWarnings({ type, amount: Number(amount) || 0, orderTotal });
    if (warnings.length > 0) {
      const lines = warnings.map((w) => `· ${REFUND_WARNING_LABEL[w]}`).join("\n");
      if (!window.confirm(`${lines}\n\n그대로 접수할까요?`)) return;
    }
    setSubmitting(true);
    setError(null);
    try {
      await createReturn(orderId, type, reason, Number(amount) || 0);
      setOrderId("");
      setReason("");
      setAmount("");
      setType("환불");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "접수 실패");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif-kr text-lg text-ink">환불·교환</h2>
        <div className="flex gap-2 text-[12.5px]">
          <span className="rounded-full bg-sky-100 px-2.5 py-1 text-sky-700">
            처리 대기 {counts.open}
          </span>
          <span className="rounded-full bg-ink/5 px-2.5 py-1 text-ink-soft">
            환불 예정 {formatKRW(counts.refundDue)}
          </span>
        </div>
      </div>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-600">
          {error}
        </p>
      )}

      {/* 접수 폼 */}
      <div className="mt-4 flex flex-wrap items-end gap-2 rounded-2xl border border-line bg-paper p-3 no-print">
        <label className="flex flex-col gap-1 text-[12px] text-mute">
          주문
          <select
            value={orderId}
            onChange={(e) => setOrderId(e.target.value)}
            className="rounded-lg border border-line bg-cream px-2.5 py-1.5 text-[13px] text-ink"
          >
            <option value="">주문 선택…</option>
            {orders.map((o) => (
              <option key={o.id} value={o.id}>
                {o.order_no} · {o.ship_name} · {formatKRW(o.total_amount)}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-mute">
          유형
          <select
            value={type}
            onChange={(e) => setType(e.target.value as ReturnType)}
            className="rounded-lg border border-line bg-cream px-2.5 py-1.5 text-[13px] text-ink"
          >
            <option value="환불">환불</option>
            <option value="교환">교환</option>
          </select>
        </label>
        <label className="flex flex-col gap-1 text-[12px] text-mute">
          환불금액
          <input
            type="number"
            min={0}
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            placeholder="0"
            className="w-28 rounded-lg border border-line bg-cream px-2.5 py-1.5 text-right text-[13px] tabular-nums text-ink"
          />
        </label>
        <label className="flex flex-1 flex-col gap-1 text-[12px] text-mute">
          사유
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="사유(선택)"
            className="min-w-[160px] rounded-lg border border-line bg-cream px-2.5 py-1.5 text-[13px] text-ink"
          />
        </label>
        <button
          onClick={handleCreate}
          disabled={submitting || !orderId}
          className="rounded-lg bg-ink px-3.5 py-2 text-[13px] text-cream transition-colors hover:bg-gold-deep disabled:opacity-30"
        >
          {submitting ? "접수 중…" : "접수"}
        </button>
      </div>

      {/* 내역 */}
      <div className="mt-5">
        {loading ? (
          <p className="text-[14px] text-mute">불러오는 중…</p>
        ) : returns.length === 0 ? (
          <p className="rounded-2xl border border-line bg-paper py-8 text-center text-[14px] text-mute">
            접수된 환불·교환이 없습니다.
          </p>
        ) : (
          <ul className="space-y-2.5">
            {returns.map((r) => (
              <ReturnRow
                key={r.id}
                ret={r}
                order={orderById.get(r.order_id)}
                onSaved={refresh}
                onError={setError}
              />
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function ReturnRow({
  ret,
  order,
  onSaved,
  onError,
}: {
  ret: OrderReturn;
  order?: ReturnableOrder;
  onSaved: () => Promise<void> | void;
  onError: (msg: string) => void;
}) {
  const [status, setStatus] = useState<ReturnStatus>(ret.status);
  const [resolution, setResolution] = useState(ret.resolution ?? "");
  const [saving, setSaving] = useState(false);
  const dirty = status !== ret.status || resolution !== (ret.resolution ?? "");

  async function handleSave() {
    setSaving(true);
    try {
      await updateReturn(ret.id, status, resolution);
      await onSaved();
    } catch (e) {
      onError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSaving(false);
    }
  }

  return (
    <li className="rounded-2xl border border-line bg-paper p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[14px] text-ink">
            <span className="rounded-full bg-ink/5 px-2 py-0.5 text-[12px] text-ink-soft">
              {ret.type}
            </span>{" "}
            <span className="tabular-nums">{order?.order_no ?? "주문"}</span>
            {order ? <span className="text-mute"> · {order.ship_name}</span> : null}
          </p>
          <p className="mt-1 text-[12.5px] text-mute">
            접수 {new Date(ret.created_at).toLocaleDateString("ko-KR")}
            {ret.amount > 0 ? ` · 환불 ${formatKRW(ret.amount)}` : ""}
            {ret.reason ? ` · ${ret.reason}` : ""}
          </p>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[12px] ${STATUS_TONE[ret.status]}`}>
          {ret.status}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-3 no-print">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as ReturnStatus)}
          className="rounded-lg border border-line bg-cream px-2.5 py-1.5 text-[13px] text-ink"
        >
          {RETURN_STATUSES.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </select>
        <input
          type="text"
          value={resolution}
          onChange={(e) => setResolution(e.target.value)}
          placeholder="처리 메모"
          className="min-w-[180px] flex-1 rounded-lg border border-line bg-cream px-2.5 py-1.5 text-[13px] text-ink"
        />
        <button
          onClick={handleSave}
          disabled={!dirty || saving}
          className="rounded-lg border border-line px-3 py-1.5 text-[13px] text-ink-soft transition-colors enabled:hover:border-gold enabled:hover:text-gold disabled:opacity-40"
        >
          {saving ? "저장 중…" : "저장"}
        </button>
      </div>
    </li>
  );
}

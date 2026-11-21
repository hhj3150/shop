"use client";

// 관리자: 카드·간편결제(나이스페이) 결제 목록 + 전체취소/부분취소.
//   취소 금액·면세금액은 서버(/api/admin/payments/cancel)가 정한다. 여기서는 '무엇을' 취소할지만 고른다.
//     · 품목 선택: 단품 주문 — 품목·수량(+배송비)을 고르면 면세/과세를 품목별로 나눠 취소
//     · 금액 입력: 구독 중도해지 환불 등 — 원 결제의 면세 비율로 나눠 취소
//   전액이 취소되면 주문도 '취소'로 바뀐다(구독 좌석 해지 포함).
import { useCallback, useEffect, useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { formatKRW, getProduct } from "@/lib/products";

type Payment = {
  id: number;
  order_id: string;
  order_no: string;
  tid: string;
  status: string;
  amount: number;
  tax_free_amt: number;
  balance_amt: number | null;
  pay_method: string | null;
  card_name: string | null;
  paid_at: string | null;
  sandbox: boolean;
};
type Cancel = { payment_id: number; cancel_amt: number; tax_free_amt: number; reason: string | null; created_at: string };
type OrderLite = {
  id: string;
  order_no: string;
  ship_name: string | null;
  order_type: string;
  status: string;
  shipping_fee: number | null;
  block_weeks: number | null;
};
type Item = { order_id: string; product_id: string; qty: number; unit_price: number };

const STATUS_LABEL: Record<string, string> = {
  paid: "결제완료",
  partialCancelled: "부분취소",
  cancelled: "전체취소",
  netcancelled: "망취소",
  failed: "실패",
};

export function CardPaymentsPanel() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [cancels, setCancels] = useState<Cancel[]>([]);
  const [orders, setOrders] = useState<Map<string, OrderLite>>(new Map());
  const [items, setItems] = useState<Map<string, Item[]>>(new Map());
  const [open, setOpen] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = useCallback(async () => {
    const sb = getSupabase();
    const { data: ps } = await sb
      .from("payments")
      .select("id,order_id,order_no,tid,status,amount,tax_free_amt,balance_amt,pay_method,card_name,paid_at,sandbox")
      .order("id", { ascending: false })
      .limit(100);
    const list = (ps ?? []) as Payment[];
    setPayments(list);
    if (list.length === 0) return;
    const ids = list.map((p) => p.order_id);
    const [{ data: cs }, { data: os }, { data: its }] = await Promise.all([
      sb.from("payment_cancels").select("payment_id,cancel_amt,tax_free_amt,reason,created_at").in("payment_id", list.map((p) => p.id)),
      sb.from("orders").select("id,order_no,ship_name,order_type,status,shipping_fee,block_weeks").in("id", ids),
      sb.from("order_items").select("order_id,product_id,qty,unit_price").in("order_id", ids),
    ]);
    setCancels((cs ?? []) as Cancel[]);
    setOrders(new Map(((os ?? []) as OrderLite[]).map((o) => [o.id, o])));
    const m = new Map<string, Item[]>();
    for (const it of (its ?? []) as Item[]) m.set(it.order_id, [...(m.get(it.order_id) ?? []), it]);
    setItems(m);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const cancelsBy = useMemo(() => {
    const m = new Map<number, Cancel[]>();
    for (const c of cancels) m.set(c.payment_id, [...(m.get(c.payment_id) ?? []), c]);
    return m;
  }, [cancels]);

  async function submit(p: Payment, body: Record<string, unknown>, confirmText: string) {
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    setNote(null);
    try {
      const { data } = await getSupabase().auth.getSession();
      const token = data.session?.access_token;
      const res = await fetch("/api/admin/payments/cancel", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token ?? ""}` },
        body: JSON.stringify({ orderNo: p.order_no, ...body }),
      });
      const j = (await res.json().catch(() => ({}))) as {
        ok?: boolean;
        reason?: string;
        cancelAmt?: number;
        taxFreeAmt?: number;
        balance?: number;
        orderCancelled?: boolean;
      };
      if (!j.ok) {
        setNote(`취소 실패 — ${j.reason ?? res.status}`);
      } else {
        setNote(
          `${p.order_no} 취소 완료: ${formatKRW(j.cancelAmt ?? 0)} (면세 ${formatKRW(j.taxFreeAmt ?? 0)}) · 남은 금액 ${formatKRW(
            j.balance ?? 0
          )}${j.orderCancelled ? " · 주문 취소됨" : ""}`
        );
        setOpen(null);
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-10">
      <h2 className="font-serif-kr text-lg text-ink">카드·간편결제 취소</h2>
      <p className="mt-1 t-footnote text-mute">
        나이스페이로 결제된 주문입니다. 금액과 면세금액은 서버가 품목 기준으로 계산합니다. 전액 취소되면 주문도 &apos;취소&apos;로 바뀝니다.
      </p>
      {note && <p className="mt-3 rounded-xl border border-gold/40 bg-gold/10 px-4 py-2.5 t-footnote text-gold-deep">{note}</p>}
      {payments.length === 0 ? (
        <p className="mt-4 t-footnote text-mute">카드·간편결제 내역이 없습니다.</p>
      ) : (
        <ul className="mt-4 divide-y divide-line rounded-2xl border border-line">
          {payments.map((p) => {
            const o = orders.get(p.order_id);
            const done = cancelsBy.get(p.id) ?? [];
            const cancelled = done.reduce((s, c) => s + c.cancel_amt, 0);
            const remain = p.balance_amt ?? p.amount - cancelled;
            const canCancel = remain > 0 && p.status !== "cancelled";
            return (
              <li key={p.id} className="p-4 t-footnote">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="tabular-nums font-medium text-ink">{p.order_no}</span>
                  <span className="text-ink-soft">{o?.ship_name ?? "—"}</span>
                  <span className="rounded-full bg-cream px-2 py-0.5 t-caption text-ink-soft">{STATUS_LABEL[p.status] ?? p.status}</span>
                  {p.sandbox && <span className="rounded-full bg-amber-100 px-2 py-0.5 t-caption text-amber-800">테스트</span>}
                  <span className="tabular-nums text-ink">{formatKRW(p.amount)}</span>
                  <span className="tabular-nums text-mute">면세 {formatKRW(p.tax_free_amt)}</span>
                  <span className="tabular-nums text-mute">잔액 {formatKRW(remain)}</span>
                  <span className="text-mute">{p.card_name ?? p.pay_method ?? ""}</span>
                  <span className="text-mute">{p.paid_at ? new Date(p.paid_at).toLocaleString("ko-KR") : ""}</span>
                  {canCancel && (
                    <button
                      disabled={busy}
                      onClick={() => setOpen(open === p.id ? null : p.id)}
                      className="ml-auto rounded-full border border-line px-3 py-1 t-caption text-ink-soft hover:border-gold"
                    >
                      {open === p.id ? "닫기" : "취소하기"}
                    </button>
                  )}
                </div>
                {done.length > 0 && (
                  <ul className="mt-2 space-y-0.5 t-caption text-mute">
                    {done.map((c, i) => (
                      <li key={i} className="tabular-nums">
                        {new Date(c.created_at).toLocaleString("ko-KR")} · 취소 {formatKRW(c.cancel_amt)} (면세 {formatKRW(c.tax_free_amt)})
                        {c.reason ? ` · ${c.reason}` : ""}
                      </li>
                    ))}
                  </ul>
                )}
                {open === p.id && o && (
                  <CancelForm
                    payment={p}
                    order={o}
                    items={items.get(p.order_id) ?? []}
                    remain={remain}
                    busy={busy}
                    onSubmit={(body, text) => submit(p, body, text)}
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function CancelForm({
  payment,
  order,
  items,
  remain,
  busy,
  onSubmit,
}: {
  payment: Payment;
  order: OrderLite;
  items: Item[];
  remain: number;
  busy: boolean;
  onSubmit: (body: Record<string, unknown>, confirmText: string) => void;
}) {
  const isSub = order.order_type === "구독";
  const [mode, setMode] = useState<"items" | "amount">(isSub ? "amount" : "items");
  const [qty, setQty] = useState<Record<string, number>>({});
  const [ship, setShip] = useState(false);
  const [amount, setAmount] = useState("");
  const [reason, setReason] = useState("");

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-line bg-cream/50 p-4">
      <div className="flex flex-wrap gap-2">
        <button
          disabled={busy}
          onClick={() =>
            onSubmit(
              { mode: "full", reason: reason || "전체취소" },
              `${payment.order_no}: 남은 ${formatKRW(remain)}을 전부 취소할까요?\n주문도 '취소'로 바뀌며 되돌릴 수 없습니다.`
            )
          }
          className="rounded-full bg-ink px-4 py-1.5 t-caption text-cream hover:bg-gold-deep disabled:opacity-50"
        >
          전체취소 ({formatKRW(remain)})
        </button>
        {!isSub && (
          <button onClick={() => setMode("items")} className={`rounded-full border px-3 py-1.5 t-caption ${mode === "items" ? "border-gold text-gold-deep" : "border-line text-ink-soft"}`}>
            품목 선택 부분취소
          </button>
        )}
        <button onClick={() => setMode("amount")} className={`rounded-full border px-3 py-1.5 t-caption ${mode === "amount" ? "border-gold text-gold-deep" : "border-line text-ink-soft"}`}>
          금액 입력 부분취소
        </button>
      </div>

      {mode === "items" ? (
        <div className="space-y-2">
          {items.map((it) => {
            const p = getProduct(it.product_id);
            return (
              <label key={it.product_id} className="flex items-center gap-3">
                <span className="w-48 text-ink-soft">
                  {p ? `${p.name} ${p.volume}` : it.product_id}
                  <span className="ml-1 text-mute">{p?.taxFree ? "면세" : "과세"}</span>
                </span>
                <input
                  type="number"
                  min={0}
                  max={it.qty}
                  value={qty[it.product_id] ?? 0}
                  onChange={(e) => setQty({ ...qty, [it.product_id]: Math.max(0, Math.min(it.qty, Number(e.target.value) || 0)) })}
                  className="w-20 rounded-lg border border-line px-2 py-1 tabular-nums"
                />
                <span className="text-mute">/ {it.qty}개 · {formatKRW(it.unit_price)}</span>
              </label>
            );
          })}
          {(order.shipping_fee ?? 0) > 0 && (
            <label className="flex items-center gap-2 text-ink-soft">
              <input type="checkbox" checked={ship} onChange={(e) => setShip(e.target.checked)} /> 배송비 {formatKRW(order.shipping_fee ?? 0)} 포함
            </label>
          )}
        </div>
      ) : (
        <label className="flex items-center gap-2">
          <span className="text-ink-soft">취소 금액</span>
          <input
            inputMode="numeric"
            value={amount}
            onChange={(e) => setAmount(e.target.value.replace(/\D/g, ""))}
            className="w-32 rounded-lg border border-line px-2 py-1 tabular-nums"
            placeholder={String(remain)}
          />
          <span className="text-mute">원 (면세분은 결제 때 비율로 자동 계산)</span>
        </label>
      )}

      <input
        value={reason}
        onChange={(e) => setReason(e.target.value.slice(0, 100))}
        placeholder="취소 사유 (손님에게 보이지 않음)"
        className="w-full rounded-lg border border-line px-3 py-1.5"
      />
      <button
        disabled={busy}
        onClick={() => {
          const body =
            mode === "items"
              ? {
                  mode: "items",
                  items: Object.entries(qty)
                    .filter(([, q]) => q > 0)
                    .map(([product_id, q]) => ({ product_id, qty: q })),
                  includeShipping: ship,
                  reason: reason || "부분취소",
                }
              : { mode: "amount", amount: Number(amount), reason: reason || "부분취소" };
          onSubmit(body, `${payment.order_no}: 부분취소할까요? 금액·면세금액은 서버가 계산하며 되돌릴 수 없습니다.`);
        }}
        className="rounded-full border border-gold px-4 py-1.5 t-caption text-gold-deep hover:bg-gold/10 disabled:opacity-50"
      >
        부분취소 실행
      </button>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { formatKRW } from "@/lib/products";
import {
  type Client,
  type ClientInvoice,
  type ClientPayment,
  loadClients,
  loadInvoices,
  loadPayments,
  addPayment,
  deletePayment,
} from "@/lib/clients";
import { clientBalances, totalBalance } from "@/lib/receivables";

function todayISO(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// B2B 미수금·수금 — 청구(거래명세 스냅샷) − 입금 = 미수 잔액. 거래처별 잔액 + 입금 기록.
export function B2bReceivablesPanel() {
  const [clients, setClients] = useState<Client[]>([]);
  const [invoices, setInvoices] = useState<ClientInvoice[]>([]);
  const [payments, setPayments] = useState<ClientPayment[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  // 입금 입력 폼(거래처별).
  const [payDraft, setPayDraft] = useState<Record<string, { amount: string; paid_on: string; method: string }>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const [cs, invs, pays] = await Promise.all([loadClients(), loadInvoices(), loadPayments()]);
      setClients(cs);
      setInvoices(invs);
      setPayments(pays);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "불러오기에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const nameById = useMemo(() => {
    const m: Record<string, string> = {};
    for (const c of clients) m[c.id] = c.name;
    return m;
  }, [clients]);

  const balances = useMemo(() => clientBalances(invoices, payments), [invoices, payments]);
  const grand = useMemo(() => totalBalance(balances), [balances]);

  // 잔액이 있는(또는 활동이 있는) 거래처를 미수 큰 순으로.
  const rows = useMemo(() => {
    return Object.entries(balances)
      .map(([id, b]) => ({ id, name: nameById[id] ?? "(삭제된 거래처)", ...b }))
      .sort((a, b) => b.balance - a.balance);
  }, [balances, nameById]);

  const setPay = (id: string, patch: Partial<{ amount: string; paid_on: string; method: string }>) =>
    setPayDraft((prev) => ({
      ...prev,
      [id]: { amount: "", paid_on: todayISO(), method: "", ...(prev[id] ?? {}), ...patch },
    }));

  async function handleAddPayment(clientId: string) {
    const d = payDraft[clientId];
    const amount = Math.max(0, Number(d?.amount) || 0);
    if (amount <= 0) {
      setErr("입금액을 입력해 주세요.");
      return;
    }
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await addPayment({
        client_id: clientId,
        paid_on: d?.paid_on || todayISO(),
        amount,
        method: d?.method || null,
      });
      setPayDraft((prev) => ({ ...prev, [clientId]: { amount: "", paid_on: todayISO(), method: "" } }));
      await load();
      setMsg("입금을 기록했습니다.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "입금 기록에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function handleDeletePayment(id: string) {
    if (!window.confirm("이 입금 기록을 삭제할까요?")) return;
    setBusy(true);
    setErr(null);
    try {
      await deletePayment(id);
      await load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "삭제에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow text-gold-deep">B2B · 미수금·수금</p>
          <h2 className="mt-1 font-serif-kr text-lg text-ink">거래처 미수 잔액</h2>
          <p className="mt-1 text-[13px] text-mute">
            청구(위 정산에서 ‘청구 확정’) − 입금 = 미수. 입금을 기록하면 미수가 줄어듭니다.
          </p>
        </div>
        <button
          onClick={load}
          disabled={loading}
          className="rounded-full border border-line px-4 py-2 text-[13px] text-ink-soft hover:border-gold hover:text-gold-deep disabled:opacity-50 no-print"
        >
          새로고침
        </button>
      </div>

      {/* 요약 */}
      <div className="mt-5 grid grid-cols-3 gap-3">
        <Stat label="총 청구" value={formatKRW(grand.billed)} />
        <Stat label="총 입금" value={formatKRW(grand.paid)} />
        <Stat label="총 미수" value={formatKRW(grand.balance)} tone={grand.balance > 0 ? "danger" : "mute"} />
      </div>

      {err && (
        <p className="mt-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-[14px] text-red-700">{err}</p>
      )}
      {msg && <p className="mt-4 text-[14px] text-gold-deep">{msg}</p>}

      {loading ? (
        <p className="mt-6 py-4 text-center text-mute">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <p className="mt-6 py-4 text-center text-mute">
          아직 청구·입금 내역이 없습니다. 위 ‘거래처 납품 매출’에서 기간을 고르고 ‘청구 확정’을 누르세요.
        </p>
      ) : (
        <div className="mt-6 space-y-3">
          {rows.map((r) => {
            const d = payDraft[r.id] ?? { amount: "", paid_on: todayISO(), method: "" };
            const clientPays = payments.filter((p) => p.client_id === r.id);
            return (
              <div key={r.id} className="rounded-2xl border border-line bg-cream/40 p-5">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <h3 className="font-serif-kr text-[15px] text-ink">{r.name}</h3>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
                    <span className="text-mute">청구 <span className="tabular-nums text-ink">{formatKRW(r.billed)}</span></span>
                    <span className="text-mute">입금 <span className="tabular-nums text-ink">{formatKRW(r.paid)}</span></span>
                    <span className={`font-medium ${r.balance > 0 ? "text-red-600" : "text-mute"}`}>
                      미수 <span className="tabular-nums">{formatKRW(r.balance)}</span>
                    </span>
                  </div>
                </div>

                {/* 입금 입력 */}
                <div className="mt-3 flex flex-wrap items-center gap-2 no-print">
                  <input
                    type="date"
                    value={d.paid_on}
                    onChange={(e) => setPay(r.id, { paid_on: e.target.value })}
                    className="rounded-lg border border-line bg-paper px-2 py-1.5 text-[14px] text-ink"
                  />
                  <input
                    type="number"
                    min={0}
                    step="100"
                    value={d.amount}
                    onChange={(e) => setPay(r.id, { amount: e.target.value })}
                    placeholder="입금액"
                    className="w-28 rounded-lg border border-line bg-paper px-2 py-1.5 text-right tabular-nums text-ink"
                  />
                  <input
                    type="text"
                    value={d.method}
                    onChange={(e) => setPay(r.id, { method: e.target.value })}
                    placeholder="방법(선택)"
                    className="w-28 rounded-lg border border-line bg-paper px-2 py-1.5 text-[14px] text-ink"
                  />
                  <button
                    onClick={() => handleAddPayment(r.id)}
                    disabled={busy}
                    className="rounded-full border border-gold-deep px-4 py-1.5 text-[13px] font-medium text-gold-deep hover:bg-gold/10 disabled:opacity-50"
                  >
                    입금 기록
                  </button>
                </div>

                {/* 입금 이력 */}
                {clientPays.length > 0 && (
                  <ul className="mt-3 space-y-1 border-t border-line/60 pt-2 text-[13px]">
                    {clientPays.map((p) => (
                      <li key={p.id} className="flex items-center justify-between">
                        <span className="text-ink-soft">
                          <span className="tabular-nums">{p.paid_on}</span>
                          {p.method && <span className="ml-1.5 text-mute">· {p.method}</span>}
                        </span>
                        <span className="flex items-center gap-3">
                          <span className="tabular-nums text-ink">{formatKRW(p.amount)}</span>
                          <button
                            onClick={() => p.id && handleDeletePayment(p.id)}
                            className="text-[12px] text-mute hover:text-red-600 no-print"
                          >
                            삭제
                          </button>
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}

function Stat({
  label,
  value,
  tone = "ink",
}: {
  label: string;
  value: string;
  tone?: "ink" | "danger" | "mute";
}) {
  const valueColor = tone === "danger" ? "text-red-600" : tone === "mute" ? "text-mute" : "text-ink";
  return (
    <div className="rounded-2xl border border-line bg-cream p-4">
      <p className="text-[13px] text-mute">{label}</p>
      <p className={`mt-1 font-serif-kr text-xl tabular-nums ${valueColor}`}>{value}</p>
    </div>
  );
}

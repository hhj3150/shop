"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { PRODUCTION_KEYS } from "@/lib/production";
import {
  type Client,
  type B2bDemand,
  loadClients,
  addClient,
  setClientActive,
  loadB2bDemand,
  saveB2bDemand,
} from "@/lib/clients";

// 거래처별 제품 수요 초안: clientId → (productKey → qty).
type DemandDraft = Record<string, Record<string, number>>;

function emptyRow(): Record<string, number> {
  const r: Record<string, number> = {};
  for (const key of PRODUCTION_KEYS) r[key] = 0;
  return r;
}

// B2B(거래처) 필요량 입력 섹션 — 날짜별로 거래처×제품 필요수량을 기록한다.
//   합산한 제품별 총 B2B 필요량을 onTotals 로 상위(생산 패널)에 보고해
//   "총 필요 = 온라인 + B2B" 계산의 근거가 된다.
export function B2bDemandSection({
  date,
  onTotals,
}: {
  date: string;
  onTotals: (totals: Record<string, number>) => void;
}) {
  const [clients, setClients] = useState<Client[]>([]);
  const [draft, setDraft] = useState<DemandDraft>({});
  const [newName, setNewName] = useState("");
  const [newContact, setNewContact] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [adding, setAdding] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const activeClients = useMemo(
    () => clients.filter((c) => c.active),
    [clients]
  );

  const load = useCallback(async () => {
    setLoading(true);
    setErr(null);
    setMsg(null);
    try {
      const [cs, demand] = await Promise.all([loadClients(), loadB2bDemand(date)]);
      const byClient: DemandDraft = {};
      for (const c of cs) byClient[c.id] = emptyRow();
      for (const d of demand) {
        if (!byClient[d.client_id]) byClient[d.client_id] = emptyRow();
        byClient[d.client_id][d.product_key] = d.qty;
      }
      setClients(cs);
      setDraft(byClient);
    } catch (error) {
      setErr(error instanceof Error ? error.message : "불러오기에 실패했습니다.");
    } finally {
      setLoading(false);
    }
  }, [date]);

  useEffect(() => {
    load();
  }, [load]);

  // 제품별 총 B2B 필요량(활성 거래처 합계) — 상위로 보고.
  const productTotals = useMemo(() => {
    const m: Record<string, number> = {};
    for (const key of PRODUCTION_KEYS) m[key] = 0;
    for (const c of activeClients) {
      const row = draft[c.id];
      if (!row) continue;
      for (const key of PRODUCTION_KEYS) m[key] += row[key] ?? 0;
    }
    return m;
  }, [activeClients, draft]);

  // totals 가 바뀔 때만 상위에 보고(객체 정체성 대신 값으로 비교).
  const totalsSig = useMemo(() => JSON.stringify(productTotals), [productTotals]);
  useEffect(() => {
    onTotals(productTotals);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [totalsSig]);

  const setQty = (clientId: string, key: string, value: string) =>
    setDraft((prev) => {
      const row = prev[clientId] ?? emptyRow();
      return {
        ...prev,
        [clientId]: { ...row, [key]: Math.max(0, Number(value) || 0) },
      };
    });

  async function handleAdd() {
    if (!newName.trim()) return;
    setAdding(true);
    setErr(null);
    setMsg(null);
    try {
      const created = await addClient(newName, newContact);
      setClients((prev) => [...prev, created].sort((a, b) => a.name.localeCompare(b.name, "ko")));
      setDraft((prev) => ({ ...prev, [created.id]: emptyRow() }));
      setNewName("");
      setNewContact("");
    } catch (error) {
      setErr(error instanceof Error ? error.message : "거래처 등록에 실패했습니다.");
    } finally {
      setAdding(false);
    }
  }

  async function handleDeactivate(client: Client) {
    setErr(null);
    setMsg(null);
    try {
      await setClientActive(client.id, false);
      setClients((prev) =>
        prev.map((c) => (c.id === client.id ? { ...c, active: false } : c))
      );
    } catch (error) {
      setErr(error instanceof Error ? error.message : "상태 변경에 실패했습니다.");
    }
  }

  async function handleSave() {
    setSaving(true);
    setErr(null);
    setMsg(null);
    try {
      const rows: B2bDemand[] = [];
      for (const c of clients) {
        const row = draft[c.id];
        if (!row) continue;
        for (const key of PRODUCTION_KEYS) {
          rows.push({ demand_date: date, client_id: c.id, product_key: key, qty: row[key] ?? 0 });
        }
      }
      await saveB2bDemand(date, rows);
      setMsg("거래처 필요량을 저장했습니다.");
    } catch (error) {
      setErr(error instanceof Error ? error.message : "저장에 실패했습니다.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="mt-10 rounded-2xl border border-line bg-cream/40 p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="eyebrow text-gold-deep">B2B · 거래처</p>
          <h3 className="mt-1 font-serif-kr text-lg text-ink">거래처별 필요량</h3>
          <p className="mt-1 text-[13px] text-mute">
            백화점·도매 등 외부 납품 수요를 거래처별로 입력합니다. 온라인 수요와 합산해 총 필요량이 됩니다.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2 no-print">
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="거래처 이름"
            className="w-32 rounded-xl border border-line bg-paper px-3 py-2 text-[14px] text-ink"
          />
          <input
            type="text"
            value={newContact}
            onChange={(e) => setNewContact(e.target.value)}
            placeholder="연락처(선택)"
            className="w-32 rounded-xl border border-line bg-paper px-3 py-2 text-[14px] text-ink"
          />
          <button
            onClick={handleAdd}
            disabled={adding || !newName.trim()}
            className="rounded-full border border-line px-4 py-2 text-[14px] text-ink-soft hover:border-gold hover:text-gold-deep disabled:opacity-50"
          >
            {adding ? "추가 중…" : "거래처 추가"}
          </button>
        </div>
      </div>

      {err && (
        <p className="mt-4 rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-[14px] text-red-700">
          {err}
        </p>
      )}
      {msg && <p className="mt-4 text-[14px] text-gold-deep">{msg}</p>}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[14px]">
          <thead>
            <tr className="border-b border-line text-left text-mute">
              <th className="py-2 font-normal">거래처</th>
              {PRODUCTION_KEYS.map((key) => (
                <th key={key} className="py-2 text-right font-normal">{key}</th>
              ))}
              <th className="py-2 text-right font-normal">합계</th>
              <th className="py-2 no-print" />
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={PRODUCTION_KEYS.length + 3} className="py-4 text-center text-mute">
                  불러오는 중…
                </td>
              </tr>
            ) : activeClients.length === 0 ? (
              <tr>
                <td colSpan={PRODUCTION_KEYS.length + 3} className="py-4 text-center text-mute">
                  등록된 거래처가 없습니다. 위에서 거래처를 추가하세요.
                </td>
              </tr>
            ) : (
              activeClients.map((c) => {
                const row = draft[c.id] ?? emptyRow();
                const sum = PRODUCTION_KEYS.reduce((s, k) => s + (row[k] ?? 0), 0);
                return (
                  <tr key={c.id} className="border-b border-line/60 align-middle">
                    <td className="py-2.5 text-ink">
                      {c.name}
                      {c.contact && <span className="ml-1 text-[12px] text-mute">· {c.contact}</span>}
                    </td>
                    {PRODUCTION_KEYS.map((key) => (
                      <td key={key} className="py-2.5 text-right">
                        <input
                          type="number"
                          min={0}
                          value={row[key] || ""}
                          onChange={(e) => setQty(c.id, key, e.target.value)}
                          className="w-16 rounded-lg border border-line bg-paper px-2 py-1 text-right tabular-nums text-ink"
                        />
                      </td>
                    ))}
                    <td className="py-2.5 text-right font-medium tabular-nums text-ink">{sum || "·"}</td>
                    <td className="py-2.5 text-right no-print">
                      <button
                        onClick={() => handleDeactivate(c)}
                        className="text-[12px] text-mute hover:text-red-600"
                        title="거래처 비활성화"
                      >
                        비활성
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
          {activeClients.length > 0 && (
            <tfoot>
              <tr className="border-t border-line text-left">
                <td className="py-2.5 font-medium text-ink">B2B 합계</td>
                {PRODUCTION_KEYS.map((key) => (
                  <td key={key} className="py-2.5 text-right font-medium tabular-nums text-gold-deep">
                    {productTotals[key] || "·"}
                  </td>
                ))}
                <td className="py-2.5 text-right font-medium tabular-nums text-gold-deep">
                  {PRODUCTION_KEYS.reduce((s, k) => s + productTotals[k], 0) || "·"}
                </td>
                <td className="no-print" />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3 no-print">
        <button
          onClick={handleSave}
          disabled={saving || loading}
          className="rounded-full border border-gold-deep px-5 py-2.5 text-[14px] font-medium text-gold-deep hover:bg-gold/10 disabled:opacity-50"
        >
          {saving ? "저장 중…" : "거래처 필요량 저장"}
        </button>
        <button
          onClick={load}
          disabled={loading || saving}
          className="rounded-full border border-line px-5 py-2.5 text-[14px] text-ink-soft hover:border-gold hover:text-gold disabled:opacity-50"
        >
          되돌리기
        </button>
      </div>
    </section>
  );
}

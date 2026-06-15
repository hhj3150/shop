"use client";

// 관리자: 실시간 재고 원장 — 품목별 현재고·안전재고·부족 경보 + 입고/조정/폐기 거래 + 원장 이력.
//   현재고 권위값은 product_catalog.stock, 변동은 stock_movements(원장)에 기록된다.
//   입고/조정/폐기는 stock_adjust RPC(음수 차단·무제한 차단)로만 일어난다.
//   배송 출고 차감은 배송 탭의 [출고 확정]에서 stock_ship_out 으로 처리한다(여기 아님).
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  isLowStock,
  expiryAlert,
  shipmentShortfall,
  MOVEMENT_KINDS,
  type MovementKind,
} from "@/lib/inventory";
import {
  loadInventory,
  loadMovements,
  loadExpiries,
  stockAdjust,
  type InventoryRow,
  type StockMovement,
} from "@/lib/inventory-data";
import { saveCatalogProduct } from "@/lib/catalog";

// 행별 거래 입력 초안. dir 은 '조정'에서만 의미(증/감). 입고=+, 폐기=−는 자동. expiry 는 입고에만.
type ActionDraft = { kind: MovementKind; qty: string; dir: "+" | "-"; note: string; expiry: string };

const EMPTY_DRAFT: ActionDraft = { kind: "입고", qty: "", dir: "+", note: "", expiry: "" };

// 관리자가 직접 기록할 수 있는 유형(출고는 배송 출고에서 자동, 수동 입력 제외).
const MANUAL_KINDS = MOVEMENT_KINDS.filter((k) => k !== "출고");

const KIND_BADGE: Record<MovementKind, string> = {
  입고: "bg-emerald-100 text-emerald-700",
  출고: "bg-sky-100 text-sky-700",
  조정: "bg-amber-100 text-amber-700",
  폐기: "bg-rose-100 text-rose-700",
};

// 유형·방향으로 부호 있는 변동량 계산. 입고=+, 폐기=−, 조정=dir 따름.
function signedDelta(kind: MovementKind, qty: number, dir: "+" | "-"): number {
  if (kind === "입고") return qty;
  if (kind === "폐기") return -qty;
  return dir === "+" ? qty : -qty; // 조정
}

// upcomingDemand: 다가오는 발송 수요(제품키 `name volume` → 개수). 현재고가 이보다
//   적은 품목을 '발송부족'으로 경고한다(안전재고 경보와 별개 — 예정 발송을 실제로 못 채우는 경우).
export function InventoryPanel({
  upcomingDemand,
  upcomingDays = 7,
}: {
  upcomingDemand?: Record<string, number>;
  upcomingDays?: number;
} = {}) {
  const [rows, setRows] = useState<InventoryRow[]>([]);
  const [movements, setMovements] = useState<StockMovement[]>([]);
  const [expiries, setExpiries] = useState<Map<string, string[]>>(new Map());
  const [drafts, setDrafts] = useState<Record<string, ActionDraft>>({});
  const [safety, setSafety] = useState<Record<string, string>>({});
  const [initStock, setInitStock] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 경보 판정 기준 시각 — 한 번만 생성해 모든 행이 같은 today 로 비교(KST).
  const [now] = useState(() => new Date());

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [inv, mv, exp] = await Promise.all([
          loadInventory(),
          loadMovements(),
          loadExpiries(),
        ]);
        if (!alive) return;
        setRows(inv);
        setMovements(mv);
        setExpiries(exp);
        setSafety(
          Object.fromEntries(
            inv.map((r) => [r.id, r.safety_stock === null ? "" : String(r.safety_stock)])
          )
        );
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

  const nameById = useMemo(
    () => new Map(rows.map((r) => [r.id, `${r.name} ${r.volume}`])),
    [rows]
  );

  const lowCount = useMemo(
    () => rows.filter((r) => isLowStock(r.stock, r.safety_stock)).length,
    [rows]
  );

  // 다가오는 발송 수요 대비 현재고 부족분(제품키 매칭). 0이면 충분.
  const shortfallOf = useCallback(
    (r: InventoryRow): number =>
      shipmentShortfall(r.stock, upcomingDemand?.[`${r.name} ${r.volume}`] ?? 0),
    [upcomingDemand]
  );

  const shortCount = useMemo(
    () => rows.filter((r) => shortfallOf(r) > 0).length,
    [rows, shortfallOf]
  );

  // 임박·만료 제품 수(배치 수 아님). stock>0 관리 품목만 — lowCount 와 같은 패턴.
  const expiryCounts = useMemo(() => {
    let warning = 0;
    let expired = 0;
    for (const r of rows) {
      if (r.stock === null || r.stock <= 0) continue;
      const s = expiryAlert(expiries.get(r.id) ?? [], now).status;
      if (s === "warning") warning++;
      else if (s === "expired") expired++;
    }
    return { warning, expired };
  }, [rows, expiries, now]);

  function draftOf(id: string): ActionDraft {
    return drafts[id] ?? EMPTY_DRAFT;
  }

  function patchDraft(id: string, patch: Partial<ActionDraft>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...draftOf(id), ...patch } }));
    setError(null);
  }

  // 입고/조정/폐기 기록 → stock_adjust RPC → 로컬 현재고·이력 갱신.
  async function recordMovement(p: InventoryRow) {
    const d = draftOf(p.id);
    const qty = Number(d.qty);
    if (!Number.isFinite(qty) || qty <= 0) {
      setError("수량은 1 이상이어야 합니다.");
      return;
    }
    setBusyId(p.id);
    setError(null);
    try {
      const delta = signedDelta(d.kind, qty, d.dir);
      const newStock = await stockAdjust(
        p.id,
        delta,
        d.kind,
        d.note,
        d.kind === "입고" && d.expiry ? d.expiry : undefined
      );
      // 성공 → 현재고 즉시 반영 + 이력·유통기한 재조회(불변 갱신).
      setRows((prev) =>
        prev.map((x) => (x.id === p.id ? { ...x, stock: newStock } : x))
      );
      setDrafts((prev) => ({ ...prev, [p.id]: EMPTY_DRAFT }));
      const [mv, exp] = await Promise.all([loadMovements(), loadExpiries()]);
      setMovements(mv);
      setExpiries(exp);
    } catch (e) {
      setError(e instanceof Error ? e.message : "거래 기록 실패");
    } finally {
      setBusyId(null);
    }
  }

  // 안전재고 저장(빈 값 = 경보 안 함). product_catalog 직접 update(관리자 RLS).
  async function saveSafety(p: InventoryRow) {
    const raw = safety[p.id]?.trim() ?? "";
    const value = raw === "" ? null : Number(raw);
    if (value !== null && (!Number.isFinite(value) || value < 0)) {
      setError("안전재고는 0 이상이거나 비워야 합니다.");
      return;
    }
    setBusyId(p.id);
    setError(null);
    try {
      await saveCatalogProduct(p.id, { safety_stock: value });
      setRows((prev) =>
        prev.map((x) =>
          x.id === p.id
            ? { ...x, safety_stock: value === null ? null : Math.max(0, Math.round(value)) }
            : x
        )
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "안전재고 저장 실패");
    } finally {
      setBusyId(null);
    }
  }

  // 무제한(stock=null) 품목의 현재고 초기화 → 이후 입고/조정/폐기 가능.
  async function startTracking(p: InventoryRow) {
    const raw = initStock[p.id]?.trim() ?? "";
    const value = Number(raw);
    if (raw === "" || !Number.isFinite(value) || value < 0) {
      setError("초기 현재고는 0 이상 숫자여야 합니다.");
      return;
    }
    setBusyId(p.id);
    setError(null);
    try {
      await saveCatalogProduct(p.id, { stock: value });
      setRows((prev) =>
        prev.map((x) =>
          x.id === p.id ? { ...x, stock: Math.max(0, Math.round(value)) } : x
        )
      );
      setInitStock((prev) => ({ ...prev, [p.id]: "" }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "재고 관리 시작 실패");
    } finally {
      setBusyId(null);
    }
  }

  if (loading) {
    return <p className="mt-8 text-[14px] text-mute">재고 원장 불러오는 중…</p>;
  }

  return (
    <section className="mt-10">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif-kr text-lg text-ink">실시간 재고 원장</h2>
        <div className="flex gap-2 text-[12.5px]">
          <span className="rounded-full bg-ink/5 px-2.5 py-1 text-ink-soft">
            품목 {rows.length}
          </span>
          {lowCount > 0 && (
            <span className="rounded-full bg-rose-100 px-2.5 py-1 text-rose-700">
              🔴 부족 {lowCount}
            </span>
          )}
          {shortCount > 0 && (
            <span className="rounded-full bg-rose-100 px-2.5 py-1 text-rose-700">
              🚚 발송부족 {shortCount}
            </span>
          )}
          {expiryCounts.expired > 0 && (
            <span className="rounded-full bg-rose-100 px-2.5 py-1 text-rose-700">
              🔴 만료 {expiryCounts.expired}
            </span>
          )}
          {expiryCounts.warning > 0 && (
            <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-700">
              🟠 임박 {expiryCounts.warning}
            </span>
          )}
        </div>
      </div>
      <p className="mt-1 text-[13px] text-mute">
        현재고는 입고·조정·폐기와 배송 출고로 자동 갱신됩니다. 안전재고를 비우면 경보하지
        않습니다. 출고 차감은 ‘배송’ 탭의 출고 확정에서 처리됩니다.
        {upcomingDemand && (
          <> 다가오는 {upcomingDays}일 발송 수요보다 현재고가 적으면 ‘발송부족’으로 표시됩니다.</>
        )}
      </p>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-600">
          {error}
        </p>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="admin-cards-sm w-full border-collapse text-[14px] md:min-w-[920px]">
          <thead>
            <tr className="border-b border-line text-left text-[12.5px] text-mute">
              <th className="py-2.5 pr-3 font-medium">상품</th>
              <th className="py-2.5 pr-3 text-right font-medium">현재고</th>
              <th className="py-2.5 pr-3 text-right font-medium">안전재고</th>
              <th className="py-2.5 pr-3 font-medium">거래 입력</th>
              <th className="py-2.5 font-medium" />
            </tr>
          </thead>
          <tbody>
            {rows.map((p) => {
              const low = isLowStock(p.stock, p.safety_stock);
              const managed = p.stock !== null;
              const d = draftOf(p.id);
              const busy = busyId === p.id;
              return (
                <tr key={p.id} className="border-b border-line/70 align-top">
                  <td data-label="상품" className="py-3 pr-3">
                    <p className="text-ink">{p.name}</p>
                    <p className="text-[12.5px] text-mute">
                      {p.volume}
                      {!p.active && (
                        <span className="ml-1.5 rounded bg-ink/10 px-1.5 py-0.5 text-[11px] text-mute">
                          숨김
                        </span>
                      )}
                    </p>
                  </td>
                  <td data-label="현재고" className="py-3 pr-3 text-right">
                    {managed ? (
                      <span
                        className={`tabular-nums ${low ? "font-semibold text-rose-600" : "text-ink"}`}
                      >
                        {p.stock}
                        {low && (
                          <span className="ml-1.5 rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-semibold text-rose-700">
                            부족
                          </span>
                        )}
                        {p.stock! > 0 &&
                          (() => {
                            const a = expiryAlert(expiries.get(p.id) ?? [], now);
                            if (a.status === "expired")
                              return (
                                <span className="ml-1.5 rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-semibold text-rose-700">
                                  🔴 만료
                                </span>
                              );
                            if (a.status === "warning")
                              return (
                                <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">
                                  🟠 임박 D-{a.days} (유통 {a.nearest?.slice(5).replace("-", "/")})
                                </span>
                              );
                            return null;
                          })()}
                        {shortfallOf(p) > 0 && (
                          <span className="ml-1.5 rounded bg-rose-100 px-1.5 py-0.5 text-[11px] font-semibold text-rose-700">
                            🚚 발송 {shortfallOf(p)} 부족
                          </span>
                        )}
                      </span>
                    ) : (
                      <span className="text-[12.5px] text-mute">무제한</span>
                    )}
                  </td>
                  <td data-label="안전재고" className="py-3 pr-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <input
                        type="number"
                        inputMode="numeric"
                        min={0}
                        value={safety[p.id] ?? ""}
                        placeholder="없음"
                        onChange={(e) =>
                          setSafety((prev) => ({ ...prev, [p.id]: e.target.value }))
                        }
                        className="w-16 rounded-lg border border-line bg-cream px-2 py-1.5 text-right text-[13px] tabular-nums text-ink outline-none focus:border-gold"
                      />
                      <button
                        type="button"
                        onClick={() => saveSafety(p)}
                        disabled={busy}
                        className="rounded-lg border border-line px-2 py-1.5 text-[12px] text-ink-soft transition-colors enabled:hover:border-gold enabled:hover:text-gold disabled:opacity-40"
                      >
                        저장
                      </button>
                    </div>
                  </td>
                  <td data-label="거래 입력" className="py-3 pr-3">
                    {managed ? (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <select
                          value={d.kind}
                          onChange={(e) =>
                            patchDraft(p.id, { kind: e.target.value as MovementKind })
                          }
                          className="rounded-lg border border-line bg-cream px-2 py-1.5 text-[13px] text-ink"
                        >
                          {MANUAL_KINDS.map((k) => (
                            <option key={k} value={k}>
                              {k}
                            </option>
                          ))}
                        </select>
                        {d.kind === "조정" && (
                          <select
                            value={d.dir}
                            onChange={(e) =>
                              patchDraft(p.id, { dir: e.target.value as "+" | "-" })
                            }
                            className="rounded-lg border border-line bg-cream px-2 py-1.5 text-[13px] text-ink"
                          >
                            <option value="+">증(+)</option>
                            <option value="-">감(−)</option>
                          </select>
                        )}
                        <input
                          type="number"
                          inputMode="numeric"
                          min={1}
                          value={d.qty}
                          placeholder="수량"
                          onChange={(e) => patchDraft(p.id, { qty: e.target.value })}
                          className="w-20 rounded-lg border border-line bg-cream px-2 py-1.5 text-right text-[13px] tabular-nums text-ink outline-none focus:border-gold"
                        />
                        {d.kind === "입고" && (
                          <input
                            type="date"
                            value={d.expiry}
                            title="유통기한(선택)"
                            onChange={(e) => patchDraft(p.id, { expiry: e.target.value })}
                            className="rounded-lg border border-line bg-cream px-2 py-1.5 text-[13px] text-ink outline-none focus:border-gold"
                          />
                        )}
                        <input
                          type="text"
                          value={d.note}
                          placeholder="사유(선택)"
                          onChange={(e) => patchDraft(p.id, { note: e.target.value })}
                          className="min-w-[120px] flex-1 rounded-lg border border-line bg-cream px-2.5 py-1.5 text-[13px] text-ink outline-none focus:border-gold"
                        />
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-center gap-1.5">
                        <input
                          type="number"
                          inputMode="numeric"
                          min={0}
                          value={initStock[p.id] ?? ""}
                          placeholder="초기 현재고"
                          onChange={(e) =>
                            setInitStock((prev) => ({ ...prev, [p.id]: e.target.value }))
                          }
                          className="w-28 rounded-lg border border-line bg-cream px-2.5 py-1.5 text-right text-[13px] tabular-nums text-ink outline-none focus:border-gold"
                        />
                        <span className="text-[12px] text-mute">
                          입력 시 재고 관리 시작
                        </span>
                      </div>
                    )}
                  </td>
                  <td className="py-3 text-right">
                    {managed ? (
                      <button
                        type="button"
                        onClick={() => recordMovement(p)}
                        disabled={busy}
                        className="rounded-full bg-ink px-3.5 py-1.5 text-[13px] text-cream transition-colors enabled:hover:bg-gold-deep disabled:opacity-30"
                      >
                        {busy ? "처리 중…" : "기록"}
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={() => startTracking(p)}
                        disabled={busy}
                        className="rounded-full border border-gold/50 bg-gold/10 px-3 py-1.5 text-[13px] font-semibold text-gold-deep transition-colors enabled:hover:bg-gold/20 disabled:opacity-40"
                      >
                        {busy ? "처리 중…" : "관리 시작"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* 원장 이력(최근 50건) */}
      <div className="mt-8">
        <h3 className="font-serif-kr text-[15px] text-ink">원장 이력</h3>
        {movements.length === 0 ? (
          <p className="mt-3 text-[13px] text-mute">아직 기록된 거래가 없습니다.</p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="admin-cards-sm w-full border-collapse text-[13.5px] md:min-w-[640px]">
              <thead>
                <tr className="border-b border-line text-left text-[12px] text-mute">
                  <th className="py-2 pr-3 font-medium">일시</th>
                  <th className="py-2 pr-3 font-medium">상품</th>
                  <th className="py-2 pr-3 font-medium">유형</th>
                  <th className="py-2 pr-3 text-right font-medium">증감</th>
                  <th className="py-2 font-medium">사유</th>
                </tr>
              </thead>
              <tbody>
                {movements.map((m) => (
                  <tr key={m.id} className="border-b border-line/60">
                    <td data-label="일시" className="py-2 pr-3 tabular-nums text-mute">
                      {m.created_at.slice(0, 16).replace("T", " ")}
                    </td>
                    <td data-label="상품" className="py-2 pr-3 text-ink-soft">
                      {nameById.get(m.product_id) ?? m.product_id}
                    </td>
                    <td data-label="유형" className="py-2 pr-3">
                      <span
                        className={`rounded px-1.5 py-0.5 text-[11.5px] font-semibold ${KIND_BADGE[m.kind]}`}
                      >
                        {m.kind}
                      </span>
                    </td>
                    <td
                      data-label="증감"
                      className={`py-2 pr-3 text-right tabular-nums ${m.delta < 0 ? "text-rose-600" : "text-emerald-700"}`}
                    >
                      {m.delta > 0 ? `+${m.delta}` : m.delta}
                    </td>
                    <td data-label="사유" className="py-2 text-[13px] text-mute">
                      {m.note ?? ""}
                      {m.expiry_date && (
                        <span className="text-mute"> · 유통 {m.expiry_date.slice(5)}</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}

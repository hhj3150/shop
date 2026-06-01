"use client";

// 관리자: 상품 마스터 관리 — 가격·노출(판매여부)·원가·재고를 직접 수정.
//   product_catalog 가 주문 금액의 단일 출처라, 여기서 바꾼 가격은 이후 주문부터 적용된다.
//   재고는 비워두면 '무제한'(재고 미관리), 0 이면 품절로 표시한다.
import { useEffect, useMemo, useState } from "react";
import { formatKRW } from "@/lib/products";
import {
  loadCatalog,
  saveCatalogProduct,
  marginRate,
  type CatalogProduct,
} from "@/lib/catalog";

// 행별 편집 초안 — 숫자는 입력 편의를 위해 문자열로 보관(빈 재고 = 무제한).
type Draft = { price: string; cost: string; stock: string; active: boolean };

function toDraft(p: CatalogProduct): Draft {
  return {
    price: String(p.price),
    cost: String(p.cost),
    stock: p.stock === null ? "" : String(p.stock),
    active: p.active,
  };
}

export function ProductAdminPanel() {
  const [products, setProducts] = useState<CatalogProduct[]>([]);
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [loading, setLoading] = useState(true);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const rows = await loadCatalog();
        if (!alive) return;
        setProducts(rows);
        setDrafts(Object.fromEntries(rows.map((p) => [p.id, toDraft(p)])));
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

  const soldOutCount = useMemo(
    () => products.filter((p) => p.stock === 0).length,
    [products]
  );
  const hiddenCount = useMemo(
    () => products.filter((p) => !p.active).length,
    [products]
  );

  function patchDraft(id: string, patch: Partial<Draft>) {
    setDrafts((prev) => ({ ...prev, [id]: { ...prev[id], ...patch } }));
    setSavedId(null);
  }

  async function handleSave(p: CatalogProduct) {
    const d = drafts[p.id];
    if (!d) return;
    setSavingId(p.id);
    setError(null);
    try {
      const stock = d.stock.trim() === "" ? null : Number(d.stock);
      const next = {
        price: Number(d.price),
        cost: Number(d.cost),
        stock,
        active: d.active,
      };
      await saveCatalogProduct(p.id, next);
      // 저장 성공 → 로컬 상태도 즉시 반영(서버 재조회 없이 일관 유지).
      setProducts((prev) =>
        prev.map((x) =>
          x.id === p.id
            ? {
                ...x,
                price: Math.max(0, Math.round(next.price)),
                cost: Math.max(0, Math.round(next.cost)),
                stock: stock === null ? null : Math.max(0, Math.round(stock)),
                active: next.active,
              }
            : x
        )
      );
      setSavedId(p.id);
    } catch (e) {
      setError(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSavingId(null);
    }
  }

  function isDirty(p: CatalogProduct): boolean {
    const d = drafts[p.id];
    if (!d) return false;
    const stock = p.stock === null ? "" : String(p.stock);
    return (
      d.price !== String(p.price) ||
      d.cost !== String(p.cost) ||
      d.stock !== stock ||
      d.active !== p.active
    );
  }

  if (loading) {
    return <p className="mt-8 text-[14px] text-mute">상품 정보 불러오는 중…</p>;
  }

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-serif-kr text-lg text-ink">상품·재고 관리</h2>
        <div className="flex gap-2 text-[12.5px]">
          <span className="rounded-full bg-ink/5 px-2.5 py-1 text-ink-soft">
            전체 {products.length}
          </span>
          <span className="rounded-full bg-amber-100 px-2.5 py-1 text-amber-700">
            품절 {soldOutCount}
          </span>
          <span className="rounded-full bg-ink/10 px-2.5 py-1 text-mute">
            숨김 {hiddenCount}
          </span>
        </div>
      </div>
      <p className="mt-1 text-[13px] text-mute">
        가격은 이후 주문부터 적용됩니다. 재고를 비우면 무제한(미관리), 0이면 품절입니다.
      </p>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-600">
          {error}
        </p>
      )}

      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[820px] border-collapse text-[14px]">
          <thead>
            <tr className="border-b border-line text-left text-[12.5px] text-mute">
              <th className="py-2.5 pr-3 font-medium">상품</th>
              <th className="py-2.5 pr-3 font-medium">구분</th>
              <th className="py-2.5 pr-3 text-right font-medium">판매가</th>
              <th className="py-2.5 pr-3 text-right font-medium">원가</th>
              <th className="py-2.5 pr-3 text-right font-medium">마진율</th>
              <th className="py-2.5 pr-3 text-right font-medium">재고</th>
              <th className="py-2.5 pr-3 text-center font-medium">노출</th>
              <th className="py-2.5 font-medium" />
            </tr>
          </thead>
          <tbody>
            {products.map((p) => {
              const d = drafts[p.id];
              if (!d) return null;
              const rate = marginRate({ price: Number(d.price) || 0, cost: Number(d.cost) || 0 });
              const dirty = isDirty(p);
              return (
                <tr key={p.id} className="border-b border-line/70">
                  <td className="py-3 pr-3">
                    <p className="text-ink">{p.name}</p>
                    <p className="text-[12.5px] text-mute">
                      {p.volume}
                      {p.stock === 0 && (
                        <span className="ml-1.5 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] text-amber-700">
                          품절
                        </span>
                      )}
                    </p>
                  </td>
                  <td className="py-3 pr-3 text-[13px] text-ink-soft">
                    {p.tax_free ? "면세" : "과세"}
                  </td>
                  <td className="py-3 pr-3 text-right">
                    <NumInput
                      value={d.price}
                      onChange={(v) => patchDraft(p.id, { price: v })}
                    />
                  </td>
                  <td className="py-3 pr-3 text-right">
                    <NumInput
                      value={d.cost}
                      onChange={(v) => patchDraft(p.id, { cost: v })}
                    />
                  </td>
                  <td className="py-3 pr-3 text-right tabular-nums text-ink-soft">
                    {rate}%
                  </td>
                  <td className="py-3 pr-3 text-right">
                    <NumInput
                      value={d.stock}
                      placeholder="무제한"
                      onChange={(v) => patchDraft(p.id, { stock: v })}
                    />
                  </td>
                  <td className="py-3 pr-3 text-center">
                    <button
                      onClick={() => patchDraft(p.id, { active: !d.active })}
                      className={`rounded-full px-2.5 py-1 text-[12.5px] transition-colors ${
                        d.active
                          ? "bg-emerald-100 text-emerald-700"
                          : "bg-ink/10 text-mute"
                      }`}
                    >
                      {d.active ? "노출" : "숨김"}
                    </button>
                  </td>
                  <td className="py-3 text-right">
                    <button
                      onClick={() => handleSave(p)}
                      disabled={!dirty || savingId === p.id}
                      className="rounded-full border border-line px-3 py-1.5 text-[13px] text-ink-soft transition-colors enabled:hover:border-gold enabled:hover:text-gold disabled:opacity-40"
                    >
                      {savingId === p.id
                        ? "저장 중…"
                        : savedId === p.id && !dirty
                          ? "저장됨"
                          : "저장"}
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-[12.5px] text-mute">
        ※ 매장 노출 페이지는 현재 정적 카탈로그를 사용합니다. 노출/가격 변경을 매장에
        즉시 반영하려면 상품 페이지를 DB 연동(동적)으로 전환해야 합니다.
      </p>

      {/* 마진 요약(원가 기준) */}
      <div className="mt-6 rounded-2xl border border-line bg-paper p-5">
        <h3 className="font-serif-kr text-[15px] text-ink">제품별 단위 마진</h3>
        <ul className="mt-3 space-y-2">
          {products.map((p) => (
            <li
              key={p.id}
              className="flex items-baseline justify-between text-[13.5px]"
            >
              <span className="text-ink-soft">
                {p.name} <span className="text-mute">{p.volume}</span>
              </span>
              <span className="tabular-nums text-ink">
                {formatKRW(p.price - p.cost)}{" "}
                <span className="text-mute">· {marginRate(p)}%</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}

function NumInput({
  value,
  onChange,
  placeholder,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <input
      type="number"
      inputMode="numeric"
      min={0}
      value={value}
      placeholder={placeholder}
      onChange={(e) => onChange(e.target.value)}
      className="w-24 rounded-lg border border-line bg-cream px-2.5 py-1.5 text-right text-[13.5px] tabular-nums text-ink outline-none focus:border-gold"
    />
  );
}

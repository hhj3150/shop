"use client";

import { useEffect } from "react";
import { formatKRW } from "@/lib/products";

// 관리자: 회원 한 명의 주문·품목 이력을 모아 보는 모달.
//   회원 표에서 이름을 누르면 그 회원의 주문(최신순)과 각 주문의 담긴 품목을 펼쳐 본다.
type OrderLike = {
  id: string;
  order_no: string;
  status: string;
  order_type: string;
  ship_date: string | null;
  total_amount: number;
  created_at: string;
};

type ItemLike = {
  product_name: string;
  volume: string;
  qty: number;
};

// 회원 분석 요약(모달 헤더 배지). 관리자 표의 행 데이터에서 전달.
type MemberSummary = {
  ltv: number;
  confirmedCount: number;
  aov: number;
  segment: string;
  recencyDays: number | null;
};

export function MemberOrdersModal({
  memberName,
  summary,
  orders,
  itemsByOrder,
  onClose,
}: {
  memberName: string;
  summary?: MemberSummary | null;
  orders: OrderLike[];
  itemsByOrder: Map<string, ItemLike[]>;
  onClose: () => void;
}) {
  // ESC 로 닫기.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const orderCount = orders.length;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 px-4 no-print"
      onClick={onClose}
    >
      <div
        className="max-h-[80vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-cream p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <p className="eyebrow text-gold-deep">Member</p>
            <h3 className="mt-1 font-serif-kr text-xl text-ink">{memberName}님 주문 이력</h3>
            <p className="mt-0.5 text-[13px] text-mute">총 {orderCount}건</p>
            {summary && (
              <div className="mt-3 flex flex-wrap gap-1.5">
                <span className="rounded-full bg-ink/5 px-2.5 py-1 text-[12px] text-ink-soft">
                  등급 <span className="font-medium text-ink">{summary.segment}</span>
                </span>
                <span className="rounded-full bg-ink/5 px-2.5 py-1 text-[12px] text-ink-soft">
                  누적구매 <span className="tabular-nums font-medium text-ink">{formatKRW(summary.ltv)}</span>
                </span>
                <span className="rounded-full bg-ink/5 px-2.5 py-1 text-[12px] text-ink-soft">
                  확정 <span className="tabular-nums font-medium text-ink">{summary.confirmedCount}건</span>
                </span>
                <span className="rounded-full bg-ink/5 px-2.5 py-1 text-[12px] text-ink-soft">
                  객단가 <span className="tabular-nums font-medium text-ink">{formatKRW(summary.aov)}</span>
                </span>
                {summary.recencyDays !== null && (
                  <span className="rounded-full bg-ink/5 px-2.5 py-1 text-[12px] text-ink-soft">
                    최근주문 <span className="tabular-nums font-medium text-ink">{summary.recencyDays}일 전</span>
                  </span>
                )}
              </div>
            )}
          </div>
          <button
            onClick={onClose}
            className="rounded-full border border-line px-3 py-1.5 text-[13px] text-ink-soft transition-colors hover:border-gold hover:text-gold"
          >
            닫기
          </button>
        </div>

        {orderCount === 0 ? (
          <p className="mt-6 text-center text-[14px] text-mute">주문 내역이 없습니다.</p>
        ) : (
          <ul className="mt-5 space-y-3">
            {orders.map((o) => {
              const its = itemsByOrder.get(o.id) ?? [];
              return (
                <li key={o.id} className="rounded-2xl border border-line bg-paper p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[14px] tabular-nums text-ink">
                        {o.order_no}
                        <span className="ml-2 rounded-full bg-ink/5 px-2 py-0.5 text-[12px] text-ink-soft">
                          {o.order_type}
                        </span>
                      </p>
                      <p className="mt-0.5 text-[12.5px] text-mute">
                        {new Date(o.created_at).toLocaleDateString("ko-KR")}
                        {o.order_type === "단품" && o.ship_date
                          ? ` · 발송 ${o.ship_date}`
                          : ""}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[13px] font-medium text-gold-deep">{o.status}</p>
                      <p className="mt-0.5 text-[14px] tabular-nums text-ink">
                        {formatKRW(o.total_amount)}
                      </p>
                    </div>
                  </div>
                  {its.length > 0 && (
                    <ul className="mt-3 space-y-1 border-t border-line pt-3">
                      {its.map((it, idx) => (
                        <li
                          key={idx}
                          className="flex items-baseline justify-between text-[13px]"
                        >
                          <span className="text-ink-soft">
                            {it.product_name} <span className="text-mute">{it.volume}</span>
                          </span>
                          <span className="tabular-nums text-ink">×{it.qty}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

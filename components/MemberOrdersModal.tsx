"use client";

import { useEffect, useState } from "react";
import { formatKRW } from "@/lib/products";
import { ProfileEditor, type ProfileEditValues } from "@/components/ProfileEditor";

// 관리자: 회원 한 명의 주문·품목 이력을 모아 보는 모달.
//   회원 표에서 이름을 누르면 그 회원의 주문(최신순)과 각 주문의 담긴 품목을 펼쳐 본다.
type OrderLike = {
  id: string;
  order_no: string;
  status: string;
  order_type: string;
  block_weeks: number | null; // 구독 주문이면 신청 회차(=주수). 단품이면 의미 없음.
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

// 모달에서 정정 가능한 회원 기준 정보. 관리자 표의 행 데이터에서 전달.
type MemberInfo = ProfileEditValues;

export function MemberOrdersModal({
  memberName,
  summary,
  member,
  orders,
  itemsByOrder,
  onSaveMember,
  onClose,
}: {
  memberName: string;
  summary?: MemberSummary | null;
  member?: MemberInfo | null;
  orders: OrderLike[];
  itemsByOrder: Map<string, ItemLike[]>;
  // 회원 기준 정보(연락처·주소) 저장. 실패 시 throw 하면 폼이 오류를 표시한다.
  onSaveMember?: (values: ProfileEditValues) => Promise<void>;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState(false);

  // ESC 로 닫기.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const orderCount = orders.length;
  // 이 회원이 신청한 정기구독 기간(주수)을 요약한다 — 같은 주수는 합쳐 "8주×2" 처럼 보인다.
  //   회원 정보를 펼치지 않아도 '몇 주 구독 신청자'인지 한눈에 보이게 한다.
  const subWeeksLabel = (() => {
    const counts = new Map<number, number>();
    for (const o of orders) {
      if (o.order_type === "구독" && o.block_weeks) {
        counts.set(o.block_weeks, (counts.get(o.block_weeks) ?? 0) + 1);
      }
    }
    if (counts.size === 0) return "";
    return [...counts.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([w, n]) => (n > 1 ? `${w}주×${n}` : `${w}주`))
      .join(", ");
  })();

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
            <p className="mt-0.5 text-[13px] text-mute">
              총 {orderCount}건
              {subWeeksLabel && (
                <span className="ml-1.5 text-gold-deep">· 정기구독 {subWeeksLabel}</span>
              )}
            </p>
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

        {/* 회원 기준 정보 — 잘못 기재된 연락처·주소를 관리자가 정정한다. */}
        {member && onSaveMember && (
          <div className="mt-5 rounded-2xl border border-line bg-paper p-4">
            {editing ? (
              <>
                <p className="mb-3 text-[13px] font-medium text-ink">회원 정보 수정</p>
                <ProfileEditor
                  initial={member}
                  saveLabel="회원 정보 저장"
                  onSave={async (values) => {
                    await onSaveMember(values);
                    setEditing(false);
                  }}
                  onCancel={() => setEditing(false)}
                />
              </>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <div className="text-[13px] leading-relaxed text-ink-soft">
                  <p className="tabular-nums text-ink">{member.phone || "연락처 없음"}</p>
                  <p className="mt-0.5 text-mute">
                    {member.address
                      ? `${member.postcode ? `(${member.postcode}) ` : ""}${member.address} ${member.address_detail ?? ""}`
                      : "주소 없음"}
                  </p>
                </div>
                <button
                  onClick={() => setEditing(true)}
                  className="shrink-0 rounded-full border border-line px-3 py-1.5 text-[13px] text-ink-soft transition-colors hover:border-gold hover:text-gold"
                >
                  정보 수정
                </button>
              </div>
            )}
          </div>
        )}

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
                        {o.order_type === "구독" && o.block_weeks ? (
                          <span className="ml-1.5 rounded-full bg-gold/15 px-2 py-0.5 text-[12px] font-medium text-gold-deep">
                            {o.block_weeks}주 구독
                          </span>
                        ) : null}
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

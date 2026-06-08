"use client";

import { useEffect, useState } from "react";
import { formatKRW } from "@/lib/products";
import { ProfileEditor, type ProfileEditValues } from "@/components/ProfileEditor";
import type { Customer360, SubState } from "@/lib/customer-360";

// 관리자: 고객 한 명의 전체 맥락(구독 회차·주문·입금·송장·영수증·환불)을 오른쪽 드로어에 모아 본다.
//   읽기 전용. 단, 회원 기준 정보(연락처·주소)는 잘못 기재된 값을 정정할 수 있다.
const SUB_TONE: Record<SubState, string> = {
  활성: "bg-emerald-100 text-emerald-700",
  정지: "bg-amber-100 text-amber-700",
  완료: "bg-ink/10 text-mute",
  해지: "bg-rose-100 text-rose-700",
};

export function Customer360Drawer({
  data,
  onSaveMember,
  onClose,
}: {
  data: Customer360;
  // 회원 기준 정보 저장. 프로필이 없으면(주문만 있는 사용자) 호출 측에서 undefined.
  onSaveMember?: (values: ProfileEditValues) => Promise<void>;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [openOrder, setOpenOrder] = useState<string | null>(data.orders[0]?.id ?? null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { header, subscriptions, orders, refunds } = data;
  const { summary, profile } = header;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-ink/40 no-print"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-md flex-col overflow-y-auto bg-cream shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="sticky top-0 z-10 border-b border-line bg-cream/95 px-6 py-5 backdrop-blur">
          <div className="flex items-start justify-between">
            <div>
              <p className="eyebrow text-gold-deep">Customer 360</p>
              <h3 className="mt-1 font-serif-kr text-xl text-ink">{header.name}님</h3>
            </div>
            <button
              onClick={onClose}
              className="rounded-full border border-line px-3 py-1.5 text-[13px] text-ink-soft transition-colors hover:border-gold hover:text-gold"
            >
              닫기
            </button>
          </div>
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

        <div className="flex-1 px-6 py-5">
          {/* 회원 기준 정보 — 잘못된 연락처·주소를 관리자가 정정. */}
          {profile && onSaveMember && (
            <div className="rounded-2xl border border-line bg-paper p-4">
              {editing ? (
                <ProfileEditor
                  initial={{
                    name: profile.name,
                    phone: profile.phone,
                    postcode: profile.postcode ?? "",
                    address: profile.address ?? "",
                    address_detail: profile.address_detail ?? "",
                  }}
                  saveLabel="회원 정보 저장"
                  onSave={async (values) => {
                    await onSaveMember(values);
                    setEditing(false);
                  }}
                  onCancel={() => setEditing(false)}
                />
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="text-[13px] leading-relaxed text-ink-soft">
                    <p className="tabular-nums text-ink">{profile.phone || "연락처 없음"}</p>
                    <p className="mt-0.5 text-mute">
                      {profile.address
                        ? `${profile.postcode ? `(${profile.postcode}) ` : ""}${profile.address} ${profile.address_detail ?? ""}`
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

          {/* 구독 현황 */}
          <section className="mt-5">
            <p className="eyebrow text-gold-deep">구독 현황 ({subscriptions.length})</p>
            {subscriptions.length === 0 ? (
              <p className="mt-2 text-[13px] text-mute">구독 내역이 없습니다.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {subscriptions.map((s) => (
                  <li
                    key={s.slotId}
                    className="flex items-center justify-between rounded-xl border border-line bg-paper px-3.5 py-2.5 text-[13px]"
                  >
                    <span className="text-ink">
                      {s.weekdayLabel}요일 구독
                      <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] ${SUB_TONE[s.state]}`}>
                        {s.state}
                      </span>
                    </span>
                    <span className="tabular-nums text-ink-soft">
                      <span className="font-medium text-ink">
                        {s.round}/{s.total}회차
                      </span>
                      {s.state !== "해지" && <span className="ml-1.5 text-mute">잔여 {s.remaining}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 주문 이력 — 입금·송장·영수증 인라인 */}
          <section className="mt-6">
            <p className="eyebrow text-gold-deep">주문 이력 ({orders.length})</p>
            {orders.length === 0 ? (
              <p className="mt-2 text-[13px] text-mute">주문 내역이 없습니다.</p>
            ) : (
              <ul className="mt-2 space-y-2.5">
                {orders.map((o) => {
                  const open = openOrder === o.id;
                  return (
                    <li key={o.id} className="rounded-2xl border border-line bg-paper p-4">
                      <button
                        aria-expanded={open}
                        className="flex w-full items-start justify-between gap-3 text-left"
                        onClick={() => setOpenOrder(open ? null : o.id)}
                      >
                        <div>
                          <p className="text-[14px] tabular-nums text-ink">
                            {o.orderNo}
                            <span className="ml-2 rounded-full bg-ink/5 px-2 py-0.5 text-[12px] text-ink-soft">
                              {o.orderType}
                            </span>
                            {o.orderType === "구독" && o.blockWeeks ? (
                              <span className="ml-1.5 rounded-full bg-gold/15 px-2 py-0.5 text-[12px] font-medium text-gold-deep">
                                {o.blockWeeks}주 구독
                              </span>
                            ) : null}
                          </p>
                          <p className="mt-0.5 text-[12.5px] text-mute">
                            {new Date(o.createdAt).toLocaleDateString("ko-KR")}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-[13px] font-medium text-gold-deep">{o.status}</p>
                          <p className="mt-0.5 text-[14px] tabular-nums text-ink">{formatKRW(o.totalAmount)}</p>
                        </div>
                      </button>

                      {open && (
                        <div className="mt-3 space-y-2 border-t border-line pt-3 text-[12.5px]">
                          <div className="space-y-0.5 text-ink-soft">
                            {o.deposit && (
                              <p>
                                · 입금 {o.deposit.paidAt ? new Date(o.deposit.paidAt).toLocaleDateString("ko-KR") : "—"}
                                {o.deposit.payMethod ? ` (${o.deposit.payMethod})` : ""}
                              </p>
                            )}
                            {o.tracking && (
                              <p>
                                · 송장 {o.tracking.courier ?? ""} <span className="tabular-nums">{o.tracking.trackingNo ?? "—"}</span>
                                {o.tracking.shippedAt ? ` (${new Date(o.tracking.shippedAt).toLocaleDateString("ko-KR")} 발송)` : ""}
                              </p>
                            )}
                            {o.receipt && (
                              <p>
                                · 영수증 {o.receipt.type} {o.receipt.issued ? "✓발행" : "미발행"}
                              </p>
                            )}
                            {!o.deposit && !o.tracking && !o.receipt && (
                              <p className="text-mute">입금·송장·영수증 정보 없음</p>
                            )}
                          </div>
                          {o.items.length > 0 && (
                            <ul className="space-y-1 border-t border-line pt-2">
                              {o.items.map((it, idx) => (
                                <li key={`${it.productName}-${it.volume}-${idx}`} className="flex items-baseline justify-between">
                                  <span className="text-ink-soft">
                                    {it.productName} <span className="text-mute">{it.volume}</span>
                                  </span>
                                  <span className="tabular-nums text-ink">×{it.qty}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* 환불·해지 */}
          {refunds.length > 0 && (
            <section className="mt-6">
              <p className="eyebrow text-gold-deep">환불·해지 ({refunds.length})</p>
              <ul className="mt-2 space-y-1.5">
                {refunds.map((r, idx) => (
                  <li
                    key={`${r.source}-${r.label}-${r.date ?? idx}`}
                    className="flex items-center justify-between rounded-xl border border-line bg-paper px-3.5 py-2.5 text-[13px]"
                  >
                    <span className="text-ink-soft">
                      {r.label}
                      {r.date && <span className="ml-1.5 text-mute">{new Date(r.date).toLocaleDateString("ko-KR")}</span>}
                    </span>
                    <span className="tabular-nums text-ink">환불 {formatKRW(r.amount)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

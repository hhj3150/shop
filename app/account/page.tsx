"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { formatKRW, PERIOD_LABEL, type SubPeriod } from "@/lib/products";
import { DELIVERY_DAY_LABEL } from "@/lib/cart";
import {
  getMySubscriptions,
  pauseSubscription,
  resumeSubscription,
  cancelSubscription,
  refundAmount,
  type MySubscription,
} from "@/lib/subscriptions";
import { computeSchedule } from "@/lib/subscription-schedule";

type OrderRow = {
  id: string;
  order_no: string;
  status: string;
  total_amount: number;
  created_at: string;
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function AccountPage() {
  const router = useRouter();
  const { ready, user, profile, signOut } = useAuth();
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [subs, setSubs] = useState<MySubscription[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [cancelSlot, setCancelSlot] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [refundAcct, setRefundAcct] = useState("");

  useEffect(() => {
    if (ready && !user) router.replace("/login?next=/account");
  }, [ready, user, router]);

  useEffect(() => {
    if (!user) return;
    getSupabase()
      .from("orders")
      .select("id, order_no, status, total_amount, created_at")
      .order("created_at", { ascending: false })
      .then(({ data }) => setOrders((data as OrderRow[]) ?? []));
  }, [user]);

  function reloadSubs() {
    getMySubscriptions()
      .then(setSubs)
      .catch(() => setSubs([]));
  }

  useEffect(() => {
    if (!user) return;
    reloadSubs();
  }, [user]);

  async function onPause(slotId: number) {
    setBusy(slotId);
    try {
      await pauseSubscription(slotId);
      reloadSubs();
    } catch (e) {
      alert(e instanceof Error ? e.message : "일시정지에 실패했습니다.");
    } finally {
      setBusy(null);
    }
  }

  async function onResume(slotId: number) {
    setBusy(slotId);
    try {
      await resumeSubscription(slotId);
      reloadSubs();
    } catch (e) {
      alert(e instanceof Error ? e.message : "재개에 실패했습니다.");
    } finally {
      setBusy(null);
    }
  }

  function openCancel(slotId: number) {
    setCancelSlot(slotId);
    setReason("");
    setRefundAcct("");
  }

  async function onCancel(slotId: number, refund: number, remaining: number) {
    if (!reason.trim()) {
      alert("중지 사유를 입력해 주세요.");
      return;
    }
    if (!refundAcct.trim()) {
      alert("환불받으실 계좌를 입력해 주세요.");
      return;
    }
    if (
      !confirm(
        `구독을 해지하시겠어요?\n남은 ${remaining}회분 ${formatKRW(
          refund
        )}이 입력하신 계좌로 환불됩니다. 이 작업은 되돌릴 수 없습니다.`
      )
    )
      return;
    setBusy(slotId);
    try {
      await cancelSubscription(slotId, reason.trim(), refundAcct.trim(), refund);
      setCancelSlot(null);
      setReason("");
      setRefundAcct("");
      reloadSubs();
    } catch (e) {
      alert(e instanceof Error ? e.message : "해지에 실패했습니다.");
    } finally {
      setBusy(null);
    }
  }

  if (!ready || !user) {
    return (
      <div className="mx-auto max-w-md px-5 pt-28 text-center text-mute sm:px-8">
        불러오는 중…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-5 pb-24 pt-28 sm:px-8">
      <div className="flex items-end justify-between">
        <div>
          <p className="eyebrow text-gold-deep">My Page</p>
          <h1 className="mt-3 font-serif-kr text-[clamp(1.7rem,5vw,2.3rem)] font-medium text-ink">
            {profile?.name ?? "회원"}님
          </h1>
        </div>
        <button
          onClick={() => signOut().then(() => router.push("/"))}
          className="rounded-full border border-line px-4 py-2 text-[14px] text-ink-soft transition-colors hover:border-gold hover:text-gold"
        >
          로그아웃
        </button>
      </div>

      {profile && (
        <div className="mt-8 rounded-2xl border border-line bg-cream p-6 text-[14px] leading-relaxed text-ink-soft">
          <p>{profile.phone}</p>
          {profile.address && (
            <p className="mt-1 text-mute">
              ({profile.postcode}) {profile.address} {profile.address_detail}
            </p>
          )}
          {profile.is_admin && (
            <Link
              href="/admin"
              className="mt-4 inline-flex rounded-full bg-ink px-5 py-2.5 text-[14px] text-cream transition-colors hover:bg-gold-deep"
            >
              관리자 모드
            </Link>
          )}
        </div>
      )}

      {subs.length > 0 && (
        <>
          <h2 className="mt-12 font-serif-kr text-lg text-ink">정기구독</h2>
          <ul className="mt-4 space-y-4">
            {subs.map((s) => {
              const sch = computeSchedule({
                startedAt: s.startedAt,
                totalWeeks: s.totalWeeks,
                paused: s.paused,
                pausedAt: s.pausedAt,
                pausedDays: s.pausedDays,
              });
              const canPause = s.status === "활성" && !s.paused;
              const canCancel = s.status === "활성" || s.status === "대기";
              const refund = refundAmount(s, sch.remaining);
              return (
                <li
                  key={s.slotId}
                  className="rounded-2xl border border-line bg-cream p-6"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[15px] font-medium text-ink">
                        {PERIOD_LABEL[(s.periodMonths as SubPeriod) ?? 1]} 구독
                        <span className="ml-2 text-[13px] text-mute">
                          매주 {DELIVERY_DAY_LABEL[s.deliveryDay]}요일
                        </span>
                      </p>
                      {s.orderNo && (
                        <p className="mt-0.5 text-[13px] tabular-nums text-mute">
                          {s.orderNo}
                        </p>
                      )}
                    </div>
                    {s.paused ? (
                      <span className="shrink-0 rounded-full bg-gold/15 px-3 py-1 text-[12px] font-medium text-gold-deep">
                        일시정지 중
                      </span>
                    ) : (
                      <span className="shrink-0 rounded-full bg-ink/5 px-3 py-1 text-[12px] font-medium text-ink-soft">
                        {s.status}
                      </span>
                    )}
                  </div>

                  {sch.started ? (
                    <dl className="mt-4 grid grid-cols-2 gap-y-2 text-[14px] sm:grid-cols-4">
                      <div>
                        <dt className="text-[12px] text-mute">발송 완료</dt>
                        <dd className="tabular-nums text-ink">
                          {sch.delivered} / {sch.total}회
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[12px] text-mute">남은 횟수</dt>
                        <dd className="tabular-nums text-ink">{sch.remaining}회</dd>
                      </div>
                      <div>
                        <dt className="text-[12px] text-mute">다음 발송</dt>
                        <dd className="text-ink">
                          {sch.paused ? "정지 중" : fmtDate(sch.nextDate)}
                        </dd>
                      </div>
                      <div>
                        <dt className="text-[12px] text-mute">종료 예정</dt>
                        <dd className="text-ink">{fmtDate(sch.endDate)}</dd>
                      </div>
                    </dl>
                  ) : (
                    <p className="mt-4 text-[14px] text-mute">
                      입금 확인 후 배송이 시작됩니다.
                    </p>
                  )}

                  {(canPause || s.paused) && (
                    <div className="mt-5">
                      {s.paused ? (
                        <button
                          onClick={() => onResume(s.slotId)}
                          disabled={busy === s.slotId}
                          className="rounded-full bg-ink px-5 py-2.5 text-[14px] text-cream transition-colors hover:bg-gold-deep disabled:opacity-50"
                        >
                          {busy === s.slotId ? "처리 중…" : "배송 재개"}
                        </button>
                      ) : (
                        <button
                          onClick={() => onPause(s.slotId)}
                          disabled={busy === s.slotId}
                          className="rounded-full border border-line px-5 py-2.5 text-[14px] text-ink-soft transition-colors hover:border-gold hover:text-gold disabled:opacity-50"
                        >
                          {busy === s.slotId ? "처리 중…" : "일시정지"}
                        </button>
                      )}
                      <p className="mt-2 text-[12px] leading-relaxed text-mute">
                        일시정지 기간은 배송 횟수에서 제외되며, 종료 예정일이 정지한
                        기간만큼 미뤄집니다. 총 {sch.total}회는 모두 배송됩니다.
                      </p>
                    </div>
                  )}

                  {canCancel && sch.started && (
                    <div className="mt-4 border-t border-line pt-4">
                      {cancelSlot === s.slotId ? (
                        <div className="rounded-2xl bg-paper-2 p-4">
                          <p className="text-[14px] font-medium text-ink">구독 해지</p>
                          <div className="mt-3 flex items-center justify-between rounded-xl bg-cream px-4 py-3">
                            <span className="text-[13px] text-ink-soft">
                              남은 {sch.remaining}회분 환불 예정액
                            </span>
                            <span className="font-serif-kr text-lg tabular-nums text-gold-deep">
                              {formatKRW(refund)}
                            </span>
                          </div>
                          <label className="mt-3 block text-[12px] text-mute">
                            중지 사유
                            <textarea
                              value={reason}
                              onChange={(e) => setReason(e.target.value)}
                              rows={2}
                              placeholder="해지하시는 이유를 적어 주세요."
                              className="mt-1 w-full rounded-xl border border-line bg-cream px-3 py-2 text-[14px] text-ink outline-none focus:border-gold"
                            />
                          </label>
                          <label className="mt-3 block text-[12px] text-mute">
                            환불받으실 계좌 (은행·예금주·계좌번호)
                            <input
                              type="text"
                              value={refundAcct}
                              onChange={(e) => setRefundAcct(e.target.value)}
                              placeholder="예: 농협 송영신 123-4567-8901"
                              className="mt-1 w-full rounded-xl border border-line bg-cream px-3 py-2 text-[14px] text-ink outline-none focus:border-gold"
                            />
                          </label>
                          <div className="mt-4 flex gap-2">
                            <button
                              onClick={() => onCancel(s.slotId, refund, sch.remaining)}
                              disabled={busy === s.slotId}
                              className="flex-1 rounded-full bg-ink py-2.5 text-[14px] text-cream transition-colors hover:bg-gold-deep disabled:opacity-50"
                            >
                              {busy === s.slotId ? "처리 중…" : "해지하고 환불 신청"}
                            </button>
                            <button
                              onClick={() => setCancelSlot(null)}
                              disabled={busy === s.slotId}
                              className="rounded-full border border-line px-5 py-2.5 text-[14px] text-ink-soft transition-colors hover:border-gold disabled:opacity-50"
                            >
                              취소
                            </button>
                          </div>
                          <p className="mt-3 text-[12px] leading-relaxed text-mute">
                            해지하시면 이후 배송이 중단되고, 남은 회차분이 입력하신 계좌로
                            환불됩니다. 환불은 입금 확인 후 수동으로 처리됩니다.
                          </p>
                        </div>
                      ) : (
                        <button
                          onClick={() => openCancel(s.slotId)}
                          className="text-[13px] text-mute underline transition-colors hover:text-ink"
                        >
                          구독 해지 · 남은 회차 환불
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      )}

      <h2 className="mt-12 font-serif-kr text-lg text-ink">주문 내역</h2>
      {orders.length === 0 ? (
        <p className="mt-4 text-[14px] text-mute">
          아직 주문이 없습니다.{" "}
          <Link href="/#products" className="text-gold-deep underline">
            제품 보러 가기
          </Link>
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-line rounded-2xl border border-line bg-cream">
          {orders.map((o) => (
            <li key={o.id} className="flex items-center justify-between px-5 py-4">
              <div>
                <p className="text-[14px] tabular-nums text-ink">{o.order_no}</p>
                <p className="mt-0.5 text-[13px] text-mute">
                  {new Date(o.created_at).toLocaleDateString("ko-KR")}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[13px] font-medium text-gold-deep">{o.status}</p>
                <p className="mt-0.5 text-[14px] tabular-nums text-ink">
                  {formatKRW(o.total_amount)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

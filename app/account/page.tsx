"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { formatKRW, PERIOD_LABEL, type SubPeriod } from "@/lib/products";
import { DELIVERY_DAY_LABEL, type DeliveryDay } from "@/lib/cart";
import { registerPayActionDeposit } from "@/lib/orders";
import {
  getMySubscriptions,
  pauseSubscription,
  resumeSubscription,
  cancelSubscription,
  cancelUnpaidOrder,
  requestRenewal,
  refundAmount,
  type MySubscription,
} from "@/lib/subscriptions";
import { computeSchedule } from "@/lib/subscription-schedule";
import { speak } from "@/lib/speech";
import { courierLabel, trackingUrl } from "@/lib/couriers";
import { notify } from "@/lib/notify";
import { DEPOSIT } from "@/lib/site";
import { RecipientBook } from "@/components/RecipientBook";
import { ShareButton } from "@/components/ShareButton";
import { ReferralCard } from "@/components/ReferralCard";
import { ProfileEditor, type ProfileEditValues } from "@/components/ProfileEditor";

type RenewalInfo = { slotId: number; orderNo: string; total: number };

type OrderRow = {
  id: string;
  order_no: string;
  status: string;
  total_amount: number;
  courier: string | null;
  tracking_no: string | null;
  created_at: string;
};

// 주문 품목 한 줄(제품·용량·단가·수량·요일). 분쟁 방지를 위해 단가와 줄 합계,
//   구독 배송요일까지 고객에게 그대로 보여준다(관리자 화면과 동일한 원장).
type OrderItemRow = {
  order_id: string;
  product_name: string;
  volume: string;
  qty: number;
  unit_price: number;
  delivery_day: DeliveryDay | null;
};

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// 주문 시각(연·월·일 시:분). 분쟁 시 "언제 주문했는지" 근거가 되도록 분 단위까지 표기.
function fmtDateTime(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

// 본인 주문 + 품목을 한 번에 조회(RLS가 본인으로 한정). setState 없는 순수 조회 함수 —
//   effect/핸들러 양쪽에서 재사용하고, 호출부에서 결과로 상태를 갱신한다.
async function fetchOrdersWithItems(userId: string): Promise<{
  orders: OrderRow[];
  items: Record<string, OrderItemRow[]>;
}> {
  const supabase = getSupabase();
  // 본인 것만 — 관리자 계정은 RLS상 전체 주문 조회가 가능하므로 user_id 를 반드시 명시한다.
  const { data } = await supabase
    .from("orders")
    .select("id, order_no, status, total_amount, courier, tracking_no, created_at")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  const orders = (data as OrderRow[]) ?? [];
  if (orders.length === 0) return { orders, items: {} };

  const { data: itemData } = await supabase
    .from("order_items")
    .select("order_id, product_name, volume, qty, unit_price, delivery_day")
    .in(
      "order_id",
      orders.map((o) => o.id)
    );
  // order_id 별로 묶는다(불변 누적).
  const items = ((itemData as OrderItemRow[]) ?? []).reduce<Record<string, OrderItemRow[]>>(
    (acc, it) => ({
      ...acc,
      [it.order_id]: [...(acc[it.order_id] ?? []), it],
    }),
    {}
  );
  return { orders, items };
}

export default function AccountPage() {
  const router = useRouter();
  const { ready, user, profile, signOut, refreshProfile } = useAuth();
  const [editingInfo, setEditingInfo] = useState(false);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [orderItems, setOrderItems] = useState<Record<string, OrderItemRow[]>>({});
  const [subs, setSubs] = useState<MySubscription[]>([]);
  const [busy, setBusy] = useState<number | null>(null);
  const [busyOrder, setBusyOrder] = useState<string | null>(null);
  const [cancelSlot, setCancelSlot] = useState<number | null>(null);
  const [reason, setReason] = useState("");
  const [refundAcct, setRefundAcct] = useState("");
  const [renewal, setRenewal] = useState<RenewalInfo | null>(null);

  useEffect(() => {
    if (ready && !user) router.replace("/login?next=/account");
  }, [ready, user, router]);

  // 핸들러(주문 취소·갱신)에서 호출하는 재조회 래퍼.
  async function reloadOrders() {
    if (!user) return;
    const { orders, items } = await fetchOrdersWithItems(user.id);
    setOrders(orders);
    setOrderItems(items);
  }

  useEffect(() => {
    if (!user) return;
    let alive = true;
    (async () => {
      const { orders, items } = await fetchOrdersWithItems(user.id);
      if (!alive) return;
      setOrders(orders);
      setOrderItems(items);
    })();
    return () => {
      alive = false;
    };
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
      // 환불액은 서버가 재계산한다(C2). refund 는 위 확인창의 미리보기 값일 뿐이다.
      await cancelSubscription(slotId, reason.trim(), refundAcct.trim());
      void notify({ kind: "subscription_cancelled", slotId });
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

  async function onRenew(s: MySubscription) {
    setBusy(s.slotId);
    try {
      // STOPGAP(Task 4.2 에서 교체): 연장 신청 폼(품목·요일·회차 편집)이 아직 없다.
      // requestRenewal 의 신 시그니처에 맞춰 현재 슬롯의 요일·기간을 그대로 넘긴다.
      // items 는 폼에서 채워질 예정(현재는 검증 단계에서 안내 메시지로 막힌다).
      const res = await requestRenewal(s.slotId, {
        items: [],
        period: s.periodMonths as SubPeriod,
        deliveryDay: s.deliveryDay,
      });
      // 갱신 주문을 PayAction 에 등록 → 회원이 안내된 금액을 입금하면 자동으로 입금확인(반자동 갱신).
      await registerPayActionDeposit(res.orderNo, profile?.phone ?? "");
      setRenewal({ slotId: s.slotId, orderNo: res.orderNo, total: res.total });
      void notify({ kind: "renewal_guide", orderId: res.orderId });
      reloadOrders();
    } catch (e) {
      alert(e instanceof Error ? e.message : "구독 연장 신청에 실패했습니다.");
    } finally {
      setBusy(null);
    }
  }

  // 본인 기준 정보(연락처·주소) 저장. RLS(profiles_update_own)가 본인 행으로 한정한다.
  //   저장 후 프로필을 다시 불러와 화면(그리고 다음 주문 자동 입력값)에 즉시 반영한다.
  //   관리자 화면은 같은 profiles 테이블을 30초마다 자동 새로고침하므로 함께 반영된다.
  async function saveMyInfo(values: ProfileEditValues) {
    if (!user) return;
    const { error } = await getSupabase()
      .from("profiles")
      .update({
        name: values.name,
        phone: values.phone,
        postcode: values.postcode || null,
        address: values.address || null,
        address_detail: values.address_detail || null,
      })
      .eq("id", user.id);
    if (error) throw new Error(error.message);
    await refreshProfile();
    setEditingInfo(false);
  }

  async function onCancelOrder(orderId: string, orderNo: string) {
    if (
      !confirm(
        `${orderNo} 주문을 취소하시겠어요?\n입금 전 주문이라 환불 절차 없이 취소되며, 정기구독이라면 선착순 자리도 반환됩니다.`
      )
    )
      return;
    setBusyOrder(orderId);
    try {
      await cancelUnpaidOrder(orderId);
      reloadOrders();
      reloadSubs();
    } catch (e) {
      alert(e instanceof Error ? e.message : "주문 취소에 실패했습니다.");
    } finally {
      setBusyOrder(null);
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
        <div className="mt-8 rounded-2xl border border-line bg-cream p-6">
          {editingInfo ? (
            <>
              <p className="mb-4 text-[13px] font-medium text-ink">내 정보 수정</p>
              <ProfileEditor
                initial={{
                  name: profile.name,
                  phone: profile.phone,
                  postcode: profile.postcode ?? "",
                  address: profile.address ?? "",
                  address_detail: profile.address_detail ?? "",
                }}
                onSave={saveMyInfo}
                onCancel={() => setEditingInfo(false)}
              />
            </>
          ) : (
            <div className="text-[14px] leading-relaxed text-ink-soft">
              <div className="flex items-start justify-between gap-3">
                <p>{profile.phone}</p>
                <button
                  onClick={() => setEditingInfo(true)}
                  className="shrink-0 rounded-full border border-line px-3.5 py-1.5 text-[13px] text-ink-soft transition-colors hover:border-gold hover:text-gold"
                >
                  정보 수정
                </button>
              </div>
              {profile.address ? (
                <p className="mt-1 text-mute">
                  ({profile.postcode}) {profile.address} {profile.address_detail}
                </p>
              ) : (
                <p className="mt-1 text-mute">
                  배송 주소가 아직 없습니다. ‘정보 수정’에서 등록해 주세요.
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
        </div>
      )}

      <ReferralCard />

      <ShareButton />

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
                        {PERIOD_LABEL[s.periodMonths as SubPeriod] ?? `${s.periodMonths ?? 1}개월`} 구독
                        <span className="ml-2 text-[13px] text-mute">
                          매주 {DELIVERY_DAY_LABEL[s.deliveryDay]}
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

                  {s.status === "활성" && (
                    <div className="mt-4">
                      {renewal && renewal.slotId === s.slotId ? (
                        <div className="rounded-2xl bg-paper-2 p-4">
                          <p className="text-[14px] font-medium text-ink">
                            연장 입금 안내
                          </p>
                          <div className="mt-3 flex items-center justify-between rounded-xl bg-cream px-4 py-3">
                            <span className="text-[13px] text-ink-soft">
                              연장 금액 (1개월 · 4회)
                            </span>
                            <span className="font-serif-kr text-lg tabular-nums text-gold-deep">
                              {formatKRW(renewal.total)}
                            </span>
                          </div>
                          <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">
                            아래 계좌로 <span className="tabular-nums">{renewal.orderNo}</span>{" "}
                            주문의 금액을 입금해 주세요. 입금이 확인되면 같은 요일로 4회분이
                            이어집니다.
                          </p>
                          <p className="mt-2 rounded-xl bg-cream px-4 py-3 text-[13px] text-ink">
                            {DEPOSIT.bank} {DEPOSIT.account} (예금주 {DEPOSIT.holder})
                          </p>
                          <button
                            onClick={() => setRenewal(null)}
                            className="mt-3 rounded-full border border-line px-5 py-2 text-[13px] text-ink-soft transition-colors hover:border-gold hover:text-gold"
                          >
                            확인
                          </button>
                        </div>
                      ) : (
                        <>
                          {!s.paused && sch.started && sch.remaining <= 2 && (
                            <div className="mb-3 rounded-2xl border border-gold/50 bg-gold/10 p-4">
                              <p className="text-[14px] font-medium text-gold-deep">
                                정기배송이 곧 끝나요
                              </p>
                              <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
                                남은 {sch.remaining}회 · 종료 예정 {fmtDate(sch.endDate)}. 다시
                                받아보시려면 아래에서 연장하실 수 있어요.
                              </p>
                              <button
                                type="button"
                                onClick={() =>
                                  speak(
                                    `${PERIOD_LABEL[s.periodMonths as SubPeriod] ?? `${s.periodMonths ?? 1}개월`} 정기구독이 곧 끝나요. 남은 횟수 ${sch.remaining}회, 종료 예정 ${fmtDate(sch.endDate)}입니다. 다시 받아보시겠어요? 연장하시면 같은 요일로 이어집니다.`
                                  ).catch(() => {})
                                }
                                className="mt-2 inline-flex items-center gap-1.5 rounded-full border border-gold/50 px-4 py-2 text-[13px] text-gold-deep transition-colors hover:bg-gold/15"
                              >
                                <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                                  <path d="M11 5L6 9H2v6h4l5 4V5z" strokeLinecap="round" strokeLinejoin="round" />
                                  <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" strokeLinecap="round" />
                                </svg>
                                음성으로 안내 듣기
                              </button>
                            </div>
                          )}
                          <button
                            onClick={() => onRenew(s)}
                            disabled={busy === s.slotId}
                            className="rounded-full bg-ink px-5 py-2.5 text-[14px] text-cream transition-colors hover:bg-gold-deep disabled:opacity-50"
                          >
                            {busy === s.slotId ? "처리 중…" : "구독 연장 (재입금)"}
                          </button>
                          <p className="mt-2 text-[12px] leading-relaxed text-mute">
                            한 달치(4회)를 더 받으시려면 연장하세요. 입금 확인 시 같은
                            요일로 이어지며, 선착순 자리는 그대로 유지됩니다.
                          </p>
                        </>
                      )}
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
                              className="mt-1 w-full rounded-xl border border-line bg-cream px-3 py-2 text-[16px] text-ink outline-none focus:border-gold"
                            />
                          </label>
                          <label className="mt-3 block text-[12px] text-mute">
                            환불받으실 계좌 (은행·예금주·계좌번호)
                            <input
                              type="text"
                              value={refundAcct}
                              onChange={(e) => setRefundAcct(e.target.value)}
                              placeholder="예: 농협 송영신 123-4567-8901"
                              className="mt-1 w-full rounded-xl border border-line bg-cream px-3 py-2 text-[16px] text-ink outline-none focus:border-gold"
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
          {orders.map((o) => {
            const trackUrl = trackingUrl(o.courier, o.tracking_no);
            return (
              <li key={o.id} className="px-5 py-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-[14px] tabular-nums text-ink">{o.order_no}</p>
                    <p className="mt-0.5 text-[13px] text-mute">
                      {fmtDateTime(o.created_at)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[13px] font-medium text-gold-deep">{o.status}</p>
                    <p className="mt-0.5 text-[14px] tabular-nums text-ink">
                      {formatKRW(o.total_amount)}
                    </p>
                  </div>
                </div>
                {orderItems[o.id]?.length ? (
                  <ul className="mt-3 space-y-1.5 border-t border-line pt-3">
                    {orderItems[o.id].map((it, idx) => (
                      <li
                        key={idx}
                        className="flex items-baseline justify-between gap-3 text-[13px]"
                      >
                        <span className="text-ink-soft">
                          {it.product_name}{" "}
                          <span className="text-mute">{it.volume}</span>
                          {it.delivery_day ? (
                            <span className="text-mute">
                              {" · "}
                              {DELIVERY_DAY_LABEL[it.delivery_day]} 배송
                            </span>
                          ) : null}
                        </span>
                        <span className="shrink-0 tabular-nums text-ink">
                          <span className="text-mute">
                            {formatKRW(it.unit_price)} × {it.qty}
                          </span>{" "}
                          = {formatKRW(it.unit_price * it.qty)}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
                {o.tracking_no && (
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-2 rounded-xl bg-paper-2 px-3 py-2.5">
                    <p className="text-[13px] text-ink-soft">
                      {courierLabel(o.courier)}{" "}
                      <span className="tabular-nums text-ink">{o.tracking_no}</span>
                    </p>
                    {trackUrl ? (
                      <a
                        href={trackUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="rounded-full bg-ink px-4 py-1.5 text-[13px] text-cream transition-colors hover:bg-gold-deep"
                      >
                        배송조회 →
                      </a>
                    ) : (
                      <span className="text-[12px] text-mute">택배사 사이트에서 조회</span>
                    )}
                  </div>
                )}
                {o.status === "입금대기" && (
                  <div className="mt-3 flex items-center justify-end">
                    <button
                      onClick={() => onCancelOrder(o.id, o.order_no)}
                      disabled={busyOrder === o.id}
                      className="text-[13px] text-mute underline transition-colors hover:text-ink disabled:opacity-50"
                    >
                      {busyOrder === o.id ? "처리 중…" : "구매 취소"}
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <RecipientBook userId={user.id} />
    </div>
  );
}

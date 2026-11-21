import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cancel, nicepayConfig } from "@/lib/nicepay/server";
import { cancelOrderIdFor, planCancel, type CancelPlanInput } from "@/lib/nicepay/core";
import { anonClient, loadOrder } from "@/lib/nicepay/settle";

// 관리자: 카드·간편결제 전체취소 / 부분취소.
//   금액과 면세금액은 서버가 정한다(관리자 화면은 '무엇을' 취소할지만 보낸다).
//     mode=full   남은 금액 전부
//     mode=items  고른 품목·수량(+배송비) — 면세/과세를 품목별로 나눔
//     mode=amount 금액만(구독 중도해지 환불 등) — 원 결제의 면세 비율로 나눔
//   전액이 취소되면 주문도 '취소'로 바꾼다(admin_cancel_order — 구독 좌석 해지 포함).
export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  const cfg = nicepayConfig();
  const secret = process.env.CONFIRM_PAYMENT_SECRET;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const sb = anonClient();
  if (!cfg || !secret || !sb || !supabaseUrl || !anon) {
    return NextResponse.json({ ok: false, reason: "not_configured" }, { status: 503 });
  }

  // 관리자 확인(다른 관리자 라우트와 같은 방식).
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) return NextResponse.json({ ok: false, reason: "no_token" }, { status: 401 });
  const userSb = createClient(supabaseUrl, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authUser } = await userSb.auth.getUser();
  if (!authUser?.user) return NextResponse.json({ ok: false, reason: "invalid_token" }, { status: 401 });
  const { data: prof } = await userSb.from("profiles").select("is_admin").eq("id", authUser.user.id).single();
  if (!prof?.is_admin) return NextResponse.json({ ok: false, reason: "forbidden" }, { status: 403 });

  const body = (await req.json().catch(() => null)) as {
    orderNo?: string;
    mode?: "full" | "items" | "amount";
    amount?: number;
    items?: { product_id: string; qty: number }[];
    includeShipping?: boolean;
    reason?: string;
  } | null;
  const orderNo = typeof body?.orderNo === "string" ? body.orderNo.trim() : "";
  const reason = (typeof body?.reason === "string" && body.reason.trim()) || "관리자 취소";
  if (!orderNo || !body?.mode) return NextResponse.json({ ok: false, reason: "invalid_input" }, { status: 400 });

  const order = await loadOrder(sb, secret, orderNo);
  if (!order) return NextResponse.json({ ok: false, reason: "주문을 찾을 수 없습니다." }, { status: 404 });
  const { data: payRaw } = await sb.rpc("nicepay_payment_for_order", { p_secret: secret, p_order_no: orderNo });
  const pay = payRaw as {
    found?: boolean;
    tid?: string;
    amount?: number;
    tax_free_amt?: number;
    cancelled_amt?: number;
    cancelled_tax_free?: number;
    cancel_count?: number;
  } | null;
  if (!pay?.tid) return NextResponse.json({ ok: false, reason: "카드·간편결제 기록이 없는 주문입니다." }, { status: 404 });

  const base = {
    order,
    paidAmount: pay.amount ?? 0,
    paidTaxFree: pay.tax_free_amt ?? 0,
    cancelledAmt: pay.cancelled_amt ?? 0,
    cancelledTaxFree: pay.cancelled_tax_free ?? 0,
  };
  const input: CancelPlanInput =
    body.mode === "full"
      ? { ...base, mode: "full" }
      : body.mode === "amount"
        ? { ...base, mode: "amount", amount: Number(body.amount) }
        : { ...base, mode: "items", items: body.items ?? [], includeShipping: Boolean(body.includeShipping) };
  const plan = planCancel(input);
  if (!plan.ok) return NextResponse.json({ ok: false, reason: plan.reason }, { status: 400 });

  // 첫 전액취소는 원 주문번호로, 그 외(부분취소·잔액취소)는 회차마다 새 orderId(매뉴얼: 부분취소는 중복 orderId 재호출 불가).
  const cancelOrderId = plan.full ? orderNo : cancelOrderIdFor(orderNo, (pay.cancel_count ?? 0) + 1);
  // 전체취소: 금액·면세를 모두 빼고 보낸다(매뉴얼: cancelAmt 누락 = 전액취소). 면세금액만 실어 보내면
  //   나이스페이가 'U318 취소 금액 불일치'로 거절한다(2026-11-21 테스트 상점에서 확인).
  //   부분취소(잔액 취소 포함)는 취소 금액과 그중 면세금액을 함께 보낸다.
  const res = await cancel(
    cfg,
    pay.tid,
    plan.full
      ? { orderId: cancelOrderId, reason }
      : { orderId: cancelOrderId, reason, cancelAmt: plan.cancelAmt, taxFreeAmt: plan.taxFreeAmt }
  );
  if (res.kind !== "ok") {
    // 응답을 못 받음 — 취소됐는지 모른다. 나이스페이 관리자에서 확인하도록 안내(자동 재시도는 이중 취소 위험).
    return NextResponse.json(
      { ok: false, reason: "나이스페이 응답이 없습니다. 나이스페이 관리자에서 취소 여부를 확인해 주세요." },
      { status: 504 }
    );
  }
  if (res.data.resultCode !== "0000") {
    // 원인 대조용(키·서명 없음): 무엇을 보냈고 무엇이 돌아왔는지.
    console.warn("[admin/payments/cancel] 거절:", orderNo, {
      full: plan.full,
      cancelOrderId,
      cancelAmt: plan.full ? null : plan.cancelAmt,
      taxFreeAmt: plan.full ? null : plan.taxFreeAmt,
      resultCode: res.data.resultCode,
      resultMsg: res.data.resultMsg,
    });
    return NextResponse.json(
      { ok: false, reason: `취소 실패: ${res.data.resultMsg ?? res.data.resultCode} (${res.data.resultCode})` },
      { status: 400 }
    );
  }

  const balance = typeof res.data.balanceAmt === "number" ? res.data.balanceAmt : base.paidAmount - base.cancelledAmt - plan.cancelAmt;
  const { error: recErr } = await sb.rpc("nicepay_record_cancel", {
    p_secret: secret,
    p_tid: pay.tid,
    p_cancel_order_id: cancelOrderId,
    p_cancelled_tid: res.data.cancelledTid ?? null,
    p_cancel_amt: plan.cancelAmt,
    p_tax_free_amt: plan.taxFreeAmt,
    p_reason: reason,
    p_items: (plan.items ?? null) as Record<string, unknown> | null,
    p_actor: authUser.user.id,
    p_status: balance <= 0 ? "cancelled" : "partialCancelled",
    p_balance_amt: balance,
    p_raw: res.data as unknown as Record<string, unknown>,
  });
  if (recErr) console.error("[admin/payments/cancel] 취소 기록 실패:", recErr.message, orderNo);

  // 전액 취소 → 주문 취소(구독 좌석 해지 포함). 관리자 권한으로 호출.
  let orderCancelled = false;
  if (balance <= 0) {
    const { error } = await userSb.rpc("admin_cancel_order", { p_order_id: order.order_id, p_reason: `카드결제 취소: ${reason}` });
    if (error) console.error("[admin/payments/cancel] 주문 취소 실패:", error.message, orderNo);
    else orderCancelled = true;
  }

  return NextResponse.json({
    ok: true,
    cancelAmt: plan.cancelAmt,
    taxFreeAmt: plan.taxFreeAmt,
    balance,
    orderCancelled,
    recorded: !recErr,
  });
}

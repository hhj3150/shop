import { NextResponse } from "next/server";
import { approve, getPayment, netCancel, nicepayConfig } from "@/lib/nicepay/server";
import {
  parseAuthResult,
  paymentTaxFreeAmount,
  verifyAuthResult,
  verifyResponseSignature,
  type NicepayPayment,
} from "@/lib/nicepay/core";
import { anonClient, loadOrder, refundAll, settlePaid } from "@/lib/nicepay/settle";

// 나이스페이 결제창 → returnUrl (Server 승인).
//
//   순서: 인증 결과코드 → 서명 → 금액(DB) → 승인 API → 승인 응답 검증 → 주문 '입금확인' → 완료 페이지.
//   · 고객이 결제창을 닫음/인증 실패: 승인하지 않는다 → 주문은 '입금대기' 그대로, 안내 페이지.
//   · 금액·서명이 안 맞음: 승인하지 않는다(승인하지 않으면 결제가 일어나지 않는다).
//   · 승인 응답을 못 받음(타임아웃 등): 거래조회로 확인 → 그래도 불명이면 망취소.
//   · 승인 응답의 서명·금액이 이상함: 받은 돈을 바로 전액취소.
export const runtime = "nodejs";
export const maxDuration = 30;

// 완료 페이지로 옮겨 줄 표시용 값(손님 화면 문구용). 금액·주문번호는 서버 값으로 덮어쓴다.
const PASS_KEYS = ["type", "ship", "guest", "item", "credit", "day", "pos", "wait"];

function redirectTo(req: Request, orderNo: string, amount: number | null, mallReserved: string, extra: Record<string, string>) {
  const src = new URLSearchParams(mallReserved || "");
  const q = new URLSearchParams();
  if (orderNo) q.set("no", orderNo);
  if (amount != null) q.set("amount", String(amount));
  for (const k of PASS_KEYS) {
    const v = src.get(k);
    if (v) q.set(k, v.slice(0, 60));
  }
  q.set("pay", "card");
  for (const [k, v] of Object.entries(extra)) q.set(k, v);
  const url = new URL(`/orders/complete?${q.toString()}`, req.url);
  return NextResponse.redirect(url, 303);
}

export async function POST(req: Request) {
  const form = await req.formData().catch(() => null);
  const r = parseAuthResult(form ?? new FormData());
  const fail = (reason: string, amount: number | null = null) =>
    redirectTo(req, r.orderId, amount, r.mallReserved, { payfail: reason });

  const cfg = nicepayConfig();
  const secret = process.env.CONFIRM_PAYMENT_SECRET;
  const sb = anonClient();
  if (!cfg || !secret || !sb) return fail("not_configured");

  // 1) 결제창 단계 실패(고객이 닫음 포함) — 승인하지 않는다.
  if (r.authResultCode !== "0000") {
    console.log("[nicepay/return] 인증 미완료:", r.orderId, r.authResultCode, r.authResultMsg);
    return fail("closed");
  }

  // 2) 주문(서버 권위)
  const order = r.orderId ? await loadOrder(sb, secret, r.orderId) : null;
  if (!order) return fail("order_not_found");

  // 이미 처리된 주문(새로고침·뒤로가기 재전송, 또는 웹훅이 먼저 처리): 같은 tid 로 결제됐으면 성공 화면.
  if (order.status !== "입금대기") {
    const { data: pay } = await sb.rpc("nicepay_payment_for_order", { p_secret: secret, p_order_no: order.order_no });
    const paid = pay as { tid?: string; status?: string } | null;
    if (paid?.tid && paid.tid === r.tid && paid.status !== "cancelled") {
      return redirectTo(req, order.order_no, order.total_amount, r.mallReserved, { paid: "1" });
    }
    console.warn("[nicepay/return] 결제 대상 아님:", order.order_no, order.status);
    return fail("not_payable", order.total_amount);
  }

  // 3) 서명·금액 검증 — 통과 못 하면 승인하지 않는다(=결제 안 됨).
  const check = verifyAuthResult(r, cfg.clientId, cfg.secretKey, order.total_amount);
  if (!check.ok) {
    console.warn("[nicepay/return] 검증 실패:", order.order_no, check.reason, "pg amount:", r.amount, "db:", order.total_amount);
    return fail(check.reason, order.total_amount);
  }

  const taxFreeAmt = paymentTaxFreeAmount(order);

  // 같은 주문에 이미 승인된 다른 결제가 있으면(주문 확인이 늦는 사이 다시 결제한 경우) 승인하지 않는다 — 이중 청구 방지.
  const { data: prior } = await sb.rpc("nicepay_payment_for_order", { p_secret: secret, p_order_no: order.order_no });
  const pr = prior as { tid?: string; status?: string } | null;
  if (pr?.tid && pr.status !== "cancelled" && pr.tid !== r.tid) {
    console.warn("[nicepay/return] 이미 결제된 주문:", order.order_no);
    return fail("not_payable", order.total_amount);
  }

  // 4) 승인
  let approved: NicepayPayment | null = null;
  const res = await approve(cfg, r.tid, order.total_amount);
  if (res.kind === "ok") {
    approved = res.data;
  } else {
    // 결과 불명 — 먼저 조회해 보고, 그래도 모르면 망취소(유효 1시간).
    console.error("[nicepay/return] 승인 응답 없음:", order.order_no, res.kind);
    const look = await getPayment(cfg, r.tid);
    if (look.kind === "ok" && look.data.resultCode === "0000" && look.data.status === "paid") {
      approved = look.data;
    } else {
      const nc = await netCancel(cfg, order.order_no);
      console.error("[nicepay/return] 망취소:", order.order_no, nc.kind === "ok" ? nc.data.resultCode : nc.kind);
      return fail("unknown", order.total_amount);
    }
  }

  if (approved.resultCode !== "0000" || approved.status !== "paid") {
    console.warn("[nicepay/return] 승인 실패:", order.order_no, approved.resultCode, approved.resultMsg);
    return fail("approve_failed", order.total_amount);
  }

  // 5) 승인 응답 검증 — 서명·금액·주문번호. 이상하면 받은 돈을 바로 돌려준다.
  if (
    !verifyResponseSignature(approved, cfg.secretKey) ||
    approved.amount !== order.total_amount ||
    approved.orderId !== order.order_no
  ) {
    console.error("[nicepay/return] 승인 응답 검증 실패 → 자동취소:", order.order_no);
    await refundAll(sb, secret, cfg, order.order_no, approved, taxFreeAmt, "승인 응답 검증 실패 자동취소");
    return fail("verify_failed", order.total_amount);
  }

  // 6) 우리 쪽 반영
  const settled = await settlePaid(sb, secret, cfg, order, approved, taxFreeAmt);
  if (!settled.ok) {
    // transient: 결제는 됐고 반영만 늦음(웹훅이 다시 처리). deterministic: 이미 자동취소됨.
    return fail(settled.transient ? "pending_confirm" : "confirm_failed", order.total_amount);
  }
  if (settled.orphan) return fail(settled.refunded ? "order_cancelled_refunded" : "order_cancelled", order.total_amount);

  return redirectTo(req, order.order_no, order.total_amount, r.mallReserved, { paid: "1" });
}

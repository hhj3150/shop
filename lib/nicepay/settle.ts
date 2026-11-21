// 승인된 결제를 우리 쪽에 반영한다 — returnUrl 과 웹훅이 같은 함수를 쓴다(둘 중 먼저 온 쪽이 처리, 나머지는 멱등).
//
//   1) payments 원장 기록(tid 기준 upsert)
//   2) confirm_payment → 주문 '입금확인'(무통장과 같은 상태. 구독 좌석 활성화·연장 처리도 이 함수가 한다)
//   3) 이미 취소된 주문에 결제가 들어왔으면(고아) 자동 전액취소, 실패하면 관리자 알림
//   4) 이번에 처음 확인됐으면 손님에게 결제완료 문자(샌드박스는 보내지 않는다)
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sendInfo, isSolapiConfigured } from "../solapi";
import { sendOrphanDepositAlert, type OrphanReason } from "../orphan-alert";
import { logSms } from "../sms-log";
import { cancel, type NicepayConfig } from "./server";
import { payMethodLabel, pgTime, type NicepayPayment, type OrderLine } from "./core";

const SHOP = "송영신목장";

export type OrderPayload = {
  found: boolean;
  order_id: string;
  order_no: string;
  total_amount: number;
  status: string;
  order_type: string;
  is_gift: boolean | null;
  is_guest: boolean;
  ship_name: string | null;
  ship_phone: string | null;
  block_weeks: number | null;
  shipping_fee: number | null;
  items: OrderLine[];
};

export function anonClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return null;
  return createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
}

// 주문 정보(서버 권위). 무통장 등록에서 쓰는 payaction_order_payload 를 그대로 재사용한다.
export async function loadOrder(sb: SupabaseClient, secret: string, orderNo: string): Promise<OrderPayload | null> {
  const { data, error } = await sb.rpc("payaction_order_payload", { p_order_no: orderNo, p_secret: secret });
  if (error || !data || !(data as { found?: boolean }).found) return null;
  return data as OrderPayload;
}

export async function recordPayment(
  sb: SupabaseClient,
  secret: string,
  cfg: NicepayConfig,
  orderNo: string,
  p: NicepayPayment,
  taxFreeAmt: number
): Promise<void> {
  const { error } = await sb.rpc("nicepay_upsert_payment", {
    p_secret: secret,
    p_order_no: orderNo,
    p_tid: p.tid,
    p_status: p.status ?? "paid",
    p_amount: p.amount ?? 0,
    p_tax_free_amt: taxFreeAmt,
    p_balance_amt: p.balanceAmt ?? null,
    p_pay_method: p.payMethod ?? null,
    p_approve_no: p.approveNo ?? null,
    p_card_name: p.card?.cardName ?? null,
    p_paid_at: pgTime(p.paidAt),
    p_cancelled_at: pgTime(p.cancelledAt),
    p_sandbox: cfg.sandbox,
    p_raw: p as unknown as Record<string, unknown>,
  });
  if (error) throw new Error(`record_payment_failed: ${error.message}`);
}

export type SettleResult =
  | { ok: true; changed: boolean; orphan: boolean; refunded?: boolean }
  | { ok: false; transient: boolean; reason: string };

// p 는 서명·금액 검증을 마친 '승인 완료(status=paid)' 응답이어야 한다.
export async function settlePaid(
  sb: SupabaseClient,
  secret: string,
  cfg: NicepayConfig,
  order: OrderPayload,
  p: NicepayPayment,
  taxFreeAmt: number
): Promise<SettleResult> {
  try {
    await recordPayment(sb, secret, cfg, order.order_no, p, taxFreeAmt);
  } catch (e) {
    console.error("[nicepay] 결제 기록 실패:", e instanceof Error ? e.message : e);
    return { ok: false, transient: true, reason: "record_failed" };
  }

  const label = payMethodLabel(p.payMethod);
  const { data, error } = await sb.rpc("confirm_payment", {
    p_order_no: order.order_no,
    p_secret: secret,
    p_paid_amount: p.amount,
    p_pay_method: label,
    p_pg_tx_id: p.tid,
  });

  if (error || !data) {
    const msg = error?.message ?? "confirm_failed";
    const deterministic = msg === "order_not_found" || msg.startsWith("amount_mismatch") || msg === "forbidden";
    console.error("[nicepay] confirm_payment 실패:", msg, "order:", order.order_no);
    if (deterministic && msg !== "forbidden") {
      // 결제는 됐는데 주문에 붙일 수 없다 → 손님 돈을 잡아 두지 않는다(자동 전액취소).
      await refundAll(sb, secret, cfg, order.order_no, p, taxFreeAmt, `주문 확인 실패 자동취소(${msg})`);
      return { ok: false, transient: false, reason: msg };
    }
    return { ok: false, transient: true, reason: msg };
  }

  const r = data as {
    order_id?: string;
    order_no: string;
    status: string;
    changed: boolean;
    orphan?: boolean;
    orphan_inserted?: boolean;
    orphan_reason?: OrphanReason | null;
    ship_name: string | null;
    ship_phone: string | null;
    ship_date: string | null;
  };

  if (r.orphan) {
    // 취소된 주문(또는 해지된 구독의 연장)에 결제가 들어왔다 → 카드는 바로 돌려줄 수 있다.
    const refunded = await refundAll(sb, secret, cfg, order.order_no, p, taxFreeAmt, "취소된 주문 결제 자동취소");
    if (!refunded && r.orphan_inserted) {
      await sendOrphanDepositAlert({
        orderNo: r.order_no,
        shipName: r.ship_name,
        shipPhone: r.ship_phone,
        paidAmount: p.amount ?? 0,
        payMethod: label,
        reason: r.orphan_reason ?? null,
      });
    }
    return { ok: true, changed: false, orphan: true, refunded };
  }

  if (r.changed && r.status === "입금확인" && r.ship_phone && !cfg.sandbox && isSolapiConfigured()) {
    const name = r.ship_name || "고객";
    const [, mo, da] = r.ship_date?.split("-") ?? [];
    const dispatchLine =
      mo && da ? `${Number(mo)}월 ${Number(da)}일에 발송해 드립니다.` : `신선하게 준비하여 순차 발송해 드리겠습니다.`;
    const text =
      `[${SHOP}] ${name}님, ${label} 결제가 완료되었습니다.\n` +
      `주문번호 ${r.order_no}\n결제금액 ${(p.amount ?? 0).toLocaleString("ko-KR")}원\n` +
      dispatchLine;
    const sent = await sendInfo(r.ship_phone, { text, subject: `[${SHOP}] 결제 완료` });
    if (!sent.ok) console.warn("[nicepay] 결제완료 문자 실패:", sent.reason);
    await logSms({
      kind: "payment_confirmed",
      toPhone: r.ship_phone,
      body: text,
      templateKey: null,
      channel: "info",
      ok: sent.ok,
      failReason: sent.ok ? null : (sent.reason ?? null),
      orderId: r.order_id ?? null,
    });
  }

  return { ok: true, changed: r.changed, orphan: false };
}

// 전액 자동취소(고아·확인 실패·응답 위변조). 성공하면 원장에도 남긴다.
export async function refundAll(
  sb: SupabaseClient,
  secret: string,
  cfg: NicepayConfig,
  orderNo: string,
  p: NicepayPayment,
  taxFreeAmt: number,
  reason: string
): Promise<boolean> {
  if (!p.tid) return false;
  const res = await cancel(cfg, p.tid, { orderId: orderNo, reason });
  if (res.kind !== "ok" || res.data.resultCode !== "0000") {
    console.error("[nicepay] 자동취소 실패:", orderNo, res.kind === "ok" ? res.data.resultCode : res.kind);
    return false;
  }
  await sb
    .rpc("nicepay_record_cancel", {
      p_secret: secret,
      p_tid: p.tid,
      p_cancel_order_id: orderNo,
      p_cancelled_tid: res.data.cancelledTid ?? null,
      p_cancel_amt: p.amount ?? 0,
      p_tax_free_amt: taxFreeAmt,
      p_reason: reason,
      p_items: null,
      p_actor: null,
      p_status: res.data.status ?? "cancelled",
      p_balance_amt: res.data.balanceAmt ?? 0,
      p_raw: res.data as unknown as Record<string, unknown>,
    })
    .then(({ error }) => error && console.error("[nicepay] 자동취소 기록 실패:", error.message));
  return true;
}

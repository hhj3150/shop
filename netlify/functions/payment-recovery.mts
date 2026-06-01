import type { Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { isSolapiConfigured, sendInfo } from "../../lib/solapi";
import {
  decideAction,
  buildRecoveryMessage,
  type RecoveryTarget,
} from "../../lib/payment-recovery";

type TargetRow = {
  order_id: string;
  created_at: string;
  ship_name: string;
  ship_phone: string;
  order_no: string;
  total_amount: number;
  has_subscription: boolean;
  sent_stages: string[] | null;
};

export default async function handler(): Promise<Response> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secret = process.env.PAYMENT_RECOVERY_SECRET;
  if (!url || !anon || !secret || !isSolapiConfigured()) {
    console.warn("[payment-recovery] 미설정 — 건너뜀");
    return new Response("skip: not configured");
  }

  const sb = createClient(url, anon);
  const { data, error } = await sb.rpc("payment_recovery_targets", {
    p_secret: secret,
  });
  if (error) {
    console.error("[payment-recovery] targets 조회 실패:", error.message);
    return new Response("error", { status: 500 });
  }

  const now = new Date();
  let sent = 0;
  let expired = 0;

  for (const row of (data ?? []) as TargetRow[]) {
    const t: RecoveryTarget = {
      orderId: row.order_id,
      createdAt: row.created_at,
      shipName: row.ship_name,
      shipPhone: row.ship_phone,
      orderNo: row.order_no,
      totalAmount: row.total_amount,
      hasSubscription: row.has_subscription,
      sentStages: row.sent_stages ?? [],
    };
    const action = decideAction(t, now);
    if (action === "none") continue;

    if (action === "EXPIRE") {
      const { error: exErr } = await sb.rpc("apply_recovery_action", {
        p_secret: secret,
        p_order_id: t.orderId,
        p_action: "expire",
      });
      if (exErr) console.error(`[payment-recovery] expire 실패 ${t.orderNo}:`, exErr.message);
      else expired += 1;
      continue;
    }

    // D1/D2: 발송 전 원장 기록(확정 정책 — 누락 < 중복).
    const { error: recErr } = await sb.rpc("apply_recovery_action", {
      p_secret: secret,
      p_order_id: t.orderId,
      p_action: action,
    });
    if (recErr) {
      console.error(`[payment-recovery] 원장 기록 실패 ${t.orderNo}:`, recErr.message);
      continue;
    }
    if (!t.shipPhone) {
      console.warn(`[payment-recovery] 전화번호 없음 ${t.orderNo}`);
      continue;
    }
    const m = buildRecoveryMessage(t, action);
    await sendInfo(t.shipPhone, {
      text: m.text,
      subject: m.subject,
      alimtalk: { templateKey: m.templateKey, variables: m.variables },
    });
    sent += 1;
  }

  console.log(`[payment-recovery] sent=${sent} expired=${expired}`);
  return new Response(`ok sent=${sent} expired=${expired}`);
}

// 매일 00:00 UTC = 09:00 KST.
export const config: Config = { schedule: "0 0 * * *" };

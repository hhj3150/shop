import type { Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { isSolapiConfigured, sendInfo } from "../../lib/solapi";
import {
  decideAction,
  buildUnpaidDigest,
  elapsedHours,
  type RecoveryTarget,
  type UnpaidItem,
} from "../../lib/payment-recovery";
import { logSms } from "../../lib/sms-log";

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
  const rows = (data ?? []) as TargetRow[];

  // ★ 손님에게는 아무 문자도 보내지 않는다(독촉 폐지). 이번에 새로 단계에 걸린 건만 모아
  //   관리자에게 '확인 필요' 목록 한 통으로 보낸다. 통장 확인·처리는 사람이 한다.
  const items: UnpaidItem[] = [];
  for (const row of rows) {
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

    // 원장 기록이 곧 중복 방지다 — 같은 주문이 같은 단계로 두 번 목록에 오르지 않는다.
    const { data: inserted, error: recErr } = await sb.rpc("apply_recovery_action", {
      p_secret: secret,
      p_order_id: t.orderId,
      p_action: action,
    });
    if (recErr) {
      console.error(`[payment-recovery] 원장 기록 실패 ${t.orderNo}:`, recErr.message);
      continue;
    }
    // EXPIRE_NOTIFY 는 신규 기록일 때만(재실행·경합 시 중복 방지). 나머지 단계는
    //   sentStages 로 이미 걸러졌다.
    if (action === "EXPIRE_NOTIFY" && inserted !== true) continue;

    items.push({ target: t, hoursElapsed: elapsedHours(t.createdAt, now) });
  }

  const digest = buildUnpaidDigest(items, rows.length);
  if (!digest) {
    console.log("[payment-recovery] 새로 알릴 미입금 건 없음");
    return new Response("ok notified=0");
  }

  const adminPhone = process.env.ADMIN_ALERT_PHONE;
  if (!adminPhone) {
    console.warn("[payment-recovery] ADMIN_ALERT_PHONE 미설정 → 알림 생략", items.length, "건");
    return new Response("skip: no admin phone");
  }

  const result = await sendInfo(adminPhone, { text: digest.text, subject: digest.subject });
  await logSms({
    kind: "unpaid_digest",
    toPhone: adminPhone,
    body: digest.text,
    channel: "admin_alert",
    ok: result.ok,
    failReason: result.ok ? null : (result.reason ?? null),
    meta: {
      count: items.length,
      totalPending: rows.length,
      orderNos: items.map((i) => i.target.orderNo),
    },
  });
  if (!result.ok) console.warn("[payment-recovery] 관리자 알림 실패:", result);

  console.log(`[payment-recovery] 관리자 알림 ${items.length}건 (입금대기 전체 ${rows.length}건)`);
  return new Response(`ok notified=${items.length}`);
}

// 매일 00:00 UTC = 09:00 KST.
export const config: Config = { schedule: "0 0 * * *" };

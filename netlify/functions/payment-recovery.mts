import type { Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { isSolapiConfigured, sendInfo } from "../../lib/solapi";
import {
  decideAction,
  buildRecoveryMessage,
  buildOverdueNoticeMessage,
  type RecoveryTarget,
} from "../../lib/payment-recovery";

// 미입금 주문 처리 크론.
//   D+1/D+2: 구매자에게 입금 리마인드.
//   D+3~   : 관리자에게 '확인 필요' 문자만 발송(해결될 때까지 매일 한 통).
// ⚠ 자동취소 없음: 취소와 고객 취소 안내 문자는 관리자가 관리자 페이지에서
//   직접 '취소' 처리할 때만 나간다(입금자명 상이 등 미매칭 입금 오취소 방지).

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
  const overdue: RecoveryTarget[] = [];

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

    if (action === "OVERDUE_NOTICE") {
      overdue.push(t);
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
    const result = await sendInfo(t.shipPhone, {
      text: m.text,
      subject: m.subject,
      alimtalk: { templateKey: m.templateKey, variables: m.variables },
    });
    if (!result.ok) {
      console.warn(`[payment-recovery] 발송 실패 ${t.orderNo}:`, result);
    }
    sent += 1;
  }

  // D+3 경과분: 관리자에게 한 통으로 묶어 '확인 필요' 보고. 원장 기록 없이
  //   '입금대기'로 남아 있는 한 매일 다시 올린다 — 잊혀서 방치되는 것을 막고,
  //   관리자가 입금확인/취소 처리를 마치면 대상에서 빠져 알림도 멈춘다.
  if (overdue.length > 0) {
    const adminPhone = process.env.ADMIN_ALERT_PHONE;
    if (!adminPhone) {
      console.warn(
        "[payment-recovery] ADMIN_ALERT_PHONE 미설정 — 미입금 확인요청 발송 불가:",
        overdue.map((t) => t.orderNo).join(", "),
      );
    } else {
      const m = buildOverdueNoticeMessage(overdue);
      const result = await sendInfo(adminPhone, { text: m.text, subject: m.subject });
      if (!result.ok) {
        console.warn("[payment-recovery] 미입금 확인요청 발송 실패:", result);
      }
    }
  }

  console.log(`[payment-recovery] sent=${sent} overdue=${overdue.length}`);
  return new Response(`ok sent=${sent} overdue=${overdue.length}`);
}

// 매일 00:00 UTC = 09:00 KST.
export const config: Config = { schedule: "0 0 * * *" };

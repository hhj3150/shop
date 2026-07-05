import type { Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { isSolapiConfigured, sendInfo } from "../../lib/solapi";
import {
  decideAction,
  buildRecoveryMessage,
  buildExpireAdminAlertText,
  kstDaysElapsed,
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
  let notified = 0;

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

    // ★ D+3: 자동취소·고객 취소문자 폐지(2026-07-05 실사고 — 입금자명 불일치로 실제
    //   입금한 고객이 자동취소 문자를 받음). 관리자에게 1회 알림만 보내고, 취소 여부는
    //   관리자가 통장 사실확인 후 관리자 화면에서 직접 결정한다.
    if (action === "EXPIRE_NOTIFY") {
      const { data: inserted, error: exErr } = await sb.rpc("apply_recovery_action", {
        p_secret: secret,
        p_order_id: t.orderId,
        p_action: "EXPIRE_NOTIFY",
      });
      if (exErr) {
        console.error(`[payment-recovery] EXPIRE_NOTIFY 기록 실패 ${t.orderNo}:`, exErr.message);
        continue;
      }
      // 신규 기록일 때만 관리자 알림(재실행·경합 시 중복 알림 방지).
      if (inserted === true) {
        const adminPhone = process.env.ADMIN_ALERT_PHONE;
        if (!adminPhone) {
          console.warn(`[payment-recovery] ADMIN_ALERT_PHONE 미설정 → 미입금 D+3 알림 생략 ${t.orderNo}`);
          continue;
        }
        const text = buildExpireAdminAlertText(t, kstDaysElapsed(t.createdAt, now));
        const result = await sendInfo(adminPhone, {
          text,
          subject: "[송영신목장] 미입금 주문 확인 필요",
        });
        if (!result.ok) console.warn(`[payment-recovery] 관리자 알림 실패 ${t.orderNo}:`, result);
        else notified += 1;
      }
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
      // D2 는 알림톡 템플릿 없이 LMS 로만 — 구 템플릿에 '자동취소' 문구가 있어 쓰지 않는다.
      alimtalk:
        m.templateKey && m.variables
          ? { templateKey: m.templateKey, variables: m.variables }
          : undefined,
    });
    if (!result.ok) {
      console.warn(`[payment-recovery] 발송 실패 ${t.orderNo}:`, result);
    }
    sent += 1;
  }

  console.log(`[payment-recovery] sent=${sent} adminNotified=${notified}`);
  return new Response(`ok sent=${sent} adminNotified=${notified}`);
}

// 매일 00:00 UTC = 09:00 KST.
export const config: Config = { schedule: "0 0 * * *" };

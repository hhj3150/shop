// 문자 발송 이력 적재(서버 전용). 클레임 복기를 위해 모든 발송을 sms_log 에 남긴다.
//
// best-effort: 로그 실패는 절대 발송/응답을 막지 않는다(조용히 무시).
// 시크릿 게이트 RPC(append_sms_log)를 호출하며, 시크릿은 기존 CONFIRM_PAYMENT_SECRET 재사용.

import { createClient } from "@supabase/supabase-js";

export type SmsLogEntry = {
  kind: string; // payment_confirmed/shipped/welcome/broadcast/orphan_alert 등
  toPhone?: string | null;
  body?: string | null;
  channel?: string | null; // 'info' | 'bulk' | 'admin_alert'
  ok?: boolean | null;
  userId?: string | null;
  orderId?: string | null;
  templateKey?: string | null;
  failReason?: string | null;
  meta?: Record<string, unknown> | null;
};

export async function logSms(e: SmsLogEntry): Promise<void> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secret = process.env.CONFIRM_PAYMENT_SECRET;
  // 미설정이면 조용히 생략(발송은 정상 동작).
  if (!url || !anon || !secret) return;
  try {
    const sb = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    await sb.rpc("append_sms_log", {
      p_secret: secret,
      p_kind: e.kind,
      p_to_phone: e.toPhone ?? null,
      p_body: e.body ?? null,
      p_channel: e.channel ?? null,
      p_ok: e.ok ?? null,
      p_user_id: e.userId ?? null,
      p_order_id: e.orderId ?? null,
      p_template_key: e.templateKey ?? null,
      p_fail_reason: e.failReason ?? null,
      p_meta: e.meta ?? null,
    });
  } catch {
    // 로그 실패는 무시 — 발송 흐름 보호.
  }
}

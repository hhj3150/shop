// 번호당 일일 문자 상한 — 손님이 촉발하는 알림의 비용 남용을 막는다.
//
//   [왜] /api/notify 는 로그인한 회원이면 누구나 부를 수 있고, 수신번호는 그 사람이 만든
//     주문의 ship_phone 이다 — 사실상 임의의 번호를 지정할 수 있다. 종류별 1회 제한
//     (sms_already_sent)은 '주문 단위'라, 주문을 계속 만들면 그만큼 문자가 나간다.
//     Solapi 요금은 목장이 낸다.
//
//   [상한값의 근거] 운영 이력 전수(885 phone-day) 기준 한 번호가 하루에 받은 최대치는
//     4통, p99 는 3통이다. 기본 10통은 정상 운영의 2.5배라 실제 손님을 막지 않으면서
//     자동화된 남용은 끊는다. SMS_DAILY_CAP_PER_PHONE 로 배포 없이 조절한다.
//
//   [실패 시] 판정이 불가능하면 '막지 않는다'. 상한 조회가 흔들려서 정상 안내 문자가
//     안 나가는 쪽이 더 나쁘다 — 이 코드베이스의 다른 게이트(sms_already_sent)와 같은 선택이다.
//     대신 콘솔에 남겨 운영자가 알아챌 수 있게 한다.

import { createClient } from "@supabase/supabase-js";

export const DEFAULT_SMS_DAILY_CAP = 10;

/** 환경변수에서 상한을 읽는다. 잘못된 값이면 기본값. */
export function dailyCap(): number {
  const raw = process.env.SMS_DAILY_CAP_PER_PHONE;
  const n = raw == null ? NaN : Number(raw);
  return Number.isInteger(n) && n > 0 ? n : DEFAULT_SMS_DAILY_CAP;
}

/**
 * 이 번호가 오늘 상한을 넘었는가. 넘었으면 true(보내지 않는다).
 * 관리자 알림(channel='admin_alert')은 RPC 가 세지 않으므로 상한에 걸리지 않는다.
 */
export async function overDailyCap(phone: string): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secret = process.env.CONFIRM_PAYMENT_SECRET;
  if (!url || !anon || !secret) return false; // 판정 불가 → 막지 않는다
  try {
    const sb = createClient(url, anon, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await sb.rpc("sms_daily_count", {
      p_secret: secret,
      p_to_phone: phone,
    });
    if (error) {
      console.warn("[sms-quota] 상한 조회 실패 → 발송 허용:", error.message);
      return false;
    }
    const sent = typeof data === "number" ? data : 0;
    const cap = dailyCap();
    if (sent >= cap) {
      console.warn(`[sms-quota] 일일 상한 초과 → 발송 생략. 오늘 ${sent}통 / 상한 ${cap}통`);
      return true;
    }
    return false;
  } catch (err) {
    console.warn(
      "[sms-quota] 상한 조회 예외 → 발송 허용:",
      err instanceof Error ? err.message : "unknown"
    );
    return false;
  }
}

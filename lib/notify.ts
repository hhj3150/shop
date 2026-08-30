"use client";

import { getSupabase } from "./supabase";

// 정보성 문자 발송 요청(서버 Route Handler 호출). best-effort —
// 실패해도 주문/해지 흐름을 막지 않도록 예외를 삼킨다.
type NotifyPayload =
  | { kind: "welcome" }
  | { kind: "order_received"; orderId: string }
  | { kind: "payment_confirmed"; orderId: string }
  // shipDate = 처리한 회차의 발송일(배송판). 서버가 '지금 처리한 회차'를 정확히 집어
  //   지난 배송 차단·회차 표기를 판정한다. resend = 관리자가 이력 화면에서 직접 누른 재발송.
  | { kind: "shipped"; orderId: string; shipDate?: string; resend?: true }
  | { kind: "delivered"; orderId: string; shipDate?: string; resend?: true }
  | { kind: "order_cancelled"; orderId: string }
  | { kind: "gift_subscription"; orderId: string }
  | { kind: "gift_once"; orderId: string }
  | { kind: "subscription_cancelled"; slotId: number }
  | { kind: "renewal_guide"; orderId: string }
  | { kind: "renewal_confirmed"; orderId: string };

export async function notify(payload: NotifyPayload): Promise<void> {
  try {
    const { data } = await getSupabase().auth.getSession();
    const token = data.session?.access_token;
    if (!token) return;
    await fetch("/api/notify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
    });
  } catch {
    // 문자 발송 실패는 사용자 흐름에 영향을 주지 않는다.
  }
}

// 비회원(게스트) 주문의 주문접수·입금안내 문자. 세션 토큰이 없으므로 전용 라우트를 쓴다.
//   수신번호·문구·중복 방지는 모두 서버가 DB 권위값으로 판정한다(app/api/notify/guest).
//   best-effort — 실패해도 주문 흐름을 막지 않는다.
export async function notifyGuestOrder(orderNo: string): Promise<void> {
  try {
    await fetch("/api/notify/guest", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderNo }),
    });
  } catch {
    // 문자 발송 실패는 사용자 흐름에 영향을 주지 않는다.
  }
}

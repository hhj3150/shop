"use client";

import { getSupabase } from "./supabase";

// 정보성 문자 발송 요청(서버 Route Handler 호출). best-effort —
// 실패해도 주문/해지 흐름을 막지 않도록 예외를 삼킨다.
type NotifyPayload =
  | { kind: "welcome" }
  | { kind: "order_received"; orderId: string }
  | { kind: "payment_confirmed"; orderId: string }
  | { kind: "shipped"; orderId: string }
  | { kind: "delivered"; orderId: string }
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
    // keepalive: 주문 완료 직후 router.push 로 페이지가 넘어가도 요청이 취소되지 않게 유지.
    //   (fire-and-forget 호출이 라우팅으로 abort 되어 접수 문자가 조용히 누락되던 레이스 —
    //    PayAction 등록에서 실제로 겪고 고친 것과 동일한 문제. lib/orders.ts 참고)
    await fetch("/api/notify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    // 문자 발송 실패는 사용자 흐름에 영향을 주지 않는다.
  }
}

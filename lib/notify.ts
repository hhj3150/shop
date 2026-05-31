"use client";

import { getSupabase } from "./supabase";

// 정보성 문자 발송 요청(서버 Route Handler 호출). best-effort —
// 실패해도 주문/해지 흐름을 막지 않도록 예외를 삼킨다.
type NotifyPayload =
  | { kind: "welcome" }
  | { kind: "order_received"; orderId: string }
  | { kind: "payment_confirmed"; orderId: string }
  | { kind: "shipped"; orderId: string }
  | { kind: "subscription_cancelled"; slotId: number };

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

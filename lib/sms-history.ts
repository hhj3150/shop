"use client";

// 주문별 문자 발송 이력 조회(관리자 전용). sms_log 는 관리자 SELECT 정책(is_admin)이 있어
//   클라이언트에서 직접 읽는다. 배송 탭의 '문자 이력·재발송' 모달이 쓴다.
import { getSupabase } from "./supabase";

export type SmsLogRow = {
  id: number;
  kind: string;
  channel: string | null;
  ok: boolean | null;
  fail_reason: string | null;
  body: string | null;
  to_phone: string | null;
  sent_at: string;
};

// 발송 종류 → 한글 라벨(이력 가독성).
const SMS_KIND_LABEL: Record<string, string> = {
  order_received: "주문접수",
  payment_confirmed: "결제확인",
  shipped: "발송안내",
  delivered: "배송완료",
  order_cancelled: "주문취소",
  welcome: "가입환영",
  gift_subscription: "선물(구독)",
  gift_once: "선물(단품)",
  subscription_cancelled: "구독해지",
  renewal_guide: "갱신안내",
  renewal_confirmed: "갱신확정",
  ship_reminder: "발송예고",
  broadcast: "단체발송",
};

export function smsKindLabel(kind: string): string {
  return SMS_KIND_LABEL[kind] ?? kind;
}

export async function loadOrderSmsLog(orderId: string): Promise<SmsLogRow[]> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from("sms_log")
    .select("id, kind, channel, ok, fail_reason, body, to_phone, sent_at")
    .eq("order_id", orderId)
    .order("sent_at", { ascending: false });
  if (error) throw error;
  return (data ?? []) as SmsLogRow[];
}

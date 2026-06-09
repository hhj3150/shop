// 고아입금(취소된 주문에 늦게 들어온 입금) 발생 시 관리자에게 즉시 SMS 알림.
//
// confirm_payment RPC 가 '취소' 주문에 입금확인을 받으면 orphan_deposits 에 적재하고
// 반환 jsonb 에 orphan:true 를 싣는다(supabase/migration-orphan-deposit.sql).
// 웹훅 라우트는 그 플래그를 받아 이 헬퍼로 관리자에게 알린다 — 돈만 받고 발송이
// 누락되는 사고를 사람이 즉시 인지하도록.
//
// 수신번호는 서버 전용 환경변수 ADMIN_ALERT_PHONE 에서 읽는다(미설정 시 알림 생략 + 경고).

import { sendInfo, type SmsResult } from "@/lib/solapi";
import { logSms } from "@/lib/sms-log";

const SHOP = "송영신목장";

export type OrphanAlertParams = {
  orderNo: string;
  shipName: string | null;
  shipPhone: string | null;
  paidAmount: number | null;
  payMethod: string | null;
};

// 관리자 알림 본문(순수함수 — 테스트 대상).
export function buildOrphanAlertText(p: OrphanAlertParams): string {
  const amount =
    typeof p.paidAmount === "number" ? `${p.paidAmount.toLocaleString("ko-KR")}원` : "금액미상";
  const name = p.shipName || "이름미상";
  const phone = p.shipPhone || "연락처미상";
  const method = p.payMethod || "수단미상";
  return (
    `[${SHOP}] ⚠️ 고아입금 발생\n` +
    `이미 취소된 주문에 입금이 확인됐습니다. 발송·환불 여부를 즉시 확인해 주세요.\n` +
    `주문번호 ${p.orderNo}\n` +
    `입금자/수령 ${name} (${phone})\n` +
    `금액 ${amount} · ${method}`
  );
}

// 관리자 SMS 발송. ADMIN_ALERT_PHONE 미설정이면 경고만 남기고 발송하지 않는다.
export async function sendOrphanDepositAlert(p: OrphanAlertParams): Promise<SmsResult> {
  const adminPhone = process.env.ADMIN_ALERT_PHONE;
  if (!adminPhone) {
    console.warn(
      "[orphan-alert] ADMIN_ALERT_PHONE 미설정 → 고아입금 알림 생략. order_no:",
      p.orderNo
    );
    return { ok: false, reason: "ADMIN_ALERT_PHONE 미설정" };
  }
  try {
    const text = buildOrphanAlertText(p);
    const r = await sendInfo(adminPhone, { text, subject: `[${SHOP}] 고아입금 발생` });
    // 클레임 복기용 적재(관리자 알림 — best-effort).
    await logSms({
      kind: "orphan_alert",
      toPhone: adminPhone,
      body: text,
      channel: "admin_alert",
      ok: r.ok,
      failReason: r.ok ? null : (r.reason ?? null),
      meta: { orderNo: p.orderNo, paidAmount: p.paidAmount, payMethod: p.payMethod },
    });
    return r;
  } catch (error) {
    const reason = error instanceof Error ? error.message : "unknown";
    console.error("[orphan-alert] 관리자 알림 발송 실패:", reason, "order_no:", p.orderNo);
    return { ok: false, reason };
  }
}

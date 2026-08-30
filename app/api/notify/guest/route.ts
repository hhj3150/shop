import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { sendInfo, isSolapiConfigured } from "@/lib/solapi";
import { logSms } from "@/lib/sms-log";
import { buildOrderReceivedMessage } from "@/lib/order-received-message";
import { DEPOSIT } from "@/lib/site";
import { formatKRW } from "@/lib/products";

// 비회원(게스트) 주문의 '주문 접수 + 입금 안내' 문자.
//
// 왜 별도 라우트인가:
//   /api/notify 는 세션 토큰으로 호출자를 검증한다. 비회원은 세션이 없어 그 경로를 못 탄다.
//   그래서 2026-07-01~08-29 비회원 주문 20건이 안내 문자를 한 통도 못 받았고, 그중 일부는
//   안내 없이 '입금 독촉'(D1)부터 받았다.
//
// 보안 설계(세션 없이도 남용이 불가능하도록):
//   1) 수신번호·문구를 클라이언트가 정하지 못한다 — 전부 DB 권위값(payaction_order_payload).
//   2) 주문당 1회만 — sms_already_sent(order_received) 로 서버가 강제한다.
//   3) 입금대기 상태 + 주문 직후(30분 이내) 건만 — 오래된 주문번호를 긁어 재발송할 수 없다.
//   4) 비회원 주문만 — 회원 주문은 기존 /api/notify 경로를 쓴다.
//   5) 선물 주문은 보내지 않는다 — 받는 분 번호로 결제 안내가 갈 수 있다(주문자 연락처 미보유).
//   따라서 최악의 경우에도 '그 손님이 어차피 받을 문자 1통'이 전부다.

export const runtime = "nodejs";

const WINDOW_MINUTES = 30;

export async function POST(req: Request) {
  if (!isSolapiConfigured()) {
    return NextResponse.json({ ok: false, reason: "not_configured" });
  }
  const secret = process.env.CONFIRM_PAYMENT_SECRET;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!secret || !url || !anon) {
    return NextResponse.json({ ok: false, reason: "not_configured" });
  }

  let body: { orderNo?: unknown };
  try {
    body = (await req.json()) as { orderNo?: unknown };
  } catch {
    return NextResponse.json({ ok: false, reason: "bad_json" }, { status: 400 });
  }
  const orderNo = typeof body.orderNo === "string" ? body.orderNo.trim() : "";
  if (!orderNo) {
    return NextResponse.json({ ok: false, reason: "no_order_no" }, { status: 400 });
  }

  const sb = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data, error } = await sb.rpc("payaction_order_payload", {
    p_order_no: orderNo,
    p_secret: secret,
  });
  if (error) {
    console.error("[notify/guest] payload 조회 실패:", error.message);
    return NextResponse.json({ ok: false, reason: "lookup_failed" });
  }
  const o = (data ?? {}) as {
    found?: boolean;
    order_id?: string | null;
    order_no?: string;
    total_amount?: number;
    ship_name?: string | null;
    ship_phone?: string | null;
    ship_date?: string | null;
    delivery_method?: string | null;
    is_gift?: boolean;
    is_guest?: boolean;
    status?: string;
    order_date?: string;
  };

  if (!o.found) return NextResponse.json({ ok: false, reason: "order_not_found" }, { status: 404 });
  if (o.is_guest !== true) return NextResponse.json({ ok: false, reason: "not_guest" });
  if (o.is_gift === true) return NextResponse.json({ ok: false, reason: "gift_skipped" });
  if (o.status !== "입금대기") return NextResponse.json({ ok: false, reason: "not_pending" });
  if (!o.ship_phone) return NextResponse.json({ ok: false, reason: "no_phone" });

  // 주문 직후에만. order_date 는 '+09:00' 오프셋이 붙은 ISO 문자열이라 그대로 파싱된다.
  const createdMs = o.order_date ? Date.parse(o.order_date) : NaN;
  if (!Number.isFinite(createdMs) || Date.now() - createdMs > WINDOW_MINUTES * 60_000) {
    return NextResponse.json({ ok: false, reason: "too_old" });
  }

  // 주문당 1회(서버 강제).
  if (o.order_id) {
    const { data: already } = await sb.rpc("sms_already_sent", {
      p_secret: secret,
      p_kind: "order_received",
      p_order_id: o.order_id,
      p_user_id: null,
    });
    if (already === true) return NextResponse.json({ ok: true, reason: "duplicate_skipped" });
  }

  const account = `${DEPOSIT.bank} ${DEPOSIT.account} (예금주 ${DEPOSIT.holder})`;
  const m = buildOrderReceivedMessage({
    shipName: o.ship_name ?? null,
    orderNo: o.order_no ?? orderNo,
    amountLabel: formatKRW(o.total_amount ?? 0),
    account,
    shipDate: o.ship_date ?? null,
    deliveryMethod: o.delivery_method ?? null,
  });

  const r = await sendInfo(o.ship_phone, {
    text: m.text,
    subject: m.subject,
    alimtalk: { templateKey: "PAYMENT_GUIDE", variables: m.variables },
  });
  await logSms({
    kind: "order_received",
    toPhone: o.ship_phone,
    body: m.text,
    templateKey: "PAYMENT_GUIDE",
    channel: "info",
    ok: r.ok,
    failReason: r.ok ? null : (r.reason ?? null),
    orderId: o.order_id ?? null,
    meta: { guest: true },
  });
  return NextResponse.json(r);
}

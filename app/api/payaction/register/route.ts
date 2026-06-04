import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { registerOrder, isPayActionConfigured } from "@/lib/payaction";

// PayAction 주문등록 라우트. 주문 생성 직후 브라우저가 호출한다(orderNo + 주문자 연락처).
//
// 보안 설계:
//   - PAYACTION_API_KEY 가 필요한 등록은 서버에서만 수행한다(브라우저 노출 금지).
//   - 금액·입금자명은 클라이언트 값이 아니라 payaction_order_payload RPC 로 DB 권위값을 재조회한다(C1).
//   - 등록 실패는 주문을 막지 않는다(non-fatal): ok:false 를 200 으로 반환하고 호출측은 무시한다.
//
// 환경변수: PAYACTION_*(클라이언트), CONFIRM_PAYMENT_SECRET(RPC), NEXT_PUBLIC_SUPABASE_*.

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!isPayActionConfigured()) {
    return NextResponse.json({ ok: false, reason: "not_configured" });
  }
  const confirmSecret = process.env.CONFIRM_PAYMENT_SECRET;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!confirmSecret || !supabaseUrl || !supabaseAnon) {
    return NextResponse.json({ ok: false, reason: "not_configured" });
  }

  let body: {
    orderNo?: string;
    ordererPhone?: string;
    ordererName?: string;
    ordererEmail?: string;
  };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid_body" }, { status: 400 });
  }

  const orderNo = (body.orderNo ?? "").trim();
  if (!orderNo) {
    return NextResponse.json({ ok: false, reason: "missing_order_no" }, { status: 400 });
  }
  // 진입 로그 — 호출이 서버 라우트에 도달했는지 확인(도달 안 함 vs 도달 후 성공/실패 구분).
  console.log("[payaction/register] hit order_no:", orderNo);

  // DB 권위 필드 조회(금액·입금자명·주문일).
  const supabase = createClient(supabaseUrl, supabaseAnon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await supabase.rpc("payaction_order_payload", {
    p_order_no: orderNo,
    p_secret: confirmSecret,
  });
  if (error) {
    console.error("[payaction/register] payload 조회 실패:", error.message);
    return NextResponse.json({ ok: false, reason: "lookup_failed" });
  }

  const o = (data ?? {}) as {
    found?: boolean;
    total_amount?: number;
    depositor_name?: string | null;
    ship_name?: string | null;
    ship_phone?: string | null;
    is_gift?: boolean;
    gifter_name?: string | null;
    status?: string;
    order_date?: string;
  };
  if (!o.found) {
    return NextResponse.json({ ok: false, reason: "order_not_found" });
  }
  if (o.status !== "입금대기") {
    // 이미 확인/취소된 주문은 등록하지 않는다.
    return NextResponse.json({ ok: false, reason: "not_pending" });
  }

  const billingName = (o.depositor_name ?? "").trim();
  if (!billingName) {
    // 입금자명이 비면 자동매칭이 불가하므로 등록을 건너뛴다(관리자 수동 처리).
    return NextResponse.json({ ok: false, reason: "missing_depositor_name" });
  }

  const ordererName = o.is_gift
    ? (o.gifter_name ?? billingName)
    : ((o.ship_name ?? "").trim() || billingName);
  // 입금확인 문자 수신처: 선물이면 보내는 분(클라이언트 제공) 번호, 일반은 배송 연락처.
  const ordererPhone = (body.ordererPhone ?? "").trim() || (o.ship_phone ?? "").trim();

  const result = await registerOrder({
    orderNumber: orderNo,
    orderAmount: o.total_amount as number,
    orderDate: o.order_date as string,
    billingName,
    ordererName,
    ordererPhone: ordererPhone || undefined,
    ordererEmail: body.ordererEmail?.trim() || undefined,
  });

  if (!result.ok) {
    console.warn("[payaction/register] 등록 실패:", result.reason, "order_no:", orderNo);
  } else {
    console.log("[payaction/register] 등록 성공 order_no:", orderNo);
  }
  return NextResponse.json(result);
}

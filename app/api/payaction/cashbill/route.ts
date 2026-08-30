import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { issueCashbill, isPayActionConfigured } from "@/lib/payaction";

// 현금영수증 재발행(주문 기반). 자동발행이 실패한 건을 관리자가 화면에서 다시 시도한다.
//
// 왜 필요한가: 자동발행이 실패하면(식별번호 오류 등) 지금은 관리자가 페이액션 대시보드에
//   들어가 손으로 발행해야 한다. 우리 화면에서 바로 재시도할 수 있으면 발행 누락이 줄고,
//   결과가 우리 DB 에 남아 '무엇이 발행됐는지' 화면만 봐도 알 수 있다.
//
// ★ 이중발행 방지 — 서버가 세 겹으로 막는다
//   1) 관리자만 호출할 수 있다(세션 토큰 + is_admin).
//   2) 이미 발행완료(cash_receipt_issued=true)인 주문은 거절한다.
//   3) 발행이 취소된 주문(cash_receipt_cancelled_at)도 거절한다 — 되살리려면 사람이 판단한다.
//   발행 결과는 record_cash_receipt_auto 로 적어, 화면이 곧바로 '자동발행 완료'로 바뀐다.

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!isPayActionConfigured()) {
    return NextResponse.json({ ok: false, reason: "not_configured" });
  }
  const secret = process.env.CONFIRM_PAYMENT_SECRET;
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!secret || !url || !anon) {
    return NextResponse.json({ ok: false, reason: "not_configured" });
  }

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) return NextResponse.json({ ok: false, reason: "no_token" }, { status: 401 });

  let body: { orderNo?: unknown };
  try {
    body = (await req.json()) as { orderNo?: unknown };
  } catch {
    return NextResponse.json({ ok: false, reason: "bad_json" }, { status: 400 });
  }
  const orderNo = typeof body.orderNo === "string" ? body.orderNo.trim() : "";
  if (!orderNo) return NextResponse.json({ ok: false, reason: "no_order_no" }, { status: 400 });

  const sb = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: me } = await sb.auth.getUser();
  if (!me?.user) return NextResponse.json({ ok: false, reason: "invalid_token" }, { status: 401 });
  const { data: prof } = await sb
    .from("profiles")
    .select("is_admin")
    .eq("id", me.user.id)
    .single();
  if (!prof?.is_admin) {
    return NextResponse.json({ ok: false, reason: "forbidden" }, { status: 403 });
  }

  const { data: order } = await sb
    .from("orders")
    .select("cash_receipt_type, cash_receipt_issued, cash_receipt_cancelled_at")
    .eq("order_no", orderNo)
    .maybeSingle();
  if (!order) return NextResponse.json({ ok: false, reason: "order_not_found" }, { status: 404 });
  if (order.cash_receipt_issued === true) {
    return NextResponse.json({ ok: false, reason: "already_issued" });
  }
  if (order.cash_receipt_cancelled_at) {
    return NextResponse.json({ ok: false, reason: "cancelled" });
  }
  if (!["소득공제", "지출증빙"].includes(String(order.cash_receipt_type ?? ""))) {
    return NextResponse.json({ ok: false, reason: "no_receipt_requested" });
  }

  const r = await issueCashbill(orderNo);
  console.log("[payaction/cashbill] 재발행", orderNo, r.ok ? `성공 id=${r.cashbillId}` : `실패 ${r.reason}`);

  // 결과를 우리 DB 에 남긴다 — 성공이면 화면이 곧바로 '자동발행 완료'로 바뀐다.
  const admin = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await admin.rpc("record_cash_receipt_auto", {
    p_secret: secret,
    p_order_no: orderNo,
    p_bill_id: r.ok ? (r.cashbillId ?? null) : null,
    p_status: r.ok ? "issued" : "issue_failed",
    p_error: r.ok ? null : r.reason,
  });
  if (error) console.error("[payaction/cashbill] 결과 기록 실패:", orderNo, error.message);

  return NextResponse.json(r);
}

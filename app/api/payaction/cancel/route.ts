import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { cancelOrder, isPayActionConfigured } from "@/lib/payaction";

// PayAction 주문취소 통지. 우리 쪽에서 주문을 취소하면 PayAction 에도 알려,
// 그 주문번호로 더는 입금을 매칭하지 않게 한다.
//
// 왜 필요한가: 취소한 주문에 뒤늦게 입금이 들어오면 '고아입금'이 된다. 지금은 그때
//   관리자에게 경고 문자만 보내고 사람이 수습한다. 애초에 매칭이 안 되게 막는 편이 낫다.
//   (PayAction 2026-08 문서 개정으로 POST /orders/{order_number}/cancel 이 정식 API 가 됐다.
//    구 /order-exclude 는 DEPRECATED.)
//
// 보안 설계:
//   - PAYACTION_API_KEY 가 필요한 호출은 서버에서만 한다(브라우저 노출 금지).
//   - 호출자가 관리자이거나 그 주문의 주인일 때만 통과한다(세션 토큰 검증).
//   - 이미 '취소' 상태인 주문만 통지한다 — 살아 있는 주문을 매칭에서 빼지 못하게.
//   - 실패는 주문 흐름을 막지 않는다(non-fatal): ok:false 를 200 으로 돌려준다.

export const runtime = "nodejs";

export async function POST(req: Request) {
  if (!isPayActionConfigured()) {
    return NextResponse.json({ ok: false, reason: "not_configured" });
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return NextResponse.json({ ok: false, reason: "not_configured" });

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

  // 세션 토큰으로 조회 → RLS 가 '관리자 또는 주문 주인'만 보게 한다.
  const sb = createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: order } = await sb
    .from("orders")
    .select("status")
    .eq("order_no", orderNo)
    .maybeSingle();
  if (!order) return NextResponse.json({ ok: false, reason: "order_not_found" }, { status: 404 });
  if (order.status !== "취소") {
    return NextResponse.json({ ok: false, reason: "not_cancelled" });
  }

  const r = await cancelOrder(orderNo);
  if (!r.ok) console.warn("[payaction/cancel] 통지 실패:", orderNo, r.reason);
  else console.log("[payaction/cancel] 통지 완료:", orderNo);
  return NextResponse.json(r);
}

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// 비회원 주문조회 — 브라우저가 RPC 를 직접 부르지 않고 이 라우트를 지나간다.
//
// 왜 라우트로 옮겼나:
//   lookup_order_by_no_phone 이 anon 에 직접 열려 있어 호출 횟수를 셀 자리가 없었다.
//   주문번호의 무작위 부분이 네 자리 숫자였던 시절(기존 주문은 아직 그렇다) 날짜를 알면
//   후보가 9,000개뿐이라, 전화번호 하나를 아는 사람이 전부 훑어볼 수 있었다.
//   이제 조회는 이 라우트만 지나가고, IP 단위로 횟수를 제한한 뒤 시크릿 게이트 RPC 를 부른다.
//
// 설계:
//   - 제한 저장소는 이미 있는 assistant_rate_check(assistant_rate_limit 테이블)를 재사용한다.
//     서버리스라 프로세스 메모리 카운터는 인스턴스마다 따로 세어 의미가 없다.
//   - 응답은 RPC 결과 그대로다(이름 마스킹·최소 필드는 RPC 가 이미 한다).
//   - 찾지 못한 경우와 잘못 입력한 경우를 같은 모양으로 돌려준다 — 응답 차이로
//     '그 주문번호는 있다'를 알려 주지 않기 위해서다.

export const runtime = "nodejs";

// 한 IP 가 10분에 20회. 손님은 보통 한두 번 조회한다(오타로 서너 번).
//   9,000개 후보를 훑으려면 이 제한으로 약 3일이 걸린다 — 무차별 대입이 무의미해진다.
const RATE_LIMIT = 20;
const RATE_WINDOW_SECONDS = 600;

/** Netlify/프록시 뒤에서 호출자 IP. 없으면 'unknown' 으로 한 바구니에 담는다. */
function clientIp(req: Request): string {
  const nf = req.headers.get("x-nf-client-connection-ip");
  if (nf) return nf.trim();
  const fwd = req.headers.get("x-forwarded-for");
  if (fwd) return (fwd.split(",")[0] ?? "").trim() || "unknown";
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}

export async function POST(req: Request) {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secret = process.env.CONFIRM_PAYMENT_SECRET;
  if (!url || !anon || !secret) {
    return NextResponse.json({ ok: false, reason: "not_configured" }, { status: 503 });
  }

  let body: { orderNo?: unknown; phone?: unknown };
  try {
    body = (await req.json()) as { orderNo?: unknown; phone?: unknown };
  } catch {
    return NextResponse.json({ ok: false, reason: "bad_json" }, { status: 400 });
  }

  const orderNo = typeof body.orderNo === "string" ? body.orderNo.trim() : "";
  const phone =
    typeof body.phone === "string" ? body.phone.replace(/[^0-9]/g, "") : "";

  // 입력 미달은 RPC 를 부르지도 않는다(제한 횟수를 낭비하지 않고, 무차별 대입도 억제).
  if (orderNo.length < 8 || phone.length < 10) {
    return NextResponse.json({ ok: true, result: null });
  }

  const sb = createClient(url, anon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  // IP 단위 호출 제한. 판정 자체가 실패하면 조회를 막지 않는다 —
  //   제한 장치가 흔들려서 정상 손님이 주문을 못 보는 쪽이 더 나쁘다.
  try {
    const { data: allowed, error } = await sb.rpc("assistant_rate_check", {
      p_ip: `order-lookup:${clientIp(req)}`,
      p_limit: RATE_LIMIT,
      p_window_seconds: RATE_WINDOW_SECONDS,
    });
    if (!error && allowed === false) {
      return NextResponse.json(
        { ok: false, reason: "rate_limited" },
        { status: 429, headers: { "Retry-After": String(RATE_WINDOW_SECONDS) } }
      );
    }
  } catch {
    // 제한 판정 실패 → 통과시킨다.
  }

  const { data, error } = await sb.rpc("lookup_order_by_no_phone", {
    p_order_no: orderNo,
    p_phone: phone,
    p_secret: secret,
  });
  if (error) {
    console.error("[orders/lookup] 조회 실패:", error.message);
    return NextResponse.json({ ok: false, reason: "lookup_failed" }, { status: 502 });
  }

  return NextResponse.json({ ok: true, result: data ?? null });
}

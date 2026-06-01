import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { PortOneClient } from "@portone/server-sdk";

// 빌링키 등록(정기결제 카드 저장) 서버 라우트.
//
// 보안 설계 (confirm_payment/webhook 과 동일 원칙):
//   1) 본인 검증: 클라이언트가 보낸 Supabase 액세스토큰(Authorization: Bearer)을
//      서버에서 getUser 로 재검증해 user_id 를 얻는다. 브라우저가 보낸 user_id 는 믿지 않는다.
//   2) PG 권위 검증: 브라우저가 넘긴 billingKey 를 그대로 신뢰하지 않고,
//      getBillingKeyInfo 로 실제 '발급(ISSUED)' 상태인지 포트원에서 다시 확인한다.
//   3) 저장은 SECURITY DEFINER RPC(store_billing_key)가 수행하며, Vault 공유 시크릿
//      (BILLING_SECRET)으로 호출자를 한 번 더 검증한다(service_role 미사용).
//
// 환경변수(서버 전용, 절대 커밋 금지): PORTONE_API_SECRET, BILLING_SECRET.
// 미설정 시 503(라이브에서는 정기결제 UI가 isBillingConfigured 로 비활성).

export const runtime = "nodejs";

export async function POST(req: Request) {
  const apiSecret = process.env.PORTONE_API_SECRET;
  const billingSecret = process.env.BILLING_SECRET;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseAnon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!apiSecret || !billingSecret || !supabaseUrl || !supabaseAnon) {
    return NextResponse.json({ ok: false, reason: "not_configured" }, { status: 503 });
  }

  // 1) 인증: Authorization Bearer 토큰으로 본인 검증.
  const authHeader = req.headers.get("authorization") ?? "";
  const token = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";
  if (!token) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }

  // anon 클라이언트로 토큰 검증 + RPC 호출(service_role 미사용).
  const supabase = createClient(supabaseUrl, supabaseAnon, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: userData, error: userErr } = await supabase.auth.getUser(token);
  if (userErr || !userData.user) {
    return NextResponse.json({ ok: false, reason: "unauthorized" }, { status: 401 });
  }
  const userId = userData.user.id;

  // 2) 입력 검증(수동 — 프로젝트 컨벤션). billingKey 는 비어있지 않은 문자열이어야 한다.
  let billingKey = "";
  try {
    const body = (await req.json()) as { billingKey?: unknown };
    if (typeof body.billingKey === "string") billingKey = body.billingKey.trim();
  } catch {
    return NextResponse.json({ ok: false, reason: "invalid_input" }, { status: 400 });
  }
  if (!billingKey) {
    return NextResponse.json({ ok: false, reason: "invalid_input" }, { status: 400 });
  }

  // 3) PG 권위 검증: 빌링키 실제 발급(ISSUED) 여부 + 표시용 카드/PG 정보 조회.
  let info: Awaited<
    ReturnType<ReturnType<typeof PortOneClient>["payment"]["billingKey"]["getBillingKeyInfo"]>
  >;
  try {
    const portone = PortOneClient({ secret: apiSecret });
    info = await portone.payment.billingKey.getBillingKeyInfo({ billingKey });
  } catch (error) {
    console.error("[billing/register] getBillingKeyInfo 실패:", error);
    // 포트원 일시 오류일 수 있으므로 재시도 가능하도록 5xx.
    return NextResponse.json({ ok: false, reason: "lookup_failed" }, { status: 502 });
  }

  if (info.status !== "ISSUED") {
    return NextResponse.json({ ok: false, reason: "not_issued" }, { status: 400 });
  }
  // status 'ISSUED' 확정 → 발급정보 형태로 좁힌다(SDK 판별 유니온).
  const issued = info as Extract<typeof info, { status: "ISSUED" }>;

  // 카드/PG 표시 정보 추출(정보성). 카드 원번호(PAN)는 저장하지 않고 끝 4자리만.
  const cardMethod = issued.methods?.find(
    (m) => typeof m.type === "string" && m.type === "BillingKeyPaymentMethodCard"
  ) as { card?: { name?: string; number?: string } } | undefined;
  const cardName = cardMethod?.card?.name ?? null;
  const digits = cardMethod?.card?.number?.replace(/\D/g, "") ?? "";
  const cardLast4 = digits.length >= 4 ? digits.slice(-4) : null;

  const channel = issued.channels?.[0];
  const pgProvider =
    channel && typeof channel.pgProvider === "string"
      ? channel.pgProvider
      : channel?.name ?? null;

  // 4) 저장: SECURITY DEFINER RPC + Vault 시크릿 게이트.
  const { data: billingKeyId, error: rpcErr } = await supabase.rpc("store_billing_key", {
    p_secret: billingSecret,
    p_user_id: userId,
    p_billing_key: billingKey,
    p_pg_provider: pgProvider,
    p_card_name: cardName,
    p_card_last4: cardLast4,
  });

  if (rpcErr) {
    console.error("[billing/register] store_billing_key 실패:", rpcErr.message);
    return NextResponse.json({ ok: false, reason: "store_failed" }, { status: 500 });
  }

  return NextResponse.json({
    ok: true,
    billingKeyId,
    card: { name: cardName, last4: cardLast4, pgProvider },
  });
}

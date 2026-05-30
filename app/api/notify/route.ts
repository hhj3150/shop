import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sendSms, isSolapiConfigured } from "@/lib/solapi";
import { DEPOSIT } from "@/lib/site";
import { formatKRW } from "@/lib/products";
import { courierLabel, trackingUrl } from "@/lib/couriers";

// 정보성 문자 자동 발송. 클라이언트가 세션 토큰과 함께 호출하면 서버에서
// 토큰을 검증하고, DB의 권위 있는 값으로 수신번호·문구를 구성해 발송한다.
// (문구를 클라이언트가 정하지 못하게 하여 임의 발송/스팸을 차단)

type OrderKind = "order_received" | "payment_confirmed" | "shipped";
const ADMIN_KINDS = new Set(["payment_confirmed", "shipped"]);

type Body = {
  kind: OrderKind | "subscription_cancelled";
  orderId?: string;
  slotId?: number;
};

const SHOP = "송영신목장";

function userClient(token: string): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

export async function POST(req: Request) {
  if (!isSolapiConfigured()) {
    // 환경변수 미설정 시에도 주문 흐름을 막지 않는다.
    return NextResponse.json({ ok: false, reason: "not_configured" });
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.json({ ok: false, reason: "supabase_env_missing" });
  }

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) return NextResponse.json({ ok: false, reason: "no_token" }, { status: 401 });

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ ok: false, reason: "bad_json" }, { status: 400 });
  }

  const sb = userClient(token);
  const { data: auth_user, error: authErr } = await sb.auth.getUser();
  if (authErr || !auth_user?.user) {
    return NextResponse.json({ ok: false, reason: "invalid_token" }, { status: 401 });
  }
  const userId = auth_user.user.id;

  // 관리자 전용 알림은 호출자가 관리자인지 확인한다.
  if (ADMIN_KINDS.has(body.kind)) {
    const { data: prof } = await sb.from("profiles").select("is_admin").eq("id", userId).single();
    if (!prof?.is_admin) {
      return NextResponse.json({ ok: false, reason: "forbidden" }, { status: 403 });
    }
  }

  if (body.kind === "subscription_cancelled") {
    return handleCancel(sb, body.slotId);
  }
  return handleOrder(sb, body.kind, body.orderId);
}

async function handleOrder(sb: SupabaseClient, kind: OrderKind, orderId?: string) {
  if (!orderId) return NextResponse.json({ ok: false, reason: "no_order" }, { status: 400 });
  const { data: o } = await sb
    .from("orders")
    .select("order_no, total_amount, ship_name, ship_phone, courier, tracking_no")
    .eq("id", orderId)
    .single();
  if (!o) return NextResponse.json({ ok: false, reason: "order_not_found" }, { status: 404 });

  const name = (o.ship_name as string) || "고객";
  let text = "";
  let subject = "";

  if (kind === "order_received") {
    subject = `[${SHOP}] 주문 접수`;
    text =
      `[${SHOP}] ${name}님, 주문이 접수되었습니다.\n` +
      `주문번호 ${o.order_no}\n` +
      `입금하실 금액 ${formatKRW(o.total_amount as number)}\n` +
      `${DEPOSIT.bank} ${DEPOSIT.account} (예금주 ${DEPOSIT.holder})\n` +
      `입금이 확인되면 다시 안내드리겠습니다.`;
  } else if (kind === "payment_confirmed") {
    subject = `[${SHOP}] 입금 확인`;
    text =
      `[${SHOP}] ${name}님, 입금이 확인되었습니다.\n` +
      `주문번호 ${o.order_no}\n` +
      `신선하게 준비하여 순차 발송해 드리겠습니다.`;
  } else {
    // shipped
    subject = `[${SHOP}] 발송 안내`;
    const courier = courierLabel(o.courier as string | null);
    const tracking = (o.tracking_no as string | null) ?? "";
    const url = trackingUrl(o.courier as string | null, tracking);
    text =
      `[${SHOP}] ${name}님, 상품이 발송되었습니다.\n` +
      `주문번호 ${o.order_no}\n` +
      `${courier}${tracking ? ` ${tracking}` : ""}` +
      (url ? `\n배송조회 ${url}` : "");
  }

  const r = await sendSms(o.ship_phone as string, text, subject);
  return NextResponse.json(r);
}

async function handleCancel(sb: SupabaseClient, slotId?: number) {
  if (!slotId) return NextResponse.json({ ok: false, reason: "no_slot" }, { status: 400 });
  const { data: slot } = await sb
    .from("subscription_slots")
    .select("refund_amount, order_id, user_id")
    .eq("id", slotId)
    .single();
  if (!slot) return NextResponse.json({ ok: false, reason: "slot_not_found" }, { status: 404 });

  // 수신번호·이름은 연결된 주문에서 가져오고, 없으면 프로필에서 보완.
  let phone = "";
  let name = "고객";
  if (slot.order_id) {
    const { data: o } = await sb
      .from("orders")
      .select("ship_name, ship_phone")
      .eq("id", slot.order_id)
      .single();
    if (o) {
      phone = (o.ship_phone as string) ?? "";
      name = (o.ship_name as string) || name;
    }
  }
  if (!phone) {
    const { data: prof } = await sb
      .from("profiles")
      .select("name, phone")
      .eq("id", slot.user_id)
      .single();
    if (prof) {
      phone = (prof.phone as string) ?? "";
      name = (prof.name as string) || name;
    }
  }

  const refund = (slot.refund_amount as number | null) ?? 0;
  const text =
    `[${SHOP}] ${name}님, 구독 해지가 접수되었습니다.\n` +
    `환불 예정 금액 ${formatKRW(refund)}\n` +
    `입력하신 환불 계좌로 송금해 드리겠습니다.`;
  const r = await sendSms(phone, text, `[${SHOP}] 해지 접수`);
  return NextResponse.json(r);
}

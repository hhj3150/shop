import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sendSms, sendInfo, isSolapiConfigured, type AlimtalkSpec } from "@/lib/solapi";
import { DEPOSIT } from "@/lib/site";
import { formatKRW } from "@/lib/products";
import { courierLabel, trackingUrl } from "@/lib/couriers";

// 정보성 문자 자동 발송. 클라이언트가 세션 토큰과 함께 호출하면 서버에서
// 토큰을 검증하고, DB의 권위 있는 값으로 수신번호·문구를 구성해 발송한다.
// (문구를 클라이언트가 정하지 못하게 하여 임의 발송/스팸을 차단)

type OrderKind = "order_received" | "payment_confirmed" | "shipped";
type GiftKind = "gift_subscription" | "gift_once";
const ADMIN_KINDS = new Set(["payment_confirmed", "shipped"]);

type Body = {
  kind: OrderKind | GiftKind | "subscription_cancelled" | "welcome";
  orderId?: string;
  slotId?: number;
};

const SHOP = "송영신목장";
const DAY_LABEL: Record<string, string> = {
  mon: "월",
  tue: "화",
  wed: "수",
  thu: "목",
  fri: "금",
};

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

  if (body.kind === "welcome") {
    return handleWelcome(sb, userId);
  }
  if (body.kind === "gift_subscription" || body.kind === "gift_once") {
    return handleGift(sb, body.kind, body.orderId);
  }
  if (body.kind === "subscription_cancelled") {
    return handleCancel(sb, body.slotId);
  }
  return handleOrder(sb, body.kind, body.orderId);
}

// 회원가입 환영 문자. 수신번호·이름은 본인 프로필에서 가져온다(임의 발송 방지).
async function handleWelcome(sb: SupabaseClient, userId: string) {
  const { data: prof } = await sb
    .from("profiles")
    .select("name, phone")
    .eq("id", userId)
    .single();
  const phone = (prof?.phone as string | null) ?? "";
  if (!phone) return NextResponse.json({ ok: false, reason: "no_phone" });
  const name = (prof?.name as string) || "고객";
  const text =
    `[${SHOP}] ${name}님, 회원가입을 환영합니다.\n` +
    `정기구독은 선착순 한정으로 모십니다. 주문해 주시면 입금 안내와 발송 소식을 문자로 전해드리겠습니다.`;
  const r = await sendSms(phone, text, `[${SHOP}] 가입을 환영합니다`);
  return NextResponse.json(r);
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
  const account = `${DEPOSIT.bank} ${DEPOSIT.account} (예금주 ${DEPOSIT.holder})`;

  if (kind === "order_received") {
    // 주문 접수 + 입금 안내 (알림톡 PAYMENT_GUIDE, 미승인 시 LMS 폴백).
    const text =
      `[${SHOP}] ${name}님, 주문이 접수되었습니다.\n` +
      `주문번호 ${o.order_no}\n` +
      `입금하실 금액 ${formatKRW(o.total_amount as number)}\n` +
      `${account}\n` +
      `입금이 확인되면 다시 안내드리겠습니다.`;
    const alimtalk: AlimtalkSpec = {
      templateKey: "PAYMENT_GUIDE",
      variables: {
        "#{고객명}": name,
        "#{주문번호}": o.order_no as string,
        "#{금액}": formatKRW(o.total_amount as number),
        "#{입금계좌}": account,
      },
    };
    const r = await sendInfo(o.ship_phone as string, {
      text,
      subject: `[${SHOP}] 주문 접수`,
      alimtalk,
    });
    return NextResponse.json(r);
  }

  if (kind === "payment_confirmed") {
    // 입금 확인 (알림톡 PAYMENT_CONFIRMED, 미승인 시 LMS 폴백).
    const text =
      `[${SHOP}] ${name}님, 입금이 확인되었습니다.\n` +
      `주문번호 ${o.order_no}\n` +
      `신선하게 준비하여 순차 발송해 드리겠습니다.`;
    const alimtalk: AlimtalkSpec = {
      templateKey: "PAYMENT_CONFIRMED",
      variables: {
        "#{고객명}": name,
        "#{주문번호}": o.order_no as string,
      },
    };
    const r = await sendInfo(o.ship_phone as string, {
      text,
      subject: `[${SHOP}] 입금 확인`,
      alimtalk,
    });
    return NextResponse.json(r);
  }

  // shipped — 발송 안내(전용 알림톡 템플릿 없음 → 기존 LMS/SMS 유지).
  const courier = courierLabel(o.courier as string | null);
  const tracking = (o.tracking_no as string | null) ?? "";
  const url = trackingUrl(o.courier as string | null, tracking);
  const text =
    `[${SHOP}] ${name}님, 상품이 발송되었습니다.\n` +
    `주문번호 ${o.order_no}\n` +
    `${courier}${tracking ? ` ${tracking}` : ""}` +
    (url ? `\n배송조회 ${url}` : "");
  const r = await sendSms(o.ship_phone as string, text, `[${SHOP}] 발송 안내`);
  return NextResponse.json(r);
}

// 선물 주문 알림. 받는 분에게는 선물 안내(결제정보 없음), 보내는 분(주문자)에게는
//   입금 안내를 각각 보낸다. 수신번호·문구는 모두 DB 권위값으로 구성한다.
async function handleGift(sb: SupabaseClient, kind: GiftKind, orderId?: string) {
  if (!orderId) return NextResponse.json({ ok: false, reason: "no_order" }, { status: 400 });
  const { data: o } = await sb
    .from("orders")
    .select(
      "order_no, total_amount, ship_name, ship_phone, gifter_name, gift_message, ship_date, user_id"
    )
    .eq("id", orderId)
    .single();
  if (!o) return NextResponse.json({ ok: false, reason: "order_not_found" }, { status: 404 });

  const { data: items } = await sb
    .from("order_items")
    .select("product_name, volume, qty, delivery_day")
    .eq("order_id", orderId);

  const recipientName = (o.ship_name as string) || "받는 분";
  const gifterName = (o.gifter_name as string) || "보내는 분";

  // 제품 요약. 정기는 요일까지, 단품은 제품·수량만.
  const summary = (items ?? [])
    .map((it) => {
      const qtyPart = (it.qty as number) > 1 ? ` ${it.qty}개` : "";
      if (kind === "gift_subscription" && it.delivery_day) {
        const day = DAY_LABEL[it.delivery_day as string] ?? "";
        return `${it.product_name} ${it.volume}${qtyPart} (매주 ${day}요일)`;
      }
      return `${it.product_name} ${it.volume}${qtyPart}`;
    })
    .join("\n");

  const messageLine = o.gift_message
    ? `\n메시지: ${o.gift_message as string}`
    : "";

  // 받는 분에게 선물 안내 (결제 정보 없음).
  let recipientText = "";
  if (kind === "gift_subscription") {
    recipientText =
      `[${SHOP}] ${recipientName}님, ${gifterName}님이 보내는 선물입니다.\n` +
      `${gifterName}님이 아래 제품을 매주 정기구독으로 받으시도록 신청하셨습니다.\n` +
      `${summary}${messageLine}`;
  } else {
    const [, mo, da] = (o.ship_date as string | null)?.split("-") ?? [];
    const datePart = mo && da ? `${Number(mo)}월 ${Number(da)}일 발송 예정입니다.` : "곧 발송될 예정입니다.";
    recipientText =
      `[${SHOP}] ${recipientName}님, ${gifterName}님이 보내는 선물입니다.\n` +
      `${gifterName}님이 아래 제품을 보내셨습니다. ${datePart}\n` +
      `${summary}${messageLine}`;
  }
  const recipientResult = await sendSms(
    o.ship_phone as string,
    recipientText,
    `[${SHOP}] 선물이 도착할 예정입니다`
  );

  // 보내는 분(주문자)에게 입금 안내.
  const { data: buyer } = await sb
    .from("profiles")
    .select("phone")
    .eq("id", o.user_id as string)
    .single();
  const buyerPhone = (buyer?.phone as string | null) ?? "";
  if (buyerPhone) {
    const buyerText =
      `[${SHOP}] 선물 주문이 접수되었습니다.\n` +
      `주문번호 ${o.order_no}\n` +
      `입금하실 금액 ${formatKRW(o.total_amount as number)}\n` +
      `${DEPOSIT.bank} ${DEPOSIT.account} (예금주 ${DEPOSIT.holder})\n` +
      `입금이 확인되면 ${recipientName}님께 발송해 드립니다.`;
    await sendSms(buyerPhone, buyerText, `[${SHOP}] 선물 주문 접수`);
  }

  return NextResponse.json(recipientResult);
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

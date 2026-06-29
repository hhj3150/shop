import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sendInfo, isSolapiConfigured, type AlimtalkSpec, type InfoMessage } from "@/lib/solapi";
import { logSms } from "@/lib/sms-log";
import { DEPOSIT } from "@/lib/site";
import { formatKRW } from "@/lib/products";
import { courierLabel, trackingUrl } from "@/lib/couriers";
import { dispatchScheduleForSlot, type DispatchSlotInfo } from "@/lib/dispatch-schedule";
import { firstDeliveryRitualNote } from "@/lib/first-delivery";

// 정보성 문자 자동 발송. 클라이언트가 세션 토큰과 함께 호출하면 서버에서
// 토큰을 검증하고, DB의 권위 있는 값으로 수신번호·문구를 구성해 발송한다.
// (문구를 클라이언트가 정하지 못하게 하여 임의 발송/스팸을 차단)

type OrderKind = "order_received" | "payment_confirmed" | "shipped" | "delivered" | "order_cancelled";
type GiftKind = "gift_subscription" | "gift_once";
type RenewalKind = "renewal_guide" | "renewal_confirmed";
const ADMIN_KINDS = new Set(["payment_confirmed", "shipped", "delivered", "renewal_confirmed", "order_cancelled"]);

type Body = {
  kind: OrderKind | GiftKind | RenewalKind | "subscription_cancelled" | "welcome";
  orderId?: string;
  slotId?: number;
};

const SHOP = "송영신목장";

// 현재 KST 날짜(YYYY-MM-DD). KST는 DST 없는 UTC+9.
function kstTodayISO(): string {
  return new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

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

// 발송 + 이력 적재(클레임 복기). 로그는 best-effort — 실패해도 발송/응답을 막지 않는다.
async function sendAndLog(
  kind: string,
  ids: { userId?: string | null; orderId?: string | null },
  phone: string,
  msg: InfoMessage
) {
  const r = await sendInfo(phone, msg);
  await logSms({
    kind,
    toPhone: phone,
    body: msg.text,
    templateKey: msg.alimtalk?.templateKey,
    channel: "info",
    ok: r.ok,
    failReason: r.ok ? null : (r.reason ?? null),
    userId: ids.userId ?? null,
    orderId: ids.orderId ?? null,
  });
  return r;
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
  if (body.kind === "renewal_guide" || body.kind === "renewal_confirmed") {
    return handleRenewal(sb, body.kind, body.orderId);
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
  const r = await sendAndLog("welcome", { userId }, phone, {
    text,
    subject: `[${SHOP}] 가입을 환영합니다`,
    alimtalk: {
      templateKey: "WELCOME",
      variables: { "#{고객명}": name },
    },
  });
  return NextResponse.json(r);
}

async function handleOrder(sb: SupabaseClient, kind: OrderKind, orderId?: string) {
  if (!orderId) return NextResponse.json({ ok: false, reason: "no_order" }, { status: 400 });
  const { data: o } = await sb
    .from("orders")
    .select("order_no, total_amount, ship_name, ship_phone, courier, tracking_no, is_gift, gifter_name, ship_date, delivery_method, user_id, order_type, block_weeks, shipped_at")
    .eq("id", orderId)
    .single();
  if (!o) return NextResponse.json({ ok: false, reason: "order_not_found" }, { status: 404 });

  const name = (o.ship_name as string) || "고객";
  const account = `${DEPOSIT.bank} ${DEPOSIT.account} (예금주 ${DEPOSIT.holder})`;

  if (kind === "order_cancelled") {
    // 주문 취소 안내. 선물 주문이면 받는 분이 아니라 보낸 분(주문자)에게 보낸다.
    let toPhone = o.ship_phone as string;
    let toName = name;
    if (o.is_gift) {
      const { data: prof } = await sb
        .from("profiles")
        .select("name, phone")
        .eq("id", o.user_id as string)
        .single();
      if (prof?.phone) {
        toPhone = prof.phone as string;
        toName = (o.gifter_name as string) || (prof.name as string) || name;
      }
    }
    const text =
      `[${SHOP}] ${toName}님, 주문이 취소되었습니다.\n` +
      `주문번호 ${o.order_no}\n` +
      `이미 입금하셨다면 입력하신 환불 계좌로 처리해 드립니다. 문의 주시면 빠르게 도와드리겠습니다.`;
    const r = await sendAndLog(
      kind,
      { orderId, userId: (o.user_id as string | null) ?? null },
      toPhone,
      { text, subject: `[${SHOP}] 주문 취소` }
    );
    return NextResponse.json(r);
  }

  if (kind === "order_received") {
    // 주문 접수 + 입금 안내 (알림톡 PAYMENT_GUIDE, 미승인 시 LMS 폴백).
    // 발송 예정일은 ship_date(서버 산출, KST)를 'M월 D일'로 안내. 값 없으면 기존 문구 유지.
    const [, mo, da] = (o.ship_date as string | null)?.split("-") ?? [];
    const dispatchLine =
      mo && da
        ? o.delivery_method === "방문수령"
          ? `입금이 확인되면 ${Number(mo)}월 ${Number(da)}일부터 목장에서 수령하실 수 있습니다.`
          : `입금이 확인되면 ${Number(mo)}월 ${Number(da)}일에 발송해 드립니다.`
        : `입금이 확인되면 다시 안내드리겠습니다.`;
    const text =
      `[${SHOP}] ${name}님, 주문이 접수되었습니다.\n` +
      `주문번호 ${o.order_no}\n` +
      `입금하실 금액 ${formatKRW(o.total_amount as number)}\n` +
      `${account}\n` +
      dispatchLine;
    const alimtalk: AlimtalkSpec = {
      templateKey: "PAYMENT_GUIDE",
      variables: {
        "#{고객명}": name,
        "#{주문번호}": o.order_no as string,
        "#{금액}": formatKRW(o.total_amount as number),
        "#{입금계좌}": account,
      },
    };
    const r = await sendAndLog(kind, { orderId }, o.ship_phone as string, {
      text,
      subject: `[${SHOP}] 주문 접수`,
      alimtalk,
    });
    return NextResponse.json(r);
  }

  if (kind === "payment_confirmed") {
    // 입금 확인 (알림톡 PAYMENT_CONFIRMED, 미승인 시 LMS 폴백).
    // 발송 예정일(ship_date, 서버 산출 KST)을 'M월 D일'로 안내. 값 없으면 기존 문구 유지.
    const [, mo, da] = (o.ship_date as string | null)?.split("-") ?? [];
    const dispatchLine =
      mo && da
        ? o.delivery_method === "방문수령"
          ? `${Number(mo)}월 ${Number(da)}일부터 목장에서 수령하실 수 있습니다.`
          : `${Number(mo)}월 ${Number(da)}일에 발송해 드립니다.`
        : `신선하게 준비하여 순차 발송해 드리겠습니다.`;
    const text =
      `[${SHOP}] ${name}님, 입금이 확인되었습니다.\n` +
      `주문번호 ${o.order_no}\n` +
      dispatchLine;
    const alimtalk: AlimtalkSpec = {
      templateKey: "PAYMENT_CONFIRMED",
      variables: {
        "#{고객명}": name,
        "#{주문번호}": o.order_no as string,
      },
    };
    const r = await sendAndLog(kind, { orderId }, o.ship_phone as string, {
      text,
      subject: `[${SHOP}] 입금 확인`,
      alimtalk,
    });
    return NextResponse.json(r);
  }

  if (kind === "delivered") {
    // 배송 완료 안내 (알림톡 DELIVERED, 미승인 시 LMS 폴백).
    const text =
      `[${SHOP}] ${name}님, 상품이 배송 완료되었습니다.\n` +
      `주문번호 ${o.order_no}\n` +
      `신선할 때 맛있게 드세요. 또 찾아주시면 감사하겠습니다.`;
    const alimtalk: AlimtalkSpec = {
      templateKey: "DELIVERED",
      variables: {
        "#{고객명}": name,
        "#{주문번호}": o.order_no as string,
      },
    };
    const r = await sendAndLog(kind, { orderId }, o.ship_phone as string, {
      text,
      subject: `[${SHOP}] 배송 완료`,
      alimtalk,
    });
    return NextResponse.json(r);
  }

  // shipped — 발송 안내 (알림톡 SHIPPED, 미승인/송장 누락 시 LMS 폴백).
  const courier = courierLabel(o.courier as string | null);
  const tracking = (o.tracking_no as string | null) ?? "";
  const url = trackingUrl(o.courier as string | null, tracking);

  // 구독 발송이면 "총 N회 중 M번째"를 본문에 덧붙인다(서버 권위 재계산).
  //   발송은 항상 원주문 행에서 나가므로(연장주문은 유령행) slot.order_id = 이 주문.
  //   회차는 발송일(shipped_at, 없으면 ship_date/오늘) 기준으로 산출 — DispatchPanel 과 동일 SSOT.
  //   주의: 회차 표시는 LMS 본문에만 넣는다. SHIPPED 알림톡 변수에 회차를 강제하면
  //     회차가 없는 단품 발송까지 빈 값→LMS 폴백되어 단품 알림톡이 비활성화되므로 제외.
  let roundSuffix = "";
  // 첫 배송(1회차)에만 '왜 이 우유인지' 브랜드필름 한 줄을 덧붙이고(LMS 본문),
  //   알림톡은 전용 FIRST_SHIPPED 템플릿(필름 버튼 포함)으로 보낸다. FIRST_SHIPPED 의
  //   templateId(env) 가 아직 없으면 자동으로 LMS(이 ritual 본문)로 폴백된다.
  let firstNote = "";
  let isFirstDelivery = false;
  if (o.order_type === "구독") {
    const shipISO =
      ((o.shipped_at as string | null) ?? (o.ship_date as string | null) ?? kstTodayISO()).slice(0, 10);
    const { data: slot } = await sb
      .from("subscription_slots")
      .select("status, started_at, first_ship_date, paused, paused_at, paused_days, extended_weeks")
      .eq("order_id", orderId)
      .maybeSingle();
    if (slot) {
      const sch = dispatchScheduleForSlot(slot as DispatchSlotInfo, (o.block_weeks as number | null) ?? 0, shipISO);
      if (sch.total > 0) roundSuffix = ` (${sch.total}회 중 ${sch.round}번째)`;
      if (sch.round === 1) {
        firstNote = firstDeliveryRitualNote();
        isFirstDelivery = true;
      }
    }
  }

  const text =
    `[${SHOP}] ${name}님, 상품이 발송되었습니다.${roundSuffix}\n` +
    `주문번호 ${o.order_no}\n` +
    `${courier}${tracking ? ` ${tracking}` : ""}` +
    (url ? `\n배송조회 ${url}` : "") +
    firstNote;
  const alimtalk: AlimtalkSpec = {
    // 첫 배송이면 전용 템플릿(브랜드필름 버튼). 미등록(env 없음)이면 sendInfo 가 LMS 로 폴백.
    templateKey: isFirstDelivery ? "FIRST_SHIPPED" : "SHIPPED",
    variables: {
      "#{고객명}": name,
      "#{주문번호}": o.order_no as string,
      "#{택배사}": courier,
      "#{송장번호}": tracking, // 빈 값이면 변수 누락 → LMS 폴백
    },
  };
  const r = await sendAndLog(kind, { orderId }, o.ship_phone as string, {
    text,
    subject: `[${SHOP}] 발송 안내`,
    alimtalk,
  });
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
  const recipientResult = await sendAndLog(kind, { orderId }, o.ship_phone as string, {
    text: recipientText,
    subject: `[${SHOP}] 선물이 도착할 예정입니다`,
    alimtalk: {
      templateKey: "GIFT_RECIPIENT",
      variables: {
        "#{받는분}": recipientName,
        "#{보내는분}": gifterName,
        "#{제품요약}": summary,
      },
    },
  });

  // 보내는 분(주문자)에게 입금 안내.
  const { data: buyer } = await sb
    .from("profiles")
    .select("phone")
    .eq("id", o.user_id as string)
    .single();
  const buyerPhone = (buyer?.phone as string | null) ?? "";
  if (buyerPhone) {
    const account = `${DEPOSIT.bank} ${DEPOSIT.account} (예금주 ${DEPOSIT.holder})`;
    const buyerText =
      `[${SHOP}] 선물 주문이 접수되었습니다.\n` +
      `주문번호 ${o.order_no}\n` +
      `입금하실 금액 ${formatKRW(o.total_amount as number)}\n` +
      `${account}\n` +
      `입금이 확인되면 ${recipientName}님께 발송해 드립니다.`;
    // 보내는 분(주문자) 입금 안내는 주문접수와 동일한 PAYMENT_GUIDE 재사용.
    await sendAndLog(kind, { orderId }, buyerPhone, {
      text: buyerText,
      subject: `[${SHOP}] 선물 주문 접수`,
      alimtalk: {
        templateKey: "PAYMENT_GUIDE",
        variables: {
          "#{고객명}": gifterName,
          "#{주문번호}": o.order_no as string,
          "#{금액}": formatKRW(o.total_amount as number),
          "#{입금계좌}": account,
        },
      },
    });
  }

  return NextResponse.json(recipientResult);
}

// 구독 연장 알림. renewal_guide = 회원이 연장 신청 직후 입금 안내(본인),
//   renewal_confirmed = 관리자가 연장 입금 확인 후(관리자). 문구는 DB 권위값으로 구성.
async function handleRenewal(sb: SupabaseClient, kind: RenewalKind, orderId?: string) {
  if (!orderId) return NextResponse.json({ ok: false, reason: "no_order" }, { status: 400 });
  const { data: o } = await sb
    .from("orders")
    .select("order_no, total_amount, ship_name, ship_phone, block_weeks")
    .eq("id", orderId)
    .single();
  if (!o) return NextResponse.json({ ok: false, reason: "order_not_found" }, { status: 404 });

  const name = (o.ship_name as string) || "고객";
  // 이번 연장으로 이어지는 회차수. 주당 1회 발송이라 block_weeks 가 곧 "회분"이다.
  //   값이 없으면(레거시) 횟수를 단정하지 않고 "다음 회차분" 으로 안내한다.
  const rounds = (o.block_weeks as number | null) ?? 0;
  const roundsLabel = rounds > 0 ? `${rounds}회분` : "다음 회차분";

  if (kind === "renewal_guide") {
    const account = `${DEPOSIT.bank} ${DEPOSIT.account} (예금주 ${DEPOSIT.holder})`;
    const text =
      `[${SHOP}] ${name}님, 구독 연장 신청이 접수되었습니다.\n` +
      `주문번호 ${o.order_no}\n` +
      `입금하실 금액 ${formatKRW(o.total_amount as number)}\n` +
      `${account}\n` +
      `입금이 확인되면 같은 요일로 ${roundsLabel}이 더 이어집니다.`;
    const r = await sendAndLog(kind, { orderId }, o.ship_phone as string, {
      text,
      subject: `[${SHOP}] 구독 연장 접수`,
      alimtalk: {
        templateKey: "RENEW_GUIDE",
        variables: {
          "#{고객명}": name,
          "#{주문번호}": o.order_no as string,
          "#{금액}": formatKRW(o.total_amount as number),
          "#{입금계좌}": account,
          // 회차수가 없으면(레거시) 빈 값 → variablesComplete=false → 자동 LMS 폴백.
          "#{회차}": rounds > 0 ? String(rounds) : "",
        },
      },
    });
    return NextResponse.json(r);
  }

  // renewal_confirmed — 연장 입금 확인.
  const text =
    `[${SHOP}] ${name}님, 구독 연장 입금이 확인되었습니다.\n` +
    `주문번호 ${o.order_no}\n` +
    `같은 요일로 ${roundsLabel}이 더 이어집니다. 변함없이 신선하게 보내드리겠습니다.`;
  const r = await sendAndLog(kind, { orderId }, o.ship_phone as string, {
    text,
    subject: `[${SHOP}] 구독 연장 확인`,
    alimtalk: {
      templateKey: "RENEW_CONFIRMED",
      variables: {
        "#{고객명}": name,
        "#{주문번호}": o.order_no as string,
        // 회차수가 없으면(레거시) 빈 값 → variablesComplete=false → 자동 LMS 폴백.
        "#{회차}": rounds > 0 ? String(rounds) : "",
      },
    },
  });
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
  const r = await sendAndLog(
    "subscription_cancelled",
    { userId: slot.user_id as string | null, orderId: slot.order_id as string | null },
    phone,
    {
    text,
    subject: `[${SHOP}] 해지 접수`,
    alimtalk: {
      templateKey: "SUBSCRIPTION_CANCELLED",
      variables: {
        "#{고객명}": name,
        "#{환불금액}": formatKRW(refund),
      },
    },
  });
  return NextResponse.json(r);
}

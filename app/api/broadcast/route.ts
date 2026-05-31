import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { sendBulk, isSolapiConfigured } from "@/lib/solapi";

// 관리자 단체문자(공지·광고) 발송. 클라이언트가 세션 토큰과 함께 호출하면
// 서버에서 (1) 관리자 여부 (2) 입력 검증 (3) 광고성 법적 의무를 처리한 뒤 발송한다.
// 광고성(정보통신망법): (광고) 표기·무료수신거부 안내 필수, 야간(21~08시) 발송 금지.

const SHOP = "송영신목장";
const MAX_RECIPIENTS = 1000; // 실수 대량발송 방지 상한
const MAX_LEN = 2000; // LMS 본문 한도

type Body = {
  message?: unknown;
  subject?: unknown;
  recipients?: unknown;
  isAd?: unknown;
  optout?: unknown;
};

function userClient(token: string): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// 한국 시각(KST=UTC+9) 기준 시(0-23). 서버(UTC)에서 야간 광고 차단 판정에 사용.
function kstHour(): number {
  return (new Date().getUTCHours() + 9) % 24;
}

export async function POST(req: Request) {
  if (!isSolapiConfigured()) {
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

  // 단체발송은 관리자만.
  const { data: prof } = await sb
    .from("profiles")
    .select("is_admin")
    .eq("id", auth_user.user.id)
    .single();
  if (!prof?.is_admin) {
    return NextResponse.json({ ok: false, reason: "forbidden" }, { status: 403 });
  }

  // ── 입력 검증 ──────────────────────────────────────────────
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message || message.length > MAX_LEN) {
    return NextResponse.json(
      { ok: false, reason: "본문이 비었거나 너무 깁니다." },
      { status: 400 }
    );
  }
  const subject = typeof body.subject === "string" ? body.subject.trim().slice(0, 40) : "";
  const isAd = body.isAd === true;
  const optout = typeof body.optout === "string" ? body.optout.trim().slice(0, 60) : "";

  const rawRecipients = Array.isArray(body.recipients) ? body.recipients : [];
  const recipients = Array.from(
    new Set(
      rawRecipients
        .filter((r): r is string => typeof r === "string")
        .map((r) => r.replace(/[^0-9]/g, ""))
        .filter((r) => r.length >= 9 && r.length <= 11)
    )
  );
  if (recipients.length === 0) {
    return NextResponse.json(
      { ok: false, reason: "유효한 수신번호가 없습니다." },
      { status: 400 }
    );
  }
  if (recipients.length > MAX_RECIPIENTS) {
    return NextResponse.json(
      { ok: false, reason: `1회 최대 ${MAX_RECIPIENTS}명까지 발송할 수 있습니다.` },
      { status: 400 }
    );
  }

  // ── 광고성 법적 의무 처리 ──────────────────────────────────
  let finalText = message;
  if (isAd) {
    const h = kstHour();
    if (h >= 21 || h < 8) {
      return NextResponse.json(
        { ok: false, reason: "야간(21시~익일 08시)에는 광고성 문자를 보낼 수 없습니다." },
        { status: 400 }
      );
    }
    if (!optout) {
      return NextResponse.json(
        { ok: false, reason: "광고성 문자는 무료수신거부 안내가 필요합니다." },
        { status: 400 }
      );
    }
    const head = /^\(광고\)/.test(message) ? "" : "(광고) ";
    finalText = `${head}${message}\n${optout}`;
  }

  const r = await sendBulk(recipients, finalText, subject || `[${SHOP}] 안내`);
  return NextResponse.json(r);
}

import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { runNewsRadar } from "@/lib/news-radar-run";

// 관리자 '지금 한 번 수집' — 소식 레이더를 즉시 실행(스케줄과 동일 로직). 관리자 인증 필수.
//   환경변수(서버 전용): NEWS_RADAR_SECRET, OPENAI_API_KEY, NEXT_PUBLIC_SUPABASE_*.

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(req: Request) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anon) {
    return NextResponse.json({ ok: false, reason: "supabase_env_missing" }, { status: 503 });
  }

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) return NextResponse.json({ ok: false, reason: "no_token" }, { status: 401 });

  // 관리자 검증.
  const sb = createClient(supabaseUrl, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: authUser, error: authErr } = await sb.auth.getUser();
  if (authErr || !authUser?.user) {
    return NextResponse.json({ ok: false, reason: "invalid_token" }, { status: 401 });
  }
  const { data: prof } = await sb.from("profiles").select("is_admin").eq("id", authUser.user.id).single();
  if (!prof?.is_admin) {
    return NextResponse.json({ ok: false, reason: "forbidden" }, { status: 403 });
  }

  const result = await runNewsRadar({
    supabaseUrl,
    anon,
    secret: process.env.NEWS_RADAR_SECRET ?? "",
    apiKey: process.env.OPENAI_API_KEY ?? "",
    model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
  });
  return NextResponse.json(result, { status: result.ok ? 200 : 502 });
}

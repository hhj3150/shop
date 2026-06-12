import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { enrichSummary } from "@/lib/news-radar-run";

// 관리자 수동 추가 — 검색 후보를 '대기'로 적재. 적재 전 원문 본문 기반 강화 요약(enrich)을 거쳐
//   자동 수집과 동일한 한 문단 한글 요약을 보장한다. 관리자 인증 필수.
//   환경변수(서버 전용): OPENAI_API_KEY, JINA_API_KEY, NEXT_PUBLIC_SUPABASE_*.

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

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const str = (v: unknown): string => (typeof v === "string" ? v : "");
  const title_ko = str(body?.title_ko);
  const summary_ko = str(body?.summary_ko);
  const source_name = str(body?.source_name);
  const source_url = str(body?.source_url);
  const original_title = str(body?.original_title);
  const topic = str(body?.topic);
  const category = str(body?.category);
  const contentText = str(body?.contentText);
  if (!title_ko || !source_url) {
    return NextResponse.json({ ok: false, reason: "invalid_input" }, { status: 400 });
  }

  const e = await enrichSummary(
    { title_ko, summary_ko, source_url, original_title, field: topic, contentText },
    {
      apiKey: process.env.OPENAI_API_KEY ?? "",
      model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
      jinaKey: process.env.JINA_API_KEY,
    }
  );

  const { data, error } = await sb.rpc("news_radar_insert_draft", {
    p_title_ko: e.title_ko,
    p_summary_ko: e.summary_ko,
    p_source_name: source_name,
    p_source_url: source_url,
    p_original_title: original_title,
    p_topic: topic,
    p_category: category,
  });
  if (error) {
    return NextResponse.json({ ok: false, reason: error.message }, { status: 502 });
  }
  return NextResponse.json({ ok: true, inserted: Boolean(data) }, { status: 200 });
}

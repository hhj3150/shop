import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";
import {
  collectFeedCandidates,
  collectTermCandidates,
  scoreCandidates,
} from "@/lib/news-radar-run";

// 관리자 검색 — 검색어(옵션) → 후보 점수화 → 상위 후보 반환(insert 안 함). 관리자 인증 필수.
//   환경변수(서버 전용): OPENAI_API_KEY, OPENAI_MODEL, NEXT_PUBLIC_SUPABASE_*.

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

  const apiKey = process.env.OPENAI_API_KEY ?? "";
  if (!apiKey) return NextResponse.json({ ok: false, reason: "not_configured" }, { status: 503 });

  const body = (await req.json().catch(() => ({}))) as { term?: unknown };
  const term = typeof body.term === "string" ? body.term.trim() : "";

  const candidates = term ? await collectTermCandidates(term) : await collectFeedCandidates();
  if (candidates.length === 0) {
    return NextResponse.json({ ok: true, candidates: [] });
  }

  const scored = await scoreCandidates(candidates, {
    apiKey,
    model: process.env.OPENAI_MODEL || "gpt-5.4-mini",
    searchTerm: term || undefined,
    topN: 8,
  });
  if (!scored.ok) {
    return NextResponse.json({ ok: false, reason: scored.reason ?? "scoring_failed" }, { status: 502 });
  }
  return NextResponse.json({ ok: true, candidates: scored.ranked });
}

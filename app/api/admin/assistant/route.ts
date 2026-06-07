import { NextResponse } from "next/server";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { TOOLS, buildSystemPrompt, dispatchTool, type AdminData } from "@/lib/admin-assistant/tools";
import type { OrderLite, ItemLite, SlotLite } from "@/lib/admin-assistant/queries";

// 관리자 AI 비서 — 자연어 질문을 받아 도구(읽기 전용)로 실제 데이터를 조회해 답한다.
//   보안: (1) 관리자 세션 토큰 검증(is_admin) (2) OPENAI_API_KEY 서버 전용
//         (3) 도구는 모두 읽기 전용 — 데이터 변경 없음.
//   환경변수(서버 전용, 커밋 금지): OPENAI_API_KEY, OPENAI_MODEL(기본 gpt-5.4-mini).

export const runtime = "nodejs";
export const maxDuration = 30;

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MAX_TOOL_ROUNDS = 6;
const MAX_HISTORY = 12;

function userClient(token: string): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  return createClient(url, anon, {
    global: { headers: { Authorization: `Bearer ${token}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// KST(UTC+9) 기준 오늘 ISO 날짜.
function kstTodayISO(): string {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10);
}

// 주어진 ISO 가 속한 주의 월요일·금요일 ISO.
function weekMonFri(iso: string): { monday: string; friday: string } {
  const d = new Date(`${iso}T00:00:00Z`);
  const dow = (d.getUTCDay() + 6) % 7; // 월=0
  const mon = new Date(d);
  mon.setUTCDate(d.getUTCDate() - dow);
  const fri = new Date(mon);
  fri.setUTCDate(mon.getUTCDate() + 4);
  return { monday: mon.toISOString().slice(0, 10), friday: fri.toISOString().slice(0, 10) };
}

// PostgREST 행 상한을 넘겨 전부 가져온다(.range 페이지네이션).
async function fetchAll<T>(
  query: (from: number, to: number) => PromiseLike<{ data: unknown; error: unknown }>
): Promise<T[]> {
  const PAGE = 1000;
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await query(from, from + PAGE - 1);
    const rows = (data as T[] | null) ?? [];
    if (error || rows.length === 0) break;
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

type ChatMessage = { role: string; content?: string | null; tool_calls?: unknown; tool_call_id?: string };

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
  if (!apiKey) {
    return NextResponse.json({ ok: false, reason: "openai_not_configured" }, { status: 503 });
  }
  if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    return NextResponse.json({ ok: false, reason: "supabase_env_missing" }, { status: 503 });
  }

  const auth = req.headers.get("authorization") ?? "";
  const token = auth.toLowerCase().startsWith("bearer ") ? auth.slice(7).trim() : "";
  if (!token) return NextResponse.json({ ok: false, reason: "no_token" }, { status: 401 });

  let body: { messages?: unknown };
  try {
    body = (await req.json()) as { messages?: unknown };
  } catch {
    return NextResponse.json({ ok: false, reason: "bad_json" }, { status: 400 });
  }
  const history = Array.isArray(body.messages) ? body.messages : [];
  const cleanHistory: ChatMessage[] = history
    .filter(
      (m): m is { role: string; content: string } =>
        !!m &&
        typeof (m as { role?: unknown }).role === "string" &&
        ((m as { role: string }).role === "user" || (m as { role: string }).role === "assistant") &&
        typeof (m as { content?: unknown }).content === "string"
    )
    .slice(-MAX_HISTORY)
    .map((m) => ({ role: m.role, content: m.content }));
  if (cleanHistory.length === 0) {
    return NextResponse.json({ ok: false, reason: "empty_message" }, { status: 400 });
  }

  // 관리자 검증.
  const sb = userClient(token);
  const { data: authUser, error: authErr } = await sb.auth.getUser();
  if (authErr || !authUser?.user) {
    return NextResponse.json({ ok: false, reason: "invalid_token" }, { status: 401 });
  }
  const { data: prof } = await sb.from("profiles").select("is_admin").eq("id", authUser.user.id).single();
  if (!prof?.is_admin) {
    return NextResponse.json({ ok: false, reason: "forbidden" }, { status: 403 });
  }

  // 관리자 권한(RLS)으로 데이터 조회.
  // ★ .range() 페이지네이션은 전순서(total order)가 있어야 안전하다 — 정렬이 없으면
  //   1000행을 넘는 순간 페이지 경계에서 행이 누락·중복된다. 고유키(id) 정렬로 안정화.
  const [orders, items, slots] = await Promise.all([
    fetchAll<OrderLite>((f, t) =>
      sb.from("orders").select("*").order("created_at", { ascending: false }).order("id", { ascending: true }).range(f, t)
    ),
    fetchAll<ItemLite>((f, t) => sb.from("order_items").select("*").order("id", { ascending: true }).range(f, t)),
    fetchAll<SlotLite>((f, t) => sb.from("subscription_slots").select("*").order("id", { ascending: true }).range(f, t)),
  ]);
  const data: AdminData = { orders, items, slots };

  const today = kstTodayISO();
  const { monday, friday } = weekMonFri(today);
  const messages: ChatMessage[] = [
    { role: "system", content: buildSystemPrompt(today, monday, friday) },
    ...cleanHistory,
  ];

  // OpenAI tool-use 루프.
  try {
    for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
      const res = await fetch(OPENAI_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, messages, tools: TOOLS, tool_choice: "auto" }),
      });
      const json = (await res.json().catch(() => null)) as {
        choices?: { message?: ChatMessage }[];
        error?: { message?: string };
      } | null;
      if (!res.ok || !json) {
        console.error("[admin/assistant] OpenAI 오류:", json?.error?.message ?? res.status);
        return NextResponse.json(
          { ok: false, reason: "openai_error", detail: json?.error?.message ?? `http_${res.status}` },
          { status: 502 }
        );
      }
      const msg = json.choices?.[0]?.message;
      if (!msg) return NextResponse.json({ ok: false, reason: "no_choice" }, { status: 502 });
      messages.push(msg);

      const toolCalls = (msg.tool_calls as
        | { id: string; function: { name: string; arguments: string } }[]
        | undefined) ?? [];
      if (toolCalls.length === 0) {
        return NextResponse.json({ ok: true, reply: msg.content ?? "" });
      }
      for (const tc of toolCalls) {
        let args: Record<string, unknown> = {};
        try {
          args = JSON.parse(tc.function.arguments || "{}");
        } catch {
          args = {};
        }
        const result = dispatchTool(tc.function.name, args, data);
        messages.push({ role: "tool", tool_call_id: tc.id, content: JSON.stringify(result) });
      }
    }
    return NextResponse.json({ ok: true, reply: "질문을 조금 더 구체적으로 말씀해 주세요. (응답을 마무리하지 못했습니다)" });
  } catch (error) {
    console.error("[admin/assistant] 처리 실패:", error);
    return NextResponse.json({ ok: false, reason: "assistant_failed" }, { status: 500 });
  }
}

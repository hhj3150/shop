import { NextResponse } from "next/server";
import { buildCustomerSystemPrompt } from "@/lib/assistant/knowledge";

// 고객응대 AI(FAQ·안내 전용). 공개 엔드포인트 — 고객 데이터·도구를 쓰지 않고
//   지식 베이스만으로 답한다. 개별 사안은 고객센터/마이페이지로 안내(프롬프트 가드레일).
//   비용·남용 방지: 입력 길이·히스토리 상한. (운영 확대 전 IP 레이트리밋 추가 권장)
//   환경변수(서버 전용): OPENAI_API_KEY, OPENAI_MODEL(기본 gpt-5.4-mini).

export const runtime = "nodejs";
export const maxDuration = 20;

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MAX_HISTORY = 8;
const MAX_MSG_LEN = 500;

type ChatMessage = { role: "user" | "assistant" | "system"; content: string };

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_MODEL || "gpt-5.4-mini";
  if (!apiKey) {
    return NextResponse.json({ ok: false, reason: "openai_not_configured" }, { status: 503 });
  }

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
    .map((m) => ({ role: m.role as "user" | "assistant", content: m.content.slice(0, MAX_MSG_LEN) }));

  if (cleanHistory.length === 0) {
    return NextResponse.json({ ok: false, reason: "empty_message" }, { status: 400 });
  }

  const messages: ChatMessage[] = [
    { role: "system", content: buildCustomerSystemPrompt() },
    ...cleanHistory,
  ];

  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages }),
    });
    const json = (await res.json().catch(() => null)) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
    } | null;
    if (!res.ok || !json) {
      console.error("[assistant] OpenAI 오류:", json?.error?.message ?? res.status);
      return NextResponse.json(
        { ok: false, reason: "openai_error", detail: json?.error?.message ?? `http_${res.status}` },
        { status: 502 }
      );
    }
    const reply = json.choices?.[0]?.message?.content ?? "";
    if (!reply) return NextResponse.json({ ok: false, reason: "no_reply" }, { status: 502 });
    return NextResponse.json({ ok: true, reply });
  } catch (error) {
    console.error("[assistant] 처리 실패:", error);
    return NextResponse.json({ ok: false, reason: "assistant_failed" }, { status: 500 });
  }
}

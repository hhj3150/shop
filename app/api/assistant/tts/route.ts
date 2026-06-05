import { clientIp, checkRateLimit } from "@/lib/assistant/ratelimit";

// 음성 출력 합성(TTS). 어시스턴트 답변 텍스트를 음성(mp3)으로 만들어 돌려준다.
//   비용·남용 방지: 텍스트 길이 상한 + IP 레이트리밋.
//   환경변수(서버 전용): OPENAI_API_KEY, OPENAI_TTS_MODEL(기본 gpt-4o-mini-tts),
//   OPENAI_TTS_VOICE(기본 alloy).

export const runtime = "nodejs";
export const maxDuration = 30;

const OPENAI_TTS_URL = "https://api.openai.com/v1/audio/speech";
const MAX_TEXT_LEN = 1000; // 답변이 길면 앞부분만 읽어 비용·지연을 제한

function jsonError(reason: string, status: number): Response {
  return new Response(JSON.stringify({ ok: false, reason }), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export async function POST(req: Request): Promise<Response> {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";
  const voice = process.env.OPENAI_TTS_VOICE || "alloy";
  if (!apiKey) return jsonError("openai_not_configured", 503);

  const allowed = await checkRateLimit(clientIp(req), 12, 60);
  if (!allowed) return jsonError("rate_limited", 429);

  let body: { text?: unknown };
  try {
    body = (await req.json()) as { text?: unknown };
  } catch {
    return jsonError("bad_json", 400);
  }

  const text = typeof body.text === "string" ? body.text.trim().slice(0, MAX_TEXT_LEN) : "";
  if (!text) return jsonError("empty_text", 400);

  try {
    const res = await fetch(OPENAI_TTS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, voice, input: text, response_format: "mp3" }),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error("[assistant/tts] OpenAI 오류:", res.status, detail.slice(0, 200));
      return jsonError("tts_error", 502);
    }
    const audio = await res.arrayBuffer();
    return new Response(audio, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store",
      },
    });
  } catch (error) {
    console.error("[assistant/tts] 처리 실패:", error);
    return jsonError("tts_failed", 500);
  }
}

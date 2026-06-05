import { NextResponse } from "next/server";
import { clientIp, checkRateLimit } from "@/lib/assistant/ratelimit";

// 음성 입력 전사(STT). 고객이 마이크로 말한 오디오를 받아 텍스트로 바꾼다.
//   고객 데이터·도구는 쓰지 않으며, 전사 결과는 기존 /api/assistant 로 다시 보내 답을 만든다.
//   비용·남용 방지: 오디오 크기 상한 + IP 레이트리밋.
//   환경변수(서버 전용): OPENAI_API_KEY, OPENAI_STT_MODEL(기본 gpt-4o-mini-transcribe).

export const runtime = "nodejs";
export const maxDuration = 30;

const OPENAI_STT_URL = "https://api.openai.com/v1/audio/transcriptions";
const MAX_AUDIO_BYTES = 10 * 1024 * 1024; // 10MB (약 30초 음성 충분)

export async function POST(req: Request) {
  const apiKey = process.env.OPENAI_API_KEY;
  const model = process.env.OPENAI_STT_MODEL || "gpt-4o-mini-transcribe";
  if (!apiKey) {
    return NextResponse.json({ ok: false, reason: "openai_not_configured" }, { status: 503 });
  }

  // 오디오는 텍스트보다 비싸다 — 분당 호출을 더 보수적으로 제한.
  const allowed = await checkRateLimit(clientIp(req), 12, 60);
  if (!allowed) {
    return NextResponse.json({ ok: false, reason: "rate_limited" }, { status: 429 });
  }

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ ok: false, reason: "bad_form" }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof Blob) || file.size === 0) {
    return NextResponse.json({ ok: false, reason: "no_audio" }, { status: 400 });
  }
  if (file.size > MAX_AUDIO_BYTES) {
    return NextResponse.json({ ok: false, reason: "audio_too_large" }, { status: 413 });
  }

  const upstream = new FormData();
  upstream.append("file", file, "speech.webm");
  upstream.append("model", model);
  upstream.append("language", "ko"); // 한국어 고정 — 인식 정확도·지연 개선

  try {
    const res = await fetch(OPENAI_STT_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: upstream,
    });
    const json = (await res.json().catch(() => null)) as
      | { text?: string; error?: { message?: string } }
      | null;
    if (!res.ok || !json) {
      console.error("[assistant/stt] OpenAI 오류:", json?.error?.message ?? res.status);
      return NextResponse.json({ ok: false, reason: "stt_error" }, { status: 502 });
    }
    const text = (json.text ?? "").trim();
    if (!text) return NextResponse.json({ ok: false, reason: "empty_transcript" }, { status: 422 });
    return NextResponse.json({ ok: true, text });
  } catch (error) {
    console.error("[assistant/stt] 처리 실패:", error);
    return NextResponse.json({ ok: false, reason: "stt_failed" }, { status: 500 });
  }
}

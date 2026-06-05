import { NextResponse } from "next/server";
import { buildCustomerSystemPrompt } from "@/lib/assistant/knowledge";
import { clientIp, checkRateLimit } from "@/lib/assistant/ratelimit";
import { PRODUCTS } from "@/lib/products";

// 고객 안내 도우미 + '담기 보조'. 기존 /api/assistant(FAQ 전용)에 더해,
//   사용자가 특정 제품을 담아달라고 하면 add 배열로 의도를 돌려준다(결제는 절대 안 함).
//   실제 장바구니 반영·결제는 클라이언트에서 사용자가 확인 후 진행한다.
//   환경변수(서버 전용): OPENAI_API_KEY, OPENAI_MODEL(기본 gpt-5.4-mini).

export const runtime = "nodejs";
export const maxDuration = 20;

const OPENAI_URL = "https://api.openai.com/v1/chat/completions";
const MAX_HISTORY = 8;
const MAX_MSG_LEN = 500;
const MAX_QTY = 20; // 음성 오인식·과도 담기 방지 상한

type ChatMessage = { role: "user" | "assistant" | "system"; content: string };
type AddItem = { productId: string; qty: number };

const VALID_IDS = new Set(PRODUCTS.map((p) => p.id));

// 모델 출력에서 유효한 담기 항목만 추린다(허용 제품 + 수량 1~MAX_QTY).
function sanitizeAdd(raw: unknown): AddItem[] {
  if (!Array.isArray(raw)) return [];
  const merged = new Map<string, number>();
  for (const it of raw) {
    if (!it || typeof it !== "object") continue;
    const pid = (it as { productId?: unknown }).productId;
    const qtyRaw = (it as { qty?: unknown }).qty;
    if (typeof pid !== "string" || !VALID_IDS.has(pid)) continue;
    const qty = Math.floor(Number(qtyRaw));
    if (!Number.isFinite(qty) || qty <= 0) continue;
    merged.set(pid, Math.min(MAX_QTY, (merged.get(pid) ?? 0) + qty));
  }
  return [...merged.entries()].map(([productId, qty]) => ({ productId, qty }));
}

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

  const allowed = await checkRateLimit(clientIp(req), 20, 60);
  if (!allowed) {
    return NextResponse.json({ ok: false, reason: "rate_limited" }, { status: 429 });
  }

  const catalog = PRODUCTS.map((p) => `${p.id} = ${p.name} ${p.volume}`).join(", ");
  const orderRule = [
    "",
    "[담기 보조 — 중요]",
    `구매 가능한 제품 id: ${catalog}.`,
    "사용자가 특정 제품을 '담아줘/추가/주문/장바구니' 등으로 담길 원하면, add 배열에 {productId, qty}로 넣으세요(정기구독 장바구니에 담깁니다).",
    "추천만 원하거나 제품·수량이 모호하면 add는 비우고 reply로 한 번 더 물어보거나 권해주세요.",
    "절대 결제를 진행하거나 결제된 것처럼 말하지 마세요. 담기까지만 도우며, 요일·기간·결제는 사용자가 장바구니/결제 화면에서 직접 확인합니다.",
    "응답은 반드시 아래 JSON 형식 하나로만 답하세요(다른 텍스트 금지):",
    '{"reply":"한국어 답변(담았으면 무엇을 담았는지 안내, 요일·기간은 장바구니에서 변경 가능하다고 덧붙임)","add":[{"productId":"milk-750","qty":2}]}',
    "담을 게 없으면 add는 빈 배열 []로 두세요.",
  ].join("\n");

  const messages: ChatMessage[] = [
    { role: "system", content: buildCustomerSystemPrompt() + "\n" + orderRule },
    ...cleanHistory,
  ];

  try {
    const res = await fetch(OPENAI_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, messages, response_format: { type: "json_object" } }),
    });
    const json = (await res.json().catch(() => null)) as {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
    } | null;
    if (!res.ok || !json) {
      console.error("[assistant/order] OpenAI 오류:", json?.error?.message ?? res.status);
      return NextResponse.json({ ok: false, reason: "openai_error" }, { status: 502 });
    }
    const content = json.choices?.[0]?.message?.content ?? "";
    let reply = "";
    let add: AddItem[] = [];
    try {
      const parsed = JSON.parse(content) as { reply?: unknown; add?: unknown };
      reply = typeof parsed.reply === "string" ? parsed.reply : "";
      add = sanitizeAdd(parsed.add);
    } catch {
      // JSON 파싱 실패 시: 담기 없이 원문을 그대로 답으로 사용.
      reply = content;
    }
    if (!reply) return NextResponse.json({ ok: false, reason: "no_reply" }, { status: 502 });
    return NextResponse.json({ ok: true, reply, add });
  } catch (error) {
    console.error("[assistant/order] 처리 실패:", error);
    return NextResponse.json({ ok: false, reason: "assistant_failed" }, { status: 500 });
  }
}

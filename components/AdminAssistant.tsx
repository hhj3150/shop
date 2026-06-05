"use client";

// 관리자 AI 비서 — 자연어로 묻고(오늘 배송지/생산량/매출 등) 즉답을 받는 채팅 패널.
//   서버 라우트(/api/admin/assistant)가 관리자 인증 + 읽기 전용 도구로 실제 데이터를 조회해 답한다.
import { useRef, useState } from "react";
import { getSupabase } from "@/lib/supabase";

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = [
  "오늘 배송지 명단",
  "오늘 생산량",
  "이번 주 매출",
  "요일별 모집현황",
  "입금대기 주문",
];

export function AdminAssistant() {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function send(text: string) {
    const q = text.trim();
    if (!q || loading) return;
    setError(null);
    const next: Msg[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const { data } = await getSupabase().auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setError("로그인이 필요합니다.");
        setLoading(false);
        return;
      }
      const res = await fetch("/api/admin/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ messages: next }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: boolean; reply?: string; reason?: string; detail?: string }
        | null;
      if (!json?.ok || !json.reply) {
        setError(
          json?.reason === "openai_not_configured"
            ? "OpenAI 키가 설정되지 않았습니다(관리자 환경변수 확인)."
            : json?.detail || json?.reason || "응답을 받지 못했습니다."
        );
      } else {
        setMessages((m) => [...m, { role: "assistant", content: json.reply as string }]);
      }
    } catch {
      setError("네트워크 오류가 발생했습니다.");
    } finally {
      setLoading(false);
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
      });
    }
  }

  return (
    <div className="rounded-2xl border border-gold/40 bg-gold/5 p-5">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
        <h2 className="font-serif-kr text-lg text-ink">AI 비서</h2>
        <span className="text-[12px] text-mute">읽기 전용 · 데이터 기반 즉답</span>
      </div>

      <div
        ref={scrollRef}
        className="mt-4 max-h-[360px] space-y-3 overflow-y-auto"
        aria-live="polite"
      >
        {messages.length === 0 ? (
          <p className="text-[13px] leading-relaxed text-ink-soft">
            오늘 배송지·생산량, 이번 주 매출, 주문 조회 등을 물어보세요. 예) “오늘 배송지 명단 보여줘”
          </p>
        ) : (
          messages.map((m, i) => (
            <div
              key={i}
              className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}
            >
              <div
                className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[14px] leading-relaxed ${
                  m.role === "user"
                    ? "bg-ink text-cream"
                    : "border border-line bg-cream text-ink"
                }`}
              >
                {m.content}
              </div>
            </div>
          ))
        )}
        {loading && (
          <div className="flex justify-start">
            <div className="rounded-2xl border border-line bg-cream px-3.5 py-2 text-[14px] text-mute">
              생각 중…
            </div>
          </div>
        )}
      </div>

      {error && <p className="mt-2 text-[13px] text-red-600">{error}</p>}

      <div className="mt-3 flex flex-wrap gap-1.5">
        {SUGGESTIONS.map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => send(s)}
            disabled={loading}
            className="rounded-full border border-line px-3 py-1 text-[12.5px] text-ink-soft transition-colors hover:border-gold hover:text-gold-deep disabled:opacity-50"
          >
            {s}
          </button>
        ))}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(input);
        }}
        className="mt-3 flex gap-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="무엇이든 물어보세요"
          className="flex-1 rounded-xl border border-line bg-cream px-3 py-2 text-[14px] text-ink"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="rounded-xl bg-ink px-4 py-2 text-[14px] text-cream transition-colors hover:bg-gold-deep disabled:opacity-50"
        >
          보내기
        </button>
      </form>
    </div>
  );
}

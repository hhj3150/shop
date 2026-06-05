"use client";

// 관리자 AI 비서(플로팅) — 어느 관리자 탭에서든 우하단 버튼으로 열어 질문.
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
  const [open, setOpen] = useState(false);
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
      requestAnimationFrame(() => scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight }));
    }
  }

  return (
    <>
      {/* 플로팅 버튼 — 모든 관리자 탭에서 우하단 고정 */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="AI 비서 열기"
          className="fixed bottom-[84px] right-5 z-50 flex h-14 items-center gap-2 rounded-full bg-ink px-5 text-cream shadow-xl transition-transform hover:scale-105 active:scale-95 md:bottom-6 md:right-6 no-print"
        >
          <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400" aria-hidden />
          <span className="text-[14px] font-medium">AI 비서</span>
        </button>
      )}

      {/* 채팅 패널 */}
      {open && (
        <div className="fixed bottom-[84px] right-5 z-50 flex h-[min(560px,72vh)] w-[min(400px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-line bg-cream shadow-2xl md:bottom-6 md:right-6 no-print">
          <div className="flex items-center justify-between border-b border-line bg-ink px-4 py-3 text-cream">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-2 w-2 rounded-full bg-emerald-400" aria-hidden />
              <div>
                <p className="text-[14px] font-medium">AI 비서</p>
                <p className="text-[11px] text-cream/60">읽기 전용 · 데이터 기반 즉답</p>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              aria-label="닫기"
              className="-mr-1 flex h-9 w-9 items-center justify-center text-cream/80 hover:text-cream"
            >
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
            {messages.length === 0 ? (
              <p className="text-[13px] leading-relaxed text-ink-soft">
                오늘 배송지·생산량, 이번 주 매출, 주문 조회 등을 물어보세요. 예) “오늘 배송지 명단”
              </p>
            ) : (
              messages.map((m, i) => (
                <div key={i} className={`flex ${m.role === "user" ? "justify-end" : "justify-start"}`}>
                  <div
                    className={`max-w-[85%] whitespace-pre-wrap rounded-2xl px-3.5 py-2 text-[14px] leading-relaxed ${
                      m.role === "user" ? "bg-ink text-cream" : "border border-line bg-white text-ink"
                    }`}
                  >
                    {m.content}
                  </div>
                </div>
              ))
            )}
            {loading && (
              <div className="flex justify-start">
                <div className="rounded-2xl border border-line bg-white px-3.5 py-2 text-[14px] text-mute">생각 중…</div>
              </div>
            )}
            {error && <p className="text-[13px] text-red-600">{error}</p>}
          </div>

          {messages.length === 0 && (
            <div className="flex flex-wrap gap-1.5 px-4 pb-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  disabled={loading}
                  className="rounded-full border border-line px-3 py-1 text-[12px] text-ink-soft transition-colors hover:border-gold hover:text-gold-deep disabled:opacity-50"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex gap-2 border-t border-line px-3 py-3"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="무엇이든 물어보세요"
              className="flex-1 rounded-xl border border-line bg-white px-3 py-2 text-[14px] text-ink"
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
      )}
    </>
  );
}

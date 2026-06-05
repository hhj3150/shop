"use client";

// 고객응대 AI 위젯(FAQ·안내 전용). 우하단 플로팅 버튼 → 채팅 패널.
//   개별 주문/환불은 다루지 않고 고객센터로 안내한다(서버 가드레일). 관리자 화면에선 숨김.
import { useRef, useState } from "react";
import { usePathname } from "next/navigation";

type Msg = { role: "user" | "assistant"; content: string };

const SUGGESTIONS = ["정기구독 어떻게 신청하나요?", "배송은 언제 시작되나요?", "교환·환불 되나요?"];

export function CustomerAssistant() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  // 관리자 화면에선 노출하지 않는다(관리자 전용 AI 비서가 따로 있음).
  if (pathname?.startsWith("/admin")) return null;

  async function send(text: string) {
    const q = text.trim();
    if (!q || loading) return;
    setError(null);
    const next: Msg[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: boolean; reply?: string; reason?: string }
        | null;
      if (!json?.ok || !json.reply) {
        setError(
          json?.reason === "openai_not_configured"
            ? "지금은 자동응답을 준비 중입니다. 고객센터로 문의해 주세요."
            : "잠시 후 다시 시도해 주세요. (고객센터 031-674-3150)"
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
      {/* 플로팅 버튼 */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="도움말 채팅 열기"
          className="fixed bottom-[84px] right-5 z-40 flex h-14 w-14 items-center justify-center rounded-full bg-ink text-cream shadow-xl transition-transform hover:scale-105 active:scale-95 md:bottom-6 md:right-6"
        >
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
            <path
              d="M21 11.5a8.38 8.38 0 0 1-8.5 8.5 8.5 8.5 0 0 1-3.8-.9L3 21l1.9-5.7a8.5 8.5 0 0 1-.9-3.8 8.38 8.38 0 0 1 8.5-8.5 8.38 8.38 0 0 1 8.5 8.5z"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </svg>
        </button>
      )}

      {/* 채팅 패널 */}
      {open && (
        <div className="fixed bottom-[84px] right-5 z-40 flex h-[min(560px,72vh)] w-[min(380px,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl border border-line bg-cream shadow-2xl md:bottom-6 md:right-6">
          <div className="flex items-center justify-between border-b border-line bg-ink px-4 py-3 text-cream">
            <div>
              <p className="text-[14px] font-medium">송영신목장 도우미</p>
              <p className="text-[11px] text-cream/60">AI 자동응답 · 개별 문의는 고객센터</p>
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
                안녕하세요! 정기구독·배송·결제 등 궁금한 점을 물어봐 주세요. 개별 주문·환불은 고객센터(031-674-3150)로 안내드립니다.
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
                <div className="rounded-2xl border border-line bg-white px-3.5 py-2 text-[14px] text-mute">…</div>
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
              maxLength={500}
              placeholder="메시지를 입력하세요"
              className="flex-1 rounded-xl border border-line bg-white px-3 py-2 text-[14px] text-ink"
            />
            <button
              type="submit"
              disabled={loading || !input.trim()}
              className="rounded-xl bg-ink px-4 py-2 text-[14px] text-cream transition-colors hover:bg-gold-deep disabled:opacity-50"
            >
              전송
            </button>
          </form>
        </div>
      )}
    </>
  );
}

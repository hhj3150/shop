"use client";

// 고객응대 AI 위젯(FAQ·안내 전용). 우하단 플로팅 버튼 → 채팅 패널.
//   개별 주문/환불은 다루지 않고 고객센터로 안내한다(서버 가드레일). 관리자 화면에선 숨김.
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { useCart } from "@/lib/cart";
import { useVoiceInput } from "@/lib/useVoiceInput";
import { speak, stopSpeaking } from "@/lib/speech";

type Msg = { role: "user" | "assistant"; content: string };
type AddItem = { productId: string; qty: number };
// 음성/채팅으로 담을 때 기본 배송 요일. 요일·기간은 장바구니/결제에서 변경 가능.
const DEFAULT_DELIVERY_DAY = "mon" as const;

const SUGGESTIONS = [
  "A2 우유가 뭔가요?",
  "저지 우유는 뭐가 좋아요?",
  "누구에게 좋나요?",
  "정기구독 어떻게 신청하나요?",
];

export function CustomerAssistant() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showNudge, setShowNudge] = useState(false);
  // 넛지를 첫 페인트에 띄우지 않는다 — 첫 화면을 제품만으로 채우기 위해, 사용자가
  //   첫 화면의 60%를 스크롤하거나 6초가 지난 뒤(먼저 도달하는 쪽)에만 등장시킨다.
  const [nudgeReady, setNudgeReady] = useState(false);
  // 음성 답변 on/off. 음성으로 물으면 자동으로 켜진다(음성 질문 → 음성 답변).
  const [voiceOut, setVoiceOut] = useState(false);
  // 담기 보조로 장바구니에 항목을 담았으면 '주문하러 가기' CTA를 띄운다.
  const [addedToCart, setAddedToCart] = useState(false);
  const { add: addToCart, open: openCart } = useCart();
  const scrollRef = useRef<HTMLDivElement>(null);

  const voice = useVoiceInput({
    onTranscript: (text) => {
      setVoiceOut(true);
      void send(text, { speak: true });
    },
    onError: (msg) => setError(msg),
  });

  // 첫 방문(세션당 1회)에만 '물어보세요' 말풍선을 띄운다 — 매 페이지 따라다니지 않게.
  useEffect(() => {
    try {
      if (!sessionStorage.getItem("cs_nudge_seen")) setShowNudge(true);
    } catch {
      // 무시
    }
  }, []);

  // 넛지 등장 게이트: 첫 화면을 가리지 않도록, 첫 화면 60% 스크롤 또는 6초 경과 중
  //   먼저 도달하는 시점에만 노출한다. 둘 중 하나가 충족되면 리스너·타이머를 정리한다.
  useEffect(() => {
    if (!showNudge || nudgeReady) return;
    let done = false;
    const reveal = () => {
      if (done) return;
      done = true;
      setNudgeReady(true);
      window.removeEventListener("scroll", onScroll);
      clearTimeout(timer);
    };
    const onScroll = () => {
      if (window.scrollY > window.innerHeight * 0.6) reveal();
    };
    const timer = setTimeout(reveal, 6000);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.removeEventListener("scroll", onScroll);
      clearTimeout(timer);
    };
  }, [showNudge, nudgeReady]);

  function dismissNudge() {
    setShowNudge(false);
    try {
      sessionStorage.setItem("cs_nudge_seen", "1");
    } catch {
      // 무시
    }
  }

  // 관리자 화면에선 노출하지 않는다(관리자 전용 AI 비서가 따로 있음).
  if (pathname?.startsWith("/admin")) return null;

  async function send(text: string, opts?: { speak?: boolean }) {
    const q = text.trim();
    if (!q || loading) return;
    setError(null);
    const next: Msg[] = [...messages, { role: "user", content: q }];
    setMessages(next);
    setInput("");
    setLoading(true);
    try {
      const res = await fetch("/api/assistant/order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ messages: next }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: boolean; reply?: string; reason?: string; add?: AddItem[] }
        | null;
      if (!json?.ok || !json.reply) {
        setError(
          json?.reason === "openai_not_configured"
            ? "지금은 자동응답을 준비 중입니다. 고객센터로 문의해 주세요."
            : json?.reason === "rate_limited"
            ? "잠시 문의가 많습니다. 잠깐 후 다시 시도해 주세요. (급한 문의는 031-674-3150)"
            : "잠시 후 다시 시도해 주세요. (고객센터 031-674-3150)"
        );
      } else {
        const reply = json.reply as string;
        setMessages((m) => [...m, { role: "assistant", content: reply }]);
        // 담기 보조: 모델이 담을 항목을 돌려주면 정기구독 장바구니에 반영(결제는 안 함).
        const toAdd = Array.isArray(json.add) ? json.add : [];
        if (toAdd.length > 0) {
          toAdd.forEach((it) =>
            addToCart({ productId: it.productId, deliveryDay: DEFAULT_DELIVERY_DAY, qty: it.qty })
          );
          setAddedToCart(true);
        }
        // 음성으로 물었으면(speak=true) 또는 음성답변이 켜져 있으면 읽어준다.
        if (opts?.speak ?? voiceOut) {
          speak(reply).catch(() => {
            // 음성은 보조 — 실패해도 텍스트 답변은 그대로 유지.
          });
        }
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
      {/* 첫 방문 넛지 말풍선 — 무엇이든 물어보세요 (첫 화면을 가리지 않도록 지연 등장) */}
      {!open && showNudge && nudgeReady && (
        <div className="fixed bottom-[150px] right-5 z-40 flex max-w-[240px] items-start gap-2 rounded-2xl border border-line bg-cream px-4 py-3 shadow-xl animate-[rise_0.5s_var(--ease-soft)_both] md:bottom-[88px] md:right-6 no-print">
          <p className="text-[13px] leading-snug text-ink">
            궁금한 점, <span className="font-medium text-gold-deep">무엇이든 물어보세요</span> — A2·저지·헤이밀크 같은 제품 이야기부터 추천·구독·배송까지 바로 답해 드려요.
          </p>
          <button
            type="button"
            onClick={dismissNudge}
            aria-label="안내 닫기"
            className="-mr-1 -mt-1 shrink-0 text-mute hover:text-ink"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
      )}

      {/* 플로팅 버튼 */}
      {!open && (
        <button
          type="button"
          onClick={() => {
            setOpen(true);
            dismissNudge();
          }}
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
              <p className="text-[11px] text-cream/60">제품 지식·추천·배송까지 · 개별 문의는 고객센터</p>
            </div>
            <div className="flex items-center gap-1">
              <button
                onClick={() => {
                  setVoiceOut((v) => {
                    if (v) stopSpeaking(); // 끄면 재생 중인 음성도 멈춤
                    return !v;
                  });
                }}
                aria-label={voiceOut ? "음성 답변 끄기" : "음성 답변 켜기"}
                aria-pressed={voiceOut}
                className={`flex h-9 w-9 items-center justify-center rounded-full transition-colors ${
                  voiceOut ? "text-gold" : "text-cream/60 hover:text-cream"
                }`}
              >
                {voiceOut ? (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                    <path d="M11 5L6 9H2v6h4l5 4V5z" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" strokeLinecap="round" />
                  </svg>
                ) : (
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                    <path d="M11 5L6 9H2v6h4l5 4V5z" strokeLinecap="round" strokeLinejoin="round" />
                    <path d="M22 9l-6 6M16 9l6 6" strokeLinecap="round" />
                  </svg>
                )}
              </button>
              <button
                onClick={() => {
                  stopSpeaking();
                  setOpen(false);
                }}
                aria-label="닫기"
                className="-mr-1 flex h-9 w-9 items-center justify-center text-cream/80 hover:text-cream"
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </button>
            </div>
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4" aria-live="polite">
            {messages.length === 0 ? (
              <p className="text-[13px] leading-relaxed text-ink-soft">
                안녕하세요! A2 우유·저지·헤이밀크·요거트 같은 제품 이야기와 추천부터 정기구독·배송·결제까지, 궁금한 점을 무엇이든 물어봐 주세요. (예: "A2 우유가 뭔가요?", "저지 우유 특징은?", "누구에게 좋나요?") 개별 주문·환불은 고객센터(031-674-3150)로 안내드립니다.
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

          {addedToCart && (
            <div className="px-4 pb-2">
              <button
                type="button"
                onClick={() => {
                  stopSpeaking();
                  setOpen(false);
                  openCart();
                }}
                className="flex w-full items-center justify-center gap-1.5 rounded-xl bg-gold-deep px-4 py-2.5 text-[13px] font-medium text-cream transition-colors hover:bg-ink"
              >
                장바구니에서 확인하고 주문하기 →
              </button>
              <p className="mt-1 text-center text-[11px] text-mute">
                요일·기간·결제는 다음 화면에서 직접 확인하세요.
              </p>
            </div>
          )}

          {voice.supported && (voice.recording || voice.transcribing) && (
            <p className="px-4 pb-1 text-[12px] text-gold-deep" aria-live="polite">
              {voice.recording ? "듣고 있어요… 손을 떼면 전송돼요" : "인식 중…"}
            </p>
          )}

          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex gap-2 border-t border-line px-3 py-3"
          >
            {voice.supported && (
              <button
                type="button"
                onPointerDown={(e) => {
                  e.preventDefault();
                  void voice.start();
                }}
                onPointerUp={(e) => {
                  e.preventDefault();
                  voice.stop();
                }}
                onPointerLeave={() => {
                  if (voice.recording) voice.stop();
                }}
                disabled={loading || voice.transcribing}
                aria-label="누르고 말하기"
                aria-pressed={voice.recording}
                title="누르고 있는 동안 말하기"
                style={{ touchAction: "none" }}
                className={`flex h-10 w-10 shrink-0 select-none items-center justify-center rounded-xl border transition-colors disabled:opacity-50 ${
                  voice.recording
                    ? "border-red-400 bg-red-50 text-red-600"
                    : "border-line bg-white text-ink-soft hover:border-gold hover:text-gold-deep"
                }`}
              >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">
                  <rect x="9" y="3" width="6" height="11" rx="3" />
                  <path d="M5 11a7 7 0 0 0 14 0M12 18v3" strokeLinecap="round" />
                </svg>
              </button>
            )}
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              maxLength={500}
              placeholder={voice.recording ? "듣고 있어요…" : "메시지를 입력하세요"}
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

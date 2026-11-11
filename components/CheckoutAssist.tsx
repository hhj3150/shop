"use client";

// 주문 양식(정기구독 결제 · 1회 구매)이 함께 쓰는 보조 도구.
//   주문·결제 로직은 여기 없다 — 어느 칸이 틀렸는지 짚어 주고, 합계와 제출 버튼을
//   손 닿는 곳에 두는 일만 한다.
import { useCallback, useEffect, useRef, useState } from "react";
import { formatKRW } from "@/lib/products";

// ── 칸 오류 ──────────────────────────────────────────────────────────────
//   예전에는 모든 검증 오류가 양식 맨 아래 빨간 상자 하나로 모였다. 연락처 자릿수가
//   틀려도 문구는 화면 두 장 아래에 뜨고, 손님은 어느 칸인지 찾아 올라가야 했다.
//   틀린 칸으로 데려가 그 칸 바로 아래에 말한다.
export function useFieldError() {
  const [fieldErr, setFieldErr] = useState<{ id: string; msg: string } | null>(null);

  const failField = useCallback((id: string, msg: string) => {
    setFieldErr({ id, msg });
    window.requestAnimationFrame(() => {
      const el = document.getElementById(id);
      el?.scrollIntoView({ behavior: "smooth", block: "center" });
      el?.focus({ preventScroll: true });
    });
  }, []);

  // 그 칸을 고치기 시작하면 오류를 거둔다(고쳤는데도 빨간 채로 남지 않게).
  const clearField = useCallback((id: string) => {
    setFieldErr((prev) => (prev?.id === id ? null : prev));
  }, []);
  const clearAll = useCallback(() => setFieldErr(null), []);

  const errorFor = (id: string) => (fieldErr?.id === id ? fieldErr.msg : undefined);
  return { failField, clearField, clearAll, errorFor };
}

// 칸에 속하지 않는 오류(서버 거절 등)는 상자가 뜨는 순간 화면 안으로 데려온다.
//   하단 고정 바에서 제출하면 상자가 화면 밖 아래에 떠서 '눌렀는데 아무 일도 없는' 것처럼 보인다.
export function useRevealOnError(error: string | null) {
  const ref = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (error) ref.current?.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [error]);
  return ref;
}

// ── 모바일 하단 제출 바 ──────────────────────────────────────────────────
//   양식이 화면 세 장 길이라, 합계는 맨 위에만 있고 제출 버튼은 맨 아래에만 있었다.
//   입력하는 내내 '얼마를 내는지'와 '끝내는 버튼'이 보이게 한다.
//   · 버튼은 form 속성으로 원래 양식을 그대로 제출한다 — 검증·주문 생성 경로가 하나다.
//   · 원래 제출 버튼이 화면에 보이면 숨는다(같은 버튼 두 벌 금지).
//   · 이 화면에서는 전역 하단 탭바가 물러난다(BottomNav) — 고정 요소는 한 겹만.
export function StickySubmitBar({
  formId,
  watchId,
  caption,
  amount,
  label,
  disabled,
}: {
  formId: string;
  watchId: string; // 원래 제출 버튼의 id
  caption: string;
  amount: number;
  label: string;
  disabled?: boolean;
}) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const target = document.getElementById(watchId);
    if (!target || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setShow(!e.isIntersecting), {
      rootMargin: "0px 0px -72px 0px",
    });
    io.observe(target);
    return () => io.disconnect();
  }, [watchId]);

  // 바가 떠 있는 동안 채팅 버튼이 겹치지 않게 알린다(제품 상세의 구매 바와 같은 신호).
  useEffect(() => {
    window.dispatchEvent(new CustomEvent("shop:addbar", { detail: show }));
    return () => {
      window.dispatchEvent(new CustomEvent("shop:addbar", { detail: false }));
    };
  }, [show]);

  return (
    <div
      aria-hidden={!show}
      className={`material-chrome fixed inset-x-0 bottom-0 z-30 border-t border-line/70 px-5 pt-2.5 pb-[calc(env(safe-area-inset-bottom)+0.625rem)] transition-[transform,opacity] duration-300 ease-[var(--ease-soft)] md:hidden no-print ${
        show ? "translate-y-0 opacity-100" : "pointer-events-none translate-y-full opacity-0"
      }`}
    >
      <div className="mx-auto flex max-w-2xl items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="t-caption truncate text-mute">{caption}</p>
          <p className="font-serif-kr text-lg leading-tight text-ink tabular-nums">{formatKRW(amount)}</p>
        </div>
        <button
          type="submit"
          form={formId}
          tabIndex={show ? 0 : -1}
          disabled={disabled}
          className="t-footnote min-h-11 shrink-0 rounded-full bg-ink px-6 font-medium tracking-wide text-cream transition-colors hover:bg-gold-deep active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {label}
        </button>
      </div>
    </div>
  );
}

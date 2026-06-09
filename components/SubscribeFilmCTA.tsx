"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { BRAND_FILM_ID, buildFilmEmbedUrl } from "@/lib/brand-film";
import { useAuth } from "@/lib/auth";

// 히어로의 "정기구독 신청하기" 버튼. 클릭하면 브랜드 필름이 반복 재생되는
// 모달을 열고, 모달 안의 CTA로 실제 신청 흐름을 이어준다.
//   - 비회원: 가입(/signup)으로.
//   - 이미 로그인한 회원: 가입을 건너뛰고 제품 선택(/#products)으로 바로 안내한다.
export function SubscribeFilmCTA({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  const { ready, user } = useAuth();
  const isMember = ready && !!user;
  const ctaHref = isMember ? "/#products" : "/signup";
  const ctaLabel = isMember ? "구독할 제품 고르기 →" : "정기구독 신청하기 →";

  // 모달 열림 동안 Esc 닫기 + 바디 스크롤 잠금.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={className}>
        정기구독 신청하기
      </button>

      {open && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="송영신목장 브랜드 필름"
          onClick={() => setOpen(false)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink/80 p-4 backdrop-blur-sm"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-3xl"
          >
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="필름 닫기"
              className="absolute -top-10 right-0 text-[13px] tracking-wide text-cream/80 transition-colors hover:text-cream"
            >
              닫기 ✕
            </button>

            <div className="aspect-video w-full overflow-hidden rounded-2xl bg-black shadow-2xl">
              <iframe
                src={buildFilmEmbedUrl(BRAND_FILM_ID)}
                title="송영신목장 A2 저지 헤이밀크 브랜드 필름"
                allow="autoplay; encrypted-media; fullscreen; picture-in-picture"
                allowFullScreen
                className="h-full w-full"
              />
            </div>

            <div className="mt-4 flex justify-center">
              <Link
                href={ctaHref}
                className="rounded-full bg-cream px-9 py-4 text-center text-sm font-medium tracking-wide text-ink transition-transform duration-300 ease-[var(--ease-soft)] hover:scale-[1.02] active:scale-[0.98]"
              >
                {ctaLabel}
              </Link>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

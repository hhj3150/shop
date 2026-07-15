"use client";

// 찜하기 토글 — 상품 상세의 ♡ 버튼. 비로그인은 로그인으로 안내(next=현재 상품).
//   낙관적 토글: 즉시 UI 반영 후 저장 실패 시 원복(네트워크 순간 오류에 강하게).
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { addWish, isWished, removeWish } from "@/lib/wishlist";

export function WishlistButton({ productId }: { productId: string }) {
  const router = useRouter();
  const { user } = useAuth();
  const [wished, setWished] = useState(false);

  useEffect(() => {
    if (!user) {
      setWished(false);
      return;
    }
    let alive = true;
    isWished(user.id, productId)
      .then((w) => {
        if (alive) setWished(w);
      })
      .catch(() => {
        // 조회 실패는 하트만 비활성 표시(토글 시 재시도).
      });
    return () => {
      alive = false;
    };
  }, [user, productId]);

  async function toggle() {
    if (!user) {
      router.push(`/login?next=/products/${productId}`);
      return;
    }
    const next = !wished;
    setWished(next); // 낙관적 반영
    try {
      if (next) await addWish(user.id, productId);
      else await removeWish(user.id, productId);
    } catch {
      setWished(!next); // 저장 실패 → 원복
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={wished}
      className={`inline-flex items-center gap-1.5 text-[13px] transition-colors ${
        wished ? "text-gold-deep" : "text-mute hover:text-ink"
      }`}
    >
      <svg
        width="15"
        height="15"
        viewBox="0 0 24 24"
        fill={wished ? "currentColor" : "none"}
        stroke="currentColor"
        strokeWidth="1.8"
        aria-hidden
      >
        <path
          d="M12 21s-6.7-4.35-9.33-8.11C.9 10.35 1.7 6.6 4.9 5.3c2-.8 4.3-.2 5.6 1.4l1.5 1.8 1.5-1.8c1.3-1.6 3.6-2.2 5.6-1.4 3.2 1.3 4 5.05 2.23 7.59C18.7 16.65 12 21 12 21Z"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
      {wished ? "찜함" : "찜하기"}
    </button>
  );
}

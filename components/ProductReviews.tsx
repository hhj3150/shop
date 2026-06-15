"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import {
  fetchReviews,
  createReview,
  deleteReview,
  averageRating,
  maskName,
  formatReviewDate,
  type ReviewRow,
} from "@/lib/reviews";
import { Stars } from "./Stars";
import { Reveal } from "./Reveal";

export function ProductReviews({ productId }: { productId: string }) {
  const { user, profile } = useAuth();
  const isAdmin = profile?.is_admin === true;

  const [reviews, setReviews] = useState<ReviewRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setReviews(await fetchReviews(productId));
    } catch {
      // 후기 로드 실패는 화면을 막지 않는다.
    } finally {
      setLoaded(true);
    }
  }, [productId]);

  useEffect(() => {
    load();
  }, [load]);

  const avg = averageRating(reviews);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!user) return;
    if (!body.trim()) {
      setError("후기 내용을 입력해 주세요.");
      return;
    }
    setBusy(true);
    try {
      await createReview(user.id, productId, profile?.name ?? "회원", rating, body);
      setBody("");
      setRating(5);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "후기 등록에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  async function onDelete(id: string) {
    try {
      await deleteReview(id);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : "삭제에 실패했습니다.");
    }
  }

  return (
    <section className="mx-auto max-w-3xl px-5 py-20 sm:px-8">
      <Reveal>
        <p className="eyebrow text-gold-deep">Customer Reviews</p>
        <h2 className="mt-3 font-serif-kr text-xl font-medium text-ink">구매평</h2>
      </Reveal>

      {/* 평균 별점 요약 */}
      <div className="mt-6 flex items-center gap-4 rounded-2xl border border-line bg-cream p-5">
        <div className="text-center">
          <p className="font-serif-kr text-3xl tabular-nums text-ink">
            {reviews.length > 0 ? avg.toFixed(1) : "–"}
          </p>
          <p className="mt-0.5 text-[12px] text-mute">/ 5.0</p>
        </div>
        <div>
          <Stars value={avg} size={20} />
          <p className="mt-1 text-[13px] text-mute">
            후기 {reviews.length}개
          </p>
        </div>
      </div>

      {/* 작성 폼 */}
      {user ? (
        <form onSubmit={onSubmit} className="mt-6 rounded-2xl border border-line bg-paper p-5">
          <div className="flex items-center gap-3">
            <span className="text-[14px] text-ink-soft">별점</span>
            <Stars value={rating} onChange={setRating} size={24} />
            <span className="text-[14px] tabular-nums text-gold-deep">{rating}.0</span>
          </div>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={3}
            maxLength={1000}
            placeholder="제품에 대한 솔직한 후기를 남겨 주세요."
            className="mt-4 w-full resize-none rounded-xl border border-line bg-cream px-4 py-3 text-[16px] text-ink outline-none focus:border-gold"
          />
          {error && <p className="mt-2 text-[14px] text-red-700">{error}</p>}
          <button
            type="submit"
            disabled={busy || !body.trim()}
            className="mt-3 rounded-full bg-ink px-6 py-2.5 text-[14px] font-medium text-cream transition-colors hover:bg-gold-deep disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "등록 중…" : "후기 남기기"}
          </button>
        </form>
      ) : (
        <p className="mt-6 rounded-2xl border border-line bg-paper px-5 py-4 text-[14px] text-mute">
          후기는 회원만 작성할 수 있습니다.{" "}
          <Link href="/login" className="text-gold-deep underline-offset-4 hover:underline">
            로그인
          </Link>
          하고 별점과 후기를 남겨 주세요.
        </p>
      )}

      {/* 후기 목록 */}
      <ul className="mt-8 divide-y divide-line border-t border-line">
        {loaded && reviews.length === 0 && (
          <li className="flex flex-col items-center gap-3 py-12 text-center">
            <span className="flex h-12 w-12 items-center justify-center rounded-full bg-gold/10 text-gold-deep">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden>
                <path d="M12 4l2.3 4.9 5.2.7-3.8 3.6.9 5.2L12 16.6 7.4 18.4l.9-5.2-3.8-3.6 5.2-.7L12 4Z" strokeLinejoin="round" />
              </svg>
            </span>
            <p className="font-serif-kr text-[15px] text-ink-soft">첫 한 병의 후기를 기다립니다</p>
            <p className="max-w-xs text-[13px] leading-relaxed text-mute">
              받아보신 솔직한 한 마디가 다음 한 분의 선택에 큰 힘이 됩니다.
            </p>
          </li>
        )}
        {reviews.map((r) => (
          <li key={r.id} className="py-5">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Stars value={r.rating} size={15} />
                <span className="text-[14px] text-ink-soft">{maskName(r.author_name)}</span>
              </div>
              <span className="text-[13px] tabular-nums text-mute">
                {formatReviewDate(r.created_at)}
              </span>
            </div>
            <p className="mt-2 whitespace-pre-wrap text-[14px] leading-relaxed text-ink-soft">
              {r.body}
            </p>
            {(isAdmin || r.is_mine) && (
              <button
                type="button"
                onClick={() => onDelete(r.id)}
                className="mt-2 text-[13px] text-mute underline-offset-4 hover:text-red-700 hover:underline"
              >
                삭제
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}

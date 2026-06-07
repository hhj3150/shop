"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { getSupabase } from "@/lib/supabase";
import { toParagraphs, type NewsRow } from "@/lib/news";
import { Reveal } from "./Reveal";

const MAX_ITEMS = 4;

function dateLabel(iso: string): string {
  return new Date(iso).toLocaleDateString("ko-KR", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

// 한 소식 행 — 기본은 날짜+제목만, 클릭하면 그 자리에서 전체(사진/영상+본문) 펼침.
function NewsItem({ row }: { row: NewsRow }) {
  const [open, setOpen] = useState(false);
  const paragraphs = toParagraphs(row.body);

  return (
    <div className="border-b border-line">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-4 py-5 text-left transition-colors hover:bg-cream/40"
      >
        <span className="min-w-0">
          <span className="block text-[13px] text-mute">
            {dateLabel(row.created_at)}
            {row.youtube_id ? " · 영상" : ""}
          </span>
          <span className="mt-1 block font-serif-kr text-lg font-medium leading-snug text-ink">
            {row.title}
          </span>
        </span>
        <svg
          viewBox="0 0 24 24"
          aria-hidden="true"
          className={`h-5 w-5 shrink-0 text-gold-deep transition-transform duration-200 ${
            open ? "rotate-180" : ""
          }`}
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="pb-7">
          {row.youtube_id ? (
            <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-ink">
              <iframe
                src={`https://www.youtube.com/embed/${row.youtube_id}`}
                title={row.title}
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                allowFullScreen
                className="absolute inset-0 h-full w-full"
              />
            </div>
          ) : row.cover_url ? (
            <div className="relative aspect-[16/9] w-full overflow-hidden rounded-2xl bg-paper">
              <Image
                src={row.cover_url}
                alt={row.title}
                fill
                sizes="(max-width:768px) 92vw, 760px"
                className="object-cover"
              />
            </div>
          ) : null}

          <div className="mt-4 space-y-3 text-[14px] leading-loose text-ink-soft">
            {paragraphs.map((p, i) => (
              <p key={i} className="whitespace-pre-line">
                {p}
              </p>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

export function NewsBand() {
  const [rows, setRows] = useState<NewsRow[] | null>(null);

  useEffect(() => {
    let alive = true;
    getSupabase()
      .from("news")
      .select("*")
      .eq("published", true)
      .order("created_at", { ascending: false })
      .limit(MAX_ITEMS)
      .then(({ data }) => {
        if (alive) setRows((data as NewsRow[]) ?? []);
      });
    return () => {
      alive = false;
    };
  }, []);

  // 게시된 소식이 없으면 섹션을 노출하지 않는다.
  if (!rows || rows.length === 0) return null;

  return (
    <section id="news" className="mx-auto max-w-3xl px-5 py-20 sm:px-8 sm:py-24">
      <Reveal>
        <p className="eyebrow text-gold-deep">Farm Journal</p>
        <h2 className="mt-3 font-serif-kr text-[clamp(1.8rem,4vw,2.8rem)] font-medium leading-tight text-ink">
          목장 소식
        </h2>
        <p className="mt-4 text-[15px] leading-loose text-mute">
          제목을 누르면 전체 내용을 볼 수 있습니다.
        </p>
      </Reveal>

      <div className="mt-10 border-t border-line">
        {rows.map((r, i) => (
          <Reveal key={r.id} delay={(i % 4) * 70}>
            <NewsItem row={r} />
          </Reveal>
        ))}
      </div>
    </section>
  );
}

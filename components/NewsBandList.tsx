"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { toParagraphs, type NewsRow } from "@/lib/news";
import { newsDateLabel, newsPath, safeYoutubeId, youtubeEmbedUrl } from "@/lib/news-feed";
import { Reveal } from "./Reveal";

// /story '목장 소식' 띠의 화면(아코디언). 첫 목록은 서버가 넣어 준다(components/NewsBand) —
//   서버 HTML 에 제목·본문·고유 주소 링크가 들어가 JS 를 실행하지 않는 크롤러도 읽는다.
//   방문 시 한 번 더 읽어 최신으로 맞춘다(관리자가 방금 게시·게시 취소한 글이 바로 반영되게).

// 한 소식 행 — 기본은 날짜+제목만, 클릭하면 그 자리에서 전체(사진/영상+본문) 펼침.
//   본문과 고유 주소 링크는 접혀 있어도 DOM 에 둔다(hidden) — 검색 로봇은 누르지 않으므로,
//   펼칠 때만 그리면 링크를 발견하지 못한다. 사진·영상은 펼칠 때만 불러온다.
function NewsItem({ row }: { row: NewsRow }) {
  const [open, setOpen] = useState(false);
  const paragraphs = toParagraphs(row.body);
  const youtube = safeYoutubeId(row.youtube_id);
  const panelId = `news-panel-${row.id}`;

  return (
    <div className="border-b border-line">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-controls={panelId}
        className="flex w-full items-center justify-between gap-4 py-5 text-left transition-colors hover:bg-cream/40"
      >
        <span className="min-w-0">
          <span className="block text-[13px] text-mute">
            {newsDateLabel(row.created_at)}
            {youtube ? " · 영상" : ""}
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

      <div id={panelId} hidden={!open} className="pb-7">
        {open &&
          (youtube ? (
            <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-ink">
              <iframe
                src={youtubeEmbedUrl(youtube)}
                title={row.title}
                referrerPolicy="strict-origin-when-cross-origin"
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
          ) : null)}

        <div className="mt-4 space-y-3 text-[14px] leading-loose text-ink-soft">
          {paragraphs.map((p, i) => (
            <p key={i} className="whitespace-pre-line">
              {p}
            </p>
          ))}
        </div>

        <p className="mt-3">
          <Link
            href={newsPath(row.id)}
            className="t-footnote inline-flex min-h-11 items-center text-gold-deep underline underline-offset-4 hover:text-ink"
          >
            이 소식 따로 보기
          </Link>
        </p>
      </div>
    </div>
  );
}

export function NewsBandList({
  initialRows,
  maxItems,
}: {
  initialRows: NewsRow[];
  maxItems: number;
}) {
  const [rows, setRows] = useState<NewsRow[]>(initialRows);

  useEffect(() => {
    if (!isSupabaseConfigured) return;
    let alive = true;
    getSupabase()
      .from("news")
      .select("*")
      .eq("published", true)
      .order("created_at", { ascending: false })
      .limit(maxItems)
      .then(({ data, error }) => {
        // 실패하면 서버가 넣어 준 목록을 그대로 둔다.
        if (alive && !error && data) setRows(data as NewsRow[]);
      });
    return () => {
      alive = false;
    };
  }, [maxItems]);

  // 게시된 소식이 없으면 섹션을 노출하지 않는다.
  if (rows.length === 0) return null;

  return (
    <section id="news" className="mx-auto max-w-3xl px-5 py-20 sm:px-8 sm:py-28">
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

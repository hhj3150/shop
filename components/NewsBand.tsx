"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { getSupabase } from "@/lib/supabase";
import { toParagraphs, type NewsRow } from "@/lib/news";
import { Reveal } from "./Reveal";

const MAX_ITEMS = 4;

function NewsCard({ row }: { row: NewsRow }) {
  const [open, setOpen] = useState(false);
  const paragraphs = toParagraphs(row.body);
  const long = paragraphs.length > 2 || row.body.length > 220;
  const shown = open || !long ? paragraphs : paragraphs.slice(0, 2);

  return (
    <article className="overflow-hidden rounded-[28px] border border-line bg-cream">
      {row.youtube_id ? (
        <div className="relative aspect-video w-full bg-ink">
          <iframe
            src={`https://www.youtube.com/embed/${row.youtube_id}`}
            title={row.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
            className="absolute inset-0 h-full w-full"
          />
        </div>
      ) : row.cover_url ? (
        <div className="relative aspect-[16/9] w-full bg-paper">
          <Image
            src={row.cover_url}
            alt={row.title}
            fill
            sizes="(max-width:768px) 92vw, 600px"
            className="object-cover"
          />
        </div>
      ) : null}

      <div className="p-6 sm:p-7">
        <p className="text-[13px] text-mute">
          {new Date(row.created_at).toLocaleDateString("ko-KR", {
            year: "numeric",
            month: "long",
            day: "numeric",
          })}
        </p>
        <h3 className="mt-1.5 font-serif-kr text-lg font-medium leading-snug text-ink">
          {row.title}
        </h3>
        <div className="mt-3 space-y-3 text-[14px] leading-loose text-ink-soft">
          {shown.map((p, i) => (
            <p key={i} className="whitespace-pre-line">{p}</p>
          ))}
        </div>
        {long && (
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className="mt-3 text-[14px] text-gold-deep underline-offset-4 hover:underline"
          >
            {open ? "접기" : "더보기 →"}
          </button>
        )}
      </div>
    </article>
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
    <section id="news" className="mx-auto max-w-5xl px-5 py-20 sm:px-8 sm:py-24">
      <Reveal>
        <p className="eyebrow text-gold-deep">Farm Journal</p>
        <h2 className="mt-3 font-serif-kr text-[clamp(1.8rem,4vw,2.8rem)] font-medium leading-tight text-ink">
          목장 소식
        </h2>
        <p className="mt-4 text-[15px] leading-loose text-mute">
          송영신목장에서 전하는 소식과 이야기입니다.
        </p>
      </Reveal>

      <div className="mt-10 grid gap-6 sm:grid-cols-2">
        {rows.map((r, i) => (
          <Reveal key={r.id} delay={(i % 2) * 90}>
            <NewsCard row={r} />
          </Reveal>
        ))}
      </div>
    </section>
  );
}

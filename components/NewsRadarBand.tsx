"use client";

// 세계 낙농 소식(레이더) — A2·저지·헤이밀크·동물복지·저탄소 소식을 한글로 노출(고객용).
//   관리자가 '게시'한 글만 보인다(published=true). 게시본이 없으면 렌더하지 않는다.
//   펫 게이트: PET_CONTENT_ENABLED=false 면 펫 카테고리(category='pet')는 노출하지 않는다.
import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { PET_CONTENT_ENABLED } from "@/lib/news-radar-flags";

type RadarRow = {
  id: string;
  title_ko: string;
  summary_ko: string;
  source_name: string | null;
  source_url: string;
  topic: string | null;
  created_at: string;
};

export function NewsRadarBand() {
  const [items, setItems] = useState<RadarRow[]>([]);

  useEffect(() => {
    let query = getSupabase()
      .from("news_radar")
      .select("id,title_ko,summary_ko,source_name,source_url,topic,created_at")
      .eq("published", true);
    // 펫 게이트 off: 펫 카테고리는 고객 화면에 노출하지 않는다.
    if (!PET_CONTENT_ENABLED) query = query.neq("category", "pet");
    query
      .order("created_at", { ascending: false })
      .limit(3)
      .then(({ data }) => setItems((data as RadarRow[]) ?? []));
  }, []);

  if (items.length === 0) return null;
  const [lead, ...rest] = items;

  return (
    <section className="mx-auto max-w-5xl px-5 py-20 sm:px-8 sm:py-28">
      <p className="eyebrow text-gold-deep">World Dairy Radar</p>
      <h2 className="mt-3 font-serif-kr text-[clamp(1.6rem,4vw,2.4rem)] font-medium text-ink">
        세계 낙농 소식
      </h2>
      <p className="mt-2 text-[14px] text-mute">
        A2·저지·헤이밀크·동물복지·저탄소 낙농 — 매주 가장 의미 있는 소식 하나를 골라 한글로 전해 드립니다.
      </p>

      <a
        href={lead.source_url}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-6 block rounded-2xl border border-line bg-cream p-6 transition-colors hover:border-gold"
      >
        {lead.topic && (
          <span className="rounded-full bg-gold/10 px-2.5 py-0.5 text-[12px] text-gold-deep">{lead.topic}</span>
        )}
        <h3 className="mt-3 font-serif-kr text-lg leading-snug text-ink">{lead.title_ko}</h3>
        <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">{lead.summary_ko}</p>
        <p className="mt-3 text-[12.5px] text-mute">
          {lead.source_name ? `${lead.source_name} · ` : ""}원문 보기 →
        </p>
      </a>

      {rest.length > 0 && (
        <ul className="mt-4 divide-y divide-line border-t border-line">
          {rest.map((n) => (
            <li key={n.id}>
              <a
                href={n.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="block py-4 transition-colors hover:text-gold-deep"
              >
                <span className="text-[14px] text-ink">{n.title_ko}</span>
                {n.topic && <span className="ml-2 text-[12px] text-mute">· {n.topic}</span>}
              </a>
            </li>
          ))}
        </ul>
      )}

      {/* 면책 — 식품표시광고법(효능 표현) 안전. 출처는 각 항목에 표기. */}
      <p className="mt-6 text-[12px] leading-relaxed text-mute">
        ※ 외부 연구·언론 보도를 인용한 정보이며, 특정 질병의 예방·치료 효능을 단정하지 않습니다.
      </p>
    </section>
  );
}

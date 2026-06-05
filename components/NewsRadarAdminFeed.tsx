"use client";

// 관리자 업계 소식 피드 — 레이더가 주 1회 모은 소식 이력(최신순). 원문 링크로 확인.
import { useEffect, useState } from "react";
import { getSupabase } from "@/lib/supabase";

type RadarRow = {
  id: string;
  title_ko: string;
  summary_ko: string;
  source_name: string | null;
  source_url: string;
  topic: string | null;
  created_at: string;
};

export function NewsRadarAdminFeed() {
  const [items, setItems] = useState<RadarRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    getSupabase()
      .from("news_radar")
      .select("id,title_ko,summary_ko,source_name,source_url,topic,created_at")
      .order("created_at", { ascending: false })
      .limit(20)
      .then(({ data }) => {
        setItems((data as RadarRow[]) ?? []);
        setLoaded(true);
      });
  }, []);

  return (
    <div className="rounded-2xl border border-line bg-cream p-5">
      <div className="flex items-center gap-2">
        <span className="inline-flex h-2 w-2 rounded-full bg-gold" aria-hidden />
        <h2 className="font-serif-kr text-lg text-ink">업계 소식 레이더</h2>
        <span className="text-[12px] text-mute">주 1회 자동 수집 · A2·저지·헤이밀크·동물복지·저탄소</span>
      </div>

      {loaded && items.length === 0 ? (
        <p className="mt-3 text-[13px] text-mute">
          아직 수집된 소식이 없습니다. (매주 월요일 자동 수집 — 환경변수·마이그레이션 설정 후 동작)
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {items.map((n) => (
            <li key={n.id} className="py-3">
              <div className="flex flex-wrap items-center gap-2">
                {n.topic && (
                  <span className="rounded-full bg-gold/10 px-2 py-0.5 text-[12px] text-gold-deep">{n.topic}</span>
                )}
                <span className="text-[12px] text-mute tabular-nums">
                  {new Date(n.created_at).toLocaleDateString("ko-KR")}
                </span>
              </div>
              <a
                href={n.source_url}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 block text-[14px] font-medium text-ink transition-colors hover:text-gold-deep"
              >
                {n.title_ko} <span className="text-[12px] text-mute">↗</span>
              </a>
              <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">{n.summary_ko}</p>
              {n.source_name && <p className="mt-0.5 text-[12px] text-mute">{n.source_name}</p>}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

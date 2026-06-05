"use client";

// 관리자 업계 소식 피드 — 레이더가 모은 소식 이력(최신순) + '지금 한 번 수집' 즉시실행.
import { useCallback, useEffect, useState } from "react";
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
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await getSupabase()
      .from("news_radar")
      .select("id,title_ko,summary_ko,source_name,source_url,topic,created_at")
      .order("created_at", { ascending: false })
      .limit(20);
    setItems((data as RadarRow[]) ?? []);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runNow() {
    if (running) return;
    setRunning(true);
    setRunMsg(null);
    try {
      const { data } = await getSupabase().auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setRunMsg("로그인이 필요합니다.");
        setRunning(false);
        return;
      }
      const res = await fetch("/api/admin/news-radar-run", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}` },
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: boolean; status?: string; title?: string; reason?: string }
        | null;
      if (!json?.ok) {
        setRunMsg(
          json?.reason === "not_configured"
            ? "환경변수 미설정(NEWS_RADAR_SECRET·OPENAI_API_KEY 확인)"
            : `수집 실패: ${json?.reason ?? "알 수 없음"}`
        );
      } else if (json.status === "inserted") {
        setRunMsg(`새 소식 1건 수집: ${json.title ?? ""}`);
        await load();
      } else if (json.status === "duplicate") {
        setRunMsg("이미 수집된 소식입니다(중복).");
      } else if (json.status === "no_relevant") {
        setRunMsg("이번엔 연관성 높은 소식이 없었습니다.");
      } else {
        setRunMsg("수집할 후보를 찾지 못했습니다.");
      }
    } catch {
      setRunMsg("네트워크 오류가 발생했습니다.");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="rounded-2xl border border-line bg-cream p-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="inline-flex h-2 w-2 rounded-full bg-gold" aria-hidden />
          <h2 className="font-serif-kr text-lg text-ink">업계 소식 레이더</h2>
          <span className="text-[12px] text-mute">주 1회 자동 · A2·저지·헤이밀크·동물복지·저탄소</span>
        </div>
        <button
          type="button"
          onClick={runNow}
          disabled={running}
          className="rounded-full border border-line px-3 py-1.5 text-[13px] font-medium text-ink-soft transition-colors hover:border-gold hover:text-gold-deep disabled:opacity-50 no-print"
        >
          {running ? "수집 중…" : "지금 한 번 수집"}
        </button>
      </div>

      {runMsg && <p className="mt-2 text-[13px] text-ink-soft">{runMsg}</p>}

      {loaded && items.length === 0 ? (
        <p className="mt-3 text-[13px] text-mute">
          아직 수집된 소식이 없습니다. ‘지금 한 번 수집’을 누르거나, 매주 월요일 자동 수집을 기다리세요.
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

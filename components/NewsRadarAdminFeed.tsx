"use client";

// 관리자 업계 소식 피드 — 레이더가 모은 소식 이력(최신순) + '지금 한 번 수집' 즉시실행.
//   수집된 소식은 '대기' 상태. 관리자가 검토해 게시한 글만 메인(고객)에 노출되고, 삭제할 수 있다.
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
  published: boolean;
};

export function NewsRadarAdminFeed() {
  const [items, setItems] = useState<RadarRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const { data } = await getSupabase()
      .from("news_radar")
      .select("id,title_ko,summary_ko,source_name,source_url,topic,created_at,published")
      .order("created_at", { ascending: false })
      .limit(20);
    setItems((data as RadarRow[]) ?? []);
    setLoaded(true);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  // 게시/숨김 토글 — 게시한 글만 메인(고객)에 노출된다.
  async function setPublished(id: string, next: boolean) {
    if (busyId) return;
    setBusyId(id);
    setRunMsg(null);
    try {
      const { error } = await getSupabase().rpc("news_radar_set_published", {
        p_id: id,
        p_published: next,
      });
      if (error) {
        setRunMsg(`상태 변경 실패: ${error.message}`);
        return;
      }
      setItems((prev) => prev.map((it) => (it.id === id ? { ...it, published: next } : it)));
      setRunMsg(next ? "메인에 게시했습니다." : "메인에서 숨겼습니다.");
    } catch {
      setRunMsg("네트워크 오류가 발생했습니다.");
    } finally {
      setBusyId(null);
    }
  }

  // 삭제 — 검색·수집된 것 중 빼고 싶은 글 제거(되돌릴 수 없음).
  async function remove(id: string) {
    if (busyId) return;
    if (typeof window !== "undefined" && !window.confirm("이 소식을 삭제할까요? 되돌릴 수 없습니다.")) {
      return;
    }
    setBusyId(id);
    setRunMsg(null);
    try {
      const { error } = await getSupabase().rpc("news_radar_delete", { p_id: id });
      if (error) {
        setRunMsg(`삭제 실패: ${error.message}`);
        return;
      }
      setItems((prev) => prev.filter((it) => it.id !== id));
      setRunMsg("소식을 삭제했습니다.");
    } catch {
      setRunMsg("네트워크 오류가 발생했습니다.");
    } finally {
      setBusyId(null);
    }
  }

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
    <div className="overflow-hidden rounded-2xl border-2 border-gold/50 bg-gradient-to-br from-gold/20 via-cream to-cream shadow-sm">
      {/* 강조 헤더 바 */}
      <div className="flex flex-wrap items-center justify-between gap-2 bg-gradient-to-r from-gold-deep to-gold px-5 py-3 text-cream">
        <div className="flex items-center gap-2">
          <span className="text-[18px]" aria-hidden>🌍</span>
          <h2 className="font-serif-kr text-lg font-medium">업계 소식 레이더</h2>
          <span className="hidden text-[12px] text-cream/80 sm:inline">주 1회 자동 · 글로벌 낙농 소식</span>
        </div>
        <button
          type="button"
          onClick={runNow}
          disabled={running}
          className="rounded-full bg-cream px-4 py-1.5 text-[13px] font-semibold text-gold-deep shadow-sm transition-transform hover:scale-[1.03] active:scale-95 disabled:opacity-60 no-print"
        >
          {running ? "수집 중…" : "🔄 지금 한 번 수집"}
        </button>
      </div>

      <div className="p-5">
      <p className="text-[12.5px] text-mute">A2 · 저지 · 헤이밀크 · 동물복지 · 저탄소 낙농 — 매주 가장 의미 있는 1건을 한글로.</p>
      <p className="mt-1 text-[12.5px] text-mute">수집된 소식은 <b>대기</b> 상태입니다. <b>게시</b>한 글만 메인에 노출되고, 필요 없는 글은 삭제하세요.</p>
      {runMsg && (
        <p className="mt-2 rounded-lg bg-gold/15 px-3 py-2 text-[13px] font-medium text-gold-deep">{runMsg}</p>
      )}

      {loaded && items.length === 0 ? (
        <p className="mt-3 text-[13px] text-mute">
          아직 수집된 소식이 없습니다. ‘지금 한 번 수집’을 누르거나, 매주 월요일 자동 수집을 기다리세요.
        </p>
      ) : (
        <ul className="mt-3 divide-y divide-line">
          {items.map((n) => (
            <li key={n.id} className="py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span
                  className={
                    n.published
                      ? "rounded-full bg-hey-green/15 px-2 py-0.5 text-[12px] font-medium text-hey-green"
                      : "rounded-full bg-ink/5 px-2 py-0.5 text-[12px] font-medium text-mute"
                  }
                >
                  {n.published ? "🟢 게시중" : "⚪ 대기"}
                </span>
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

              <div className="mt-2 flex flex-wrap items-center gap-2 no-print">
                <button
                  type="button"
                  onClick={() => setPublished(n.id, !n.published)}
                  disabled={busyId === n.id}
                  className={
                    n.published
                      ? "rounded-full border border-line bg-cream px-3 py-1 text-[12.5px] font-medium text-ink transition-colors hover:border-gold disabled:opacity-60"
                      : "rounded-full bg-hey-green px-3 py-1 text-[12.5px] font-semibold text-cream transition-transform hover:scale-[1.03] active:scale-95 disabled:opacity-60"
                  }
                >
                  {busyId === n.id ? "처리 중…" : n.published ? "숨기기" : "메인에 게시"}
                </button>
                <button
                  type="button"
                  onClick={() => remove(n.id)}
                  disabled={busyId === n.id}
                  className="rounded-full border border-line px-3 py-1 text-[12.5px] font-medium text-hey-deep-orange transition-colors hover:border-hey-deep-orange disabled:opacity-60"
                >
                  삭제
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      </div>
    </div>
  );
}

import { cache } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NewsRow } from "@/lib/news";
import { isNewsId, newsSitemapEntries, type NewsSitemapEntry } from "@/lib/news-feed";

// 서버 전용: 게시된 목장 소식(news)을 anon 키로 읽는다 — /story 소식 띠·소식 고유 페이지·RSS·사이트맵 공용.
//   조건은 예전 클라이언트 조회(components/NewsBand)와 같다: published=true, 최신 글 먼저.
//   RLS(news_select_published)도 게시글만 내주지만, 조건을 코드에도 적어 둔다(정책이 바뀌어도 초안이 새지 않게).
//   lib/supabase.ts 의 getSupabase()는 "use client" 브라우저 클라이언트(persistSession)라 서버에서 쓰지 않는다
//   (lib/seo/live-catalog.ts 와 같은 방식). service_role 은 쓰지 않는다.
//   환경변수가 없으면(로컬 빌드) 빈 결과.
//   ★ 조회 실패(DB 오류·시간 초과)는 '빌드 중'에만 빈 결과로 넘긴다(배포가 DB 장애에 막히지 않게).
//     빌드가 끝난 뒤의 ISR 재생성에서는 오류를 던진다 — 그래야 Next 가 마지막 정상본을 계속 보여 준다.
//     빈 결과로 넘기면 '있는 글이 404', '글 0개짜리 RSS' 가 1시간 동안 캐시된다
//     (node_modules/next/dist/docs/01-app/02-guides/incremental-static-regeneration.md — Handling uncaught exceptions).
//   React cache() — 한 번의 렌더(generateMetadata + page) 안에서 같은 조회를 한 번만 한다.
//   컬럼은 운영 DB 에서 확인했다(2026-11-12, information_schema.columns: id uuid … updated_at timestamptz).

const COLUMNS = "id, title, body, cover_url, youtube_id, published, created_at, updated_at";

/** 한 번에 읽는 최대 글 수(사이트맵·RSS·정적 생성용). 넘으면 오래된 글부터 빠진다 — 그때 페이지 나누기를 더한다. */
export const NEWS_FETCH_LIMIT = 500;

/** 빌드·재생성이 DB 응답을 무한정 기다리지 않게. */
const TIMEOUT_MS = 8000;

function anonClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) return null;
  return createClient(url, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

function onFetchError<T>(what: string, err: unknown, fallback: T): T {
  if (process.env.NEXT_PHASE === "phase-production-build") {
    console.error(`${what} — 빌드 중이라 빈 결과로 계속:`, err);
    return fallback;
  }
  throw err instanceof Error ? err : new Error(String(err));
}

/** 게시된 소식 전체(최신 먼저). 미설정이면 []. 실패는 빌드 중에만 [] (그 밖에는 throw). */
export const fetchPublishedNews = cache(async (): Promise<NewsRow[]> => {
  const sb = anonClient();
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from("news")
      .select(COLUMNS)
      .eq("published", true)
      .order("created_at", { ascending: false })
      .limit(NEWS_FETCH_LIMIT)
      .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
    if (error) throw new Error(error.message);
    return ((data as NewsRow[] | null) ?? []).filter((r) => r.published === true);
  } catch (err) {
    return onFetchError("목장 소식 조회 실패", err, [] as NewsRow[]);
  }
});

/** 최근 게시글 N건(최신 먼저) — /story 소식 띠·글 아래 '다른 소식'용. 전체를 읽지 않는다. */
export const fetchLatestNews = cache(async (limit: number): Promise<NewsRow[]> => {
  const sb = anonClient();
  if (!sb) return [];
  try {
    const { data, error } = await sb
      .from("news")
      .select(COLUMNS)
      .eq("published", true)
      .order("created_at", { ascending: false })
      .limit(limit)
      .abortSignal(AbortSignal.timeout(TIMEOUT_MS));
    if (error) throw new Error(error.message);
    return ((data as NewsRow[] | null) ?? []).filter((r) => r.published === true);
  } catch (err) {
    return onFetchError("최근 목장 소식 조회 실패", err, [] as NewsRow[]);
  }
});

/** 게시된 소식 한 건. id 모양이 uuid 가 아니거나, 없거나, 미게시면 null. 실패는 빌드 중에만 null. */
export const fetchNewsById = cache(async (id: string): Promise<NewsRow | null> => {
  if (!isNewsId(id)) return null;
  const sb = anonClient();
  if (!sb) return null;
  try {
    const { data, error } = await sb
      .from("news")
      .select(COLUMNS)
      .eq("id", id)
      .eq("published", true)
      .abortSignal(AbortSignal.timeout(TIMEOUT_MS))
      .maybeSingle();
    if (error) throw new Error(error.message);
    const row = data as NewsRow | null;
    return row && row.published === true ? row : null;
  } catch (err) {
    return onFetchError("목장 소식 1건 조회 실패", err, null);
  }
});

/** sitemap.xml 용 — 게시된 소식의 고유 주소 + 마지막 수정일(KST YYYY-MM-DD, updated_at). */
export async function listNewsForSitemap(): Promise<NewsSitemapEntry[]> {
  return newsSitemapEntries(await fetchPublishedNews());
}

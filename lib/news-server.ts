import { cache } from "react";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { NewsRow } from "@/lib/news";
import { isNewsId, newsSitemapEntries, type NewsSitemapEntry } from "@/lib/news-feed";

// 서버 전용: 게시된 목장 소식(news)을 anon 키로 읽는다 — /story 소식 띠·소식 고유 페이지·RSS·사이트맵 공용.
//   조건은 예전 클라이언트 조회(components/NewsBand)와 같다: published=true, 최신 글 먼저.
//   RLS(news_select_published)도 게시글만 내주지만, 조건을 코드에도 적어 둔다(정책이 바뀌어도 초안이 새지 않게).
//   lib/supabase.ts 의 getSupabase()는 "use client" 브라우저 클라이언트(persistSession)라 서버에서 쓰지 않는다
//   (lib/seo/live-catalog.ts 와 같은 방식). service_role 은 쓰지 않는다.
//   환경변수가 없거나(로컬 빌드) 조회가 실패하면 빈 결과 — 페이지·피드를 깨뜨리지 않는다.
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

/** 게시된 소식 전체(최신 먼저). 실패·미설정이면 []. */
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
    console.error("목장 소식 조회 실패 — 빈 목록으로 계속:", err);
    return [];
  }
});

/** 게시된 소식 한 건. id 모양이 uuid 가 아니거나, 없거나, 미게시·실패면 null. */
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
    console.error("목장 소식 1건 조회 실패:", err);
    return null;
  }
});

/** sitemap.xml 용 — 게시된 소식의 고유 주소 + 마지막 수정일(KST YYYY-MM-DD, updated_at). */
export async function listNewsForSitemap(): Promise<NewsSitemapEntry[]> {
  return newsSitemapEntries(await fetchPublishedNews());
}

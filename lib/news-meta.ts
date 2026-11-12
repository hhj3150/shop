import type { Metadata } from "next";
import { pageMetadata } from "@/lib/seo/meta";
import { formatTitle, type NewsRow } from "@/lib/news";
import { newsExcerpt, newsPath, toIsoOrNull } from "@/lib/news-feed";

// 목장 소식 한 건의 페이지 메타데이터 — 공개 페이지 규칙(lib/seo/meta.ts pageMetadata)을 그대로 받고,
//   글에만 있는 것(공유 카드 형식 'article'·게시/수정 시각·표지 사진)을 더한다.
//   제목 = 글 제목(+ ' · 송영신목장'), 설명 = 본문 앞 100자 안팎(글마다 다르다 — 네이버 중복 설명 불이익 회피),
//   대표주소 = /story/news/<id>.

/**
 * 공유 카드에 쓸 표지 사진 — https 절대주소이고 JPG/PNG 일 때만.
 * 카카오톡 미리보기는 JPG/PNG 만 읽는다(WEBP·GIF 는 빠진다) → 그 밖이면 null(기본 공유 이미지를 쓴다).
 */
export function ogCoverUrl(cover: string | null | undefined): string | null {
  if (!cover) return null;
  let u: URL;
  try {
    u = new URL(cover);
  } catch {
    return null;
  }
  if (u.protocol !== "https:") return null;
  return /\.(jpe?g|png)$/i.test(u.pathname) ? u.toString() : null;
}

export type NewsMetaRow = Pick<NewsRow, "id" | "title" | "body" | "cover_url" | "created_at" | "updated_at">;

export function newsMetadata(row: NewsMetaRow): Metadata {
  const title = formatTitle(row.title);
  const base = pageMetadata({
    title,
    description: newsExcerpt(row.body),
    path: newsPath(row.id),
  });
  const cover = ogCoverUrl(row.cover_url);
  const published = toIsoOrNull(row.created_at);
  const modified = toIsoOrNull(row.updated_at);
  // 표지 사진은 크기를 모른다 → width/height 없이 넣는다(틀린 크기보다 낫다).
  const coverImage = cover ? { url: cover, alt: title } : null;
  return {
    ...base,
    openGraph: {
      ...base.openGraph,
      type: "article",
      ...(published ? { publishedTime: published } : {}),
      ...(modified ? { modifiedTime: modified } : {}),
      ...(coverImage ? { images: [coverImage] } : {}),
    },
    ...(coverImage ? { twitter: { ...base.twitter, images: [coverImage] } } : {}),
  };
}

import type { Metadata } from "next";

// 페이지 메타데이터(제목·설명·대표주소·공유 카드)를 한 모양으로 만든다.
//
//   [왜] Next 의 메타데이터 병합은 '얕은 병합'이다. 페이지가 openGraph 를 하나라도 정의하면
//        루트의 openGraph(이미지·사이트명·로케일)가 통째로 사라지고, 정의하지 않으면 루트의
//        제목·설명을 그대로 물려받는다. 예전에는 루트 openGraph 에 제목이 박혀 있어
//        /story·/guide·/signup 등의 카톡 공유 카드가 전부 홈과 같은 제목으로 나갔다.
//        모든 공개 페이지가 이 함수 하나로 openGraph·twitter 를 '완전한 모양'으로 받는다.
//        (node_modules/next/dist/docs/01-app/03-api-reference/04-functions/generate-metadata.md — Merging)

export const SITE_NAME = "송영신목장";
export const TITLE_SUFFIX = ` · ${SITE_NAME}`;
export const OG_LOCALE = "ko_KR";

export type OgImage = { url: string; width: number; height: number; alt: string };

// 기본 공유 이미지 — 1200×630 JPG. 카카오톡 미리보기는 JPG/PNG 만 읽는다(WEBP 는 빠짐).
export const DEFAULT_OG_IMAGE: OgImage = {
  url: "/brand/og-default.jpg",
  width: 1200,
  height: 630,
  alt: "송영신목장 A2 저지 헤이밀크와 플레인 요거트",
};

export type PageSeo = {
  /** 접미사(' · 송영신목장') 앞부분. absoluteTitle 이면 전체 제목. */
  title: string;
  description: string;
  /** 사이트 기준 경로("/", "/story" …) — canonical 과 og:url 이 된다. */
  path: string;
  absoluteTitle?: boolean;
  /**
   * 공유 이미지. 생략하면 기본 이미지.
   * null 이면 images 키를 아예 두지 않는다 — 그 세그먼트의 opengraph-image 파일이 쓰이게 하려면
   * 키가 없어야 한다(같은 세그먼트에 openGraph.images 가 있으면 파일 이미지가 무시된다).
   */
  ogImage?: OgImage | null;
};

/** 공개 페이지용 메타데이터. canonical = og:url = path, 사이트명·로케일·카드 형식 고정. */
export function pageMetadata(seo: PageSeo): Metadata {
  const fullTitle = seo.absoluteTitle ? seo.title : `${seo.title}${TITLE_SUFFIX}`;
  const image = seo.ogImage === null ? null : (seo.ogImage ?? DEFAULT_OG_IMAGE);
  return {
    title: seo.absoluteTitle ? { absolute: seo.title } : seo.title,
    description: seo.description,
    alternates: { canonical: seo.path },
    openGraph: {
      type: "website",
      locale: OG_LOCALE,
      siteName: SITE_NAME,
      title: fullTitle,
      description: seo.description,
      url: seo.path,
      ...(image ? { images: [image] } : {}),
    },
    twitter: {
      card: "summary_large_image",
      title: fullTitle,
      description: seo.description,
      ...(image ? { images: [{ url: image.url, alt: image.alt }] } : {}),
    },
  };
}

/** 색인에서 빼는 페이지(로그인·주문·결제·관리자 등). 제목만 고유하게 두고 noindex. */
export function privateMetadata(title: string): Metadata {
  return { title, robots: { index: false, follow: false } };
}

/**
 * 검색엔진 소유확인 메타태그 — 값은 환경변수로만 받는다(코드에 박지 않는다).
 *   GOOGLE_SITE_VERIFICATION → <meta name="google-site-verification">
 *   NAVER_SITE_VERIFICATION  → <meta name="naver-site-verification">  (HTML 파일 인증과 병행 가능)
 *   BING_SITE_VERIFICATION   → <meta name="msvalidate.01">  (Bing — ChatGPT 검색·Copilot 노출의 기반)
 * 하나도 없으면 undefined(태그 없음).
 */
export function searchVerification(
  env: Record<string, string | undefined>
): Metadata["verification"] | undefined {
  const pick = (k: string) => env[k]?.trim() || undefined;
  const google = pick("GOOGLE_SITE_VERIFICATION");
  const naver = pick("NAVER_SITE_VERIFICATION");
  const bing = pick("BING_SITE_VERIFICATION");
  const other: Record<string, string> = {
    ...(naver ? { "naver-site-verification": naver } : {}),
    ...(bing ? { "msvalidate.01": bing } : {}),
  };
  const hasOther = Object.keys(other).length > 0;
  if (!google && !hasOther) return undefined;
  return { ...(google ? { google } : {}), ...(hasOther ? { other } : {}) };
}

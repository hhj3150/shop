// /learn 해설 글의 사진 — 화면 첫 사진·허브 썸네일·구조화데이터(Article.image)·공유 카드(og:image) 단일 출처.
//
//   사진은 모두 송영신목장 회장님이 보낸 실제 목장 사진이다(2026-11-13). 원본 해상도가 낮아
//   (소 360×480, 들판 768×1024) Higgsfield 업스케일(2K)로 키운 뒤 WebP 로 줄였다(AGENTS.md: 이미지 편집은 Higgsfield).
//   공유 카드(og)는 카카오톡이 읽을 수 있게 1200×630 JPG 로 따로 잘랐다(얼굴·지평선이 들어가게 수동 크롭).
//   ★ 사진 설명(alt·caption)에는 사진에 보이는 것과 확인된 사실만 쓴다 — 장소·연도·개체 정보를 지어내지 않는다.
//     '풀을 뜯는' 같은 사료 표현은 쓰지 않는다(생풀 급여 없음 — 카피 가이드).

export type LearnImage = {
  /** public/ 기준 경로 (WebP, 세로 3:4 원본) */
  src: string;
  width: number;
  height: number;
  /** 공유 카드 1200×630 JPG */
  og: string;
  alt: string;
  /** 사진 아래 한 줄(선택) */
  caption?: string;
  /** 가로로 잘라 보일 때의 중심(object-position) */
  position: string;
};

export const LEARN_IMAGES: Readonly<Record<string, LearnImage>> = {
  "a2-milk": {
    src: "/learn/a2-milk.webp",
    width: 1440,
    height: 1920,
    og: "/learn/og/a2-milk.jpg",
    alt: "깔짚 위에 엎드려 쉬며 정면을 바라보는 송영신목장의 저지 송아지",
    caption: "송영신목장의 저지 송아지. 베타카제인 유전자형은 부모에게서 하나씩 물려받아 정해집니다.",
    position: "50% 45%",
  },
  "jersey-milk": {
    src: "/learn/jersey-milk.webp",
    width: 1440,
    height: 1920,
    og: "/learn/og/jersey-milk.jpg",
    alt: "귀표를 단 송영신목장의 저지 젖소들이 우사 안에서 정면을 바라보는 모습",
    caption: "송영신목장의 저지 젖소들.",
    position: "40% 42%",
  },
  "hay-milk": {
    src: "/learn/hay-milk.webp",
    width: 1200,
    height: 1600,
    og: "/learn/og/hay-milk.jpg",
    alt: "베어 낸 풀을 여러 줄로 펼쳐 말리는 들판과 멀리 보이는 나무숲",
    caption: "건초를 만들기 위해 베어 말리는 풀.",
    position: "50% 55%",
  },
};

/** /learn 허브 첫 사진 */
export const LEARN_HUB_IMAGE: LearnImage = {
  src: "/learn/learn-hub.webp",
  width: 1200,
  height: 1600,
  og: "/learn/og/learn-hub.jpg",
  alt: "구름 낀 하늘 아래 풀을 베어 둔 넓은 들판",
  position: "50% 74%",
};

export function learnImage(slug: string): LearnImage | undefined {
  return LEARN_IMAGES[slug];
}

/** 공유 카드 메타(1200×630) — pageMetadata 의 ogImage 형식 */
export function learnOgImage(img: LearnImage) {
  return { url: img.og, width: 1200, height: 630, alt: img.alt };
}

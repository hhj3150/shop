// /learn 해설 글의 사진 — 화면 첫 사진·허브 썸네일·구조화데이터(Article.image)·공유 카드(og:image) 단일 출처.
//
//   사진은 모두 송영신목장 회장님이 보낸 실제 목장 사진이다(2026-11-13). 원본 해상도가 낮아
//   (소 360×480, 들판 768×1024) Higgsfield 업스케일(2K)로 키운 뒤 WebP 로 줄였다(AGENTS.md: 이미지 편집은 Higgsfield).
//   인증 목장 글의 사진 2장(저지 젖소·송아지, 어린 싹 밭)은 원본이 1500×2000 이라 업스케일 없이 줄이기만 했다
//   (송아지 귀표에 글씨가 있다 — 글씨 있는 사진은 AI 업스케일 금지, AGENTS.md).
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
  "certified-farm": {
    src: "/learn/certified-farm.webp",
    width: 1440,
    height: 1920,
    og: "/learn/og/certified-farm.jpg",
    alt: "햇빛이 드는 송영신목장 우사의 깔짚 위에서, 뒤돌아 선 저지 젖소 곁에 귀표를 단 송아지가 서 있는 모습",
    // 동물복지 인증서의 '자유방목 기준 충족 여부'는 '부'다 — 방목이라는 말을 쓰지 않는다(lib/certifications.ts).
    caption:
      "송영신목장 우사의 저지 젖소와 송아지. 동물복지축산농장 인증은 심사원이 농장을 찾아가 사육 환경과 관리를 현장에서 확인합니다.",
    position: "50% 86%",
  },
};

/**
 * 해설 글 본문 소제목 아래에 붙는 사진. heading 은 lib/seo/learn.ts 의 소제목과 글자까지 같아야 한다
 * (테스트가 확인 — 소제목을 고치면 사진이 조용히 사라지지 않고 테스트가 먼저 깨진다).
 */
export type LearnSectionImage = {
  heading: string;
  /** public/ 기준 경로 (WebP, 가로 3:2) */
  src: string;
  width: number;
  height: number;
  alt: string;
  caption?: string;
};

export const LEARN_SECTION_IMAGES: Readonly<Record<string, readonly LearnSectionImage[]>> = {
  "certified-farm": [
    {
      heading: "저탄소 축산물 인증은 무엇을 심사하나요?",
      src: "/learn/certified-farm-low-carbon.webp",
      width: 1200,
      height: 800,
      alt: "흙 사이로 이슬 맺힌 어린 싹이 줄지어 돋아난 밭을 낮은 눈높이에서 찍은 사진",
      // 어떤 작물인지·어느 밭인지 확인 전 — 장소·작물·효과(탄소 흡수 등)를 지어내지 않는다.
      caption: "밭에 줄지어 돋아난 어린 싹.",
    },
  ],
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

/** 소제목(heading) 아래에 붙일 사진 — 없으면 undefined */
export function learnSectionImage(slug: string, heading: string): LearnSectionImage | undefined {
  return LEARN_SECTION_IMAGES[slug]?.find((img) => img.heading === heading);
}

/** 공유 카드 메타(1200×630) — pageMetadata 의 ogImage 형식 */
export function learnOgImage(img: LearnImage) {
  return { url: img.og, width: 1200, height: 630, alt: img.alt };
}

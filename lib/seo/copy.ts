// 검색 결과·AI 답변·공유 카드에 나가는 페이지 문구(제목·설명).
//
//   ★ 숫자(가격·할인율·정원·배송비·최소금액)는 여기 손으로 적지 않는다 — lib/products.ts ·
//     lib/regions.ts 에서 끌어온다. 정책이 바뀌면 검색 문구도 같이 바뀐다.
//   ★ 사실만 적는다(docs/브랜드-카피-가이드.md). 쓰지 않는 말: '건초만'·'풀만'(사실과 다름),
//     '방목', '일반 우유'·'~보다'(비교), 소화·건강 효능. 인증은 '농장 인증'으로만 적는다
//     (lib/certifications.ts). lib/seo/claims.test.ts 가 이 파일의 출력물을 검사한다.
//   ★ 길이: 제목은 접미사(' · 송영신목장') 앞 40자 이내, 설명은 대략 60–130자.
//     네이버는 페이지마다 다른 설명을 요구하고(중복 시 불이익), 제목을 자주 바꾸는 것도 불이익이다
//     — 한 번 정하면 오래 둔다.
import {
  PUBLIC_PRODUCTS,
  SUB_DAY_CAP,
  SUB_TOTAL_CAP,
  SUB_SHIPPING_KRW,
  MIN_ORDER_KRW,
  ONCE_MIN_KRW,
  ONCE_SHIPPING_KRW,
  formatWon,
  discountRangeLabel,
  periodWeeksList,
  type Product,
} from "@/lib/products";
import { SPECIAL_DELIVERY_SHIPPING_KRW } from "@/lib/regions";
import type { Certification } from "@/lib/certifications";

/** 루트 기본 제목(개별 제목이 없는 페이지 — 주로 비공개 페이지). */
export const SITE_TITLE_DEFAULT = "송영신목장 · A2 Jersey Hay Milk";

/** 루트 기본 설명. 개별 설명이 없는 페이지가 물려받는다. */
export const SITE_DESCRIPTION =
  "경기도 안성 송영신목장의 A2 저지 헤이밀크와 마시는 플레인 요거트. A2/A2 저지 원유, 사일리지 없는 유럽 전통 헤이밀크 방식. 회원 정기구독과 단품 주문.";

/** 구조화데이터(Organization.description)·llms.txt 머리말이 함께 쓰는 한 문단. */
export const ORG_DESCRIPTION =
  "송영신목장(농업회사법인 주식회사 디투오)은 경기도 안성에서 A2/A2 저지 젖소를 사일리지(발효사료) 없는 유럽 전통 헤이밀크 방식으로 기르고, 그 원유로 우유와 플레인 요거트를 만들어 판매합니다.";

const shipNote = `배송비 회당 ${formatWon(SUB_SHIPPING_KRW)}(제주·도서산간 ${formatWon(
  SPECIAL_DELIVERY_SHIPPING_KRW
)})`;

/** 유효한 농장 인증 이름을 '·'로 잇는다(예: 동물복지축산농장·저탄소 축산물 농장). */
function certShortNames(certs: readonly Certification[]): string {
  const wanted = ["animal-welfare", "low-carbon"];
  return certs
    .filter((c) => wanted.includes(c.id))
    .map((c) => c.name.replace(/\s*인증$/, ""))
    .join("·");
}

export type SeoCopy = { title: string; description: string };

/** 홈. 제목은 절대값(템플릿 미적용) — 브랜드명이 맨 앞. */
export function homeSeo(certs: readonly Certification[]): SeoCopy {
  const c = certShortNames(certs);
  return {
    title: "송영신목장 A2 저지우유(헤이밀크)·요거트 정기배송",
    description: `경기도 안성 송영신목장의 A2 저지 헤이밀크와 마시는 플레인 요거트. 사일리지 없는 유럽 전통 헤이밀크 방식${
      c ? `, ${c} 인증 목장` : ""
    }. ${periodWeeksList()}주 정기구독과 단품 주문.`,
  };
}

// 라벨(법정 표시사항) 문자열의 첫 토막 — "A2A2저지 원유 100% (국산) · 우유 함유" → 앞부분.
const firstPart = (s: string | undefined) => (s ?? "").split(" · ")[0].trim();

/** 제품 상세. 라벨·영양 SSOT 값으로만 조립한다. */
export function productSeo(p: Product): SeoCopy & { jsonLdDescription: string } {
  const name = `${p.name} ${p.volume}`;
  const price = `정가 ${formatWon(p.price)}, 정기구독 회원가 ${discountRangeLabel()}% 할인`;
  if (p.line === "milk") {
    const facts = `${firstPart(p.label.ingredients)}로 만든 우유 ${p.volume}(${p.kcal}kcal). 사일리지 없는 헤이밀크 방식, ${firstPart(
      p.label.sterilization
    )}.`;
    return {
      // 제목 안 낱말 반복 금지(네이버) — 'A2 저지'를 두 번 쓰지 않는다.
      title: `${name} · 목장 직송 우유`,
      description: `${facts} 경기도 안성 송영신목장. ${price}.`,
      jsonLdDescription: `${facts} 경기도 안성 송영신목장에서 기른 A2/A2 저지 젖소의 원유입니다.`,
    };
  }
  if (p.line === "yogurt") {
    // 스티커('드링킹 타입')는 '떠먹는 꾸덕한 요거트'라는 오해를 푸는 사실 정보라 그대로 쓴다.
    const type = p.sticker?.title ? `${p.sticker.title} ` : "";
    const facts = `A2/A2 저지 원유를 12시간 발효한 ${type}플레인 요거트 ${p.volume}(${p.kcal}kcal), 설탕 무첨가, 유산균수 ${firstPart(
      p.label.cultures
    )}.`;
    return {
      title: `${name} · 무가당 드링킹 타입`,
      description: `${facts} 송영신목장. ${price}.`,
      jsonLdDescription: `${facts} 원재료 ${firstPart(p.label.ingredients)}. 경기도 안성 송영신목장.`,
    };
  }
  // 그 밖의 라인(출시 전 제품 등) — 카드 문구 그대로.
  return {
    title: name,
    description: `${name}. ${p.shortDesc}`,
    jsonLdDescription: `${name}. ${p.shortDesc}`,
  };
}

/** 고정 페이지 문구. 인증명이 들어가는 /story 만 함수로 만든다. */
export function storySeo(certs: readonly Certification[]): SeoCopy {
  const c = certShortNames(certs);
  return {
    title: "목장 이야기 — A2 저지와 헤이밀크, 재생농업",
    description: `경기도 안성 송영신목장이 A2/A2 저지를 사일리지 없는 유럽 전통 헤이밀크 방식으로 기르는 이야기${
      c ? `. ${c} 인증` : ""
    }, 재생농업과 목장 소식.`,
  };
}

const productVolumes = (line: Product["line"]) =>
  PUBLIC_PRODUCTS.filter((p) => p.line === line)
    .map((p) => p.volume.replace(/mL$/i, ""))
    .join("·");

export const PAGE_SEO = {
  faq: {
    title: "자주 묻는 질문 — A2 우유·저지·헤이밀크",
    description:
      "A2 우유와 유당, 저지 우유, 헤이밀크(건초우유)가 무엇인지, 목장 인증과 정기구독·배송·가격까지 송영신목장이 답합니다.",
  },
  guide: {
    title: "배송 · 교환/환불 안내",
    description: `콜드체인 냉장 택배로 보냅니다. 정기구독은 매주 1회(월–금 중 택1) 발송, ${shipNote}, 회당 최소 상품 금액 ${formatWon(
      MIN_ORDER_KRW
    )}. 신선식품 교환·환불 기준 안내.`,
  },
  signup: {
    title: "A2 저지 헤이밀크 정기구독 신청",
    description: `송영신목장 A2 저지 헤이밀크·요거트 정기구독. 요일별 ${SUB_DAY_CAP}명·총 ${SUB_TOTAL_CAP}명 회원제, 월–금 중 하루 매주 1회 발송. ${periodWeeksList()}주 선납 시 ${discountRangeLabel()}% 할인, ${shipNote}.`,
  },
  orderOnce: {
    title: "단품 구매 — 회원가입 없이 1회 주문",
    description: `회원이 아니어도 A2 저지 헤이밀크(${productVolumes(
      "milk"
    )}mL)·플레인 요거트(${productVolumes("yogurt")}mL)를 한 번 주문할 수 있습니다. 상품 합계 ${formatWon(
      ONCE_MIN_KRW
    )}부터, 배송비 ${formatWon(ONCE_SHIPPING_KRW)}(제주·도서산간 ${formatWon(SPECIAL_DELIVERY_SHIPPING_KRW)}).`,
  },
  terms: {
    title: "이용약관",
    description:
      "송영신목장 온라인몰(농업회사법인 주식회사 디투오) 이용약관 — 회원가입, 결제, 콜드체인 배송·배송비, 청약철회와 정기구독 해지·환불 기준.",
  },
  privacy: {
    title: "개인정보처리방침",
    description:
      "송영신목장 온라인몰(농업회사법인 주식회사 디투오)의 개인정보 수집 항목, 이용 목적, 보유 기간, 처리 위탁, 이용자 권리와 개인정보 보호책임자 안내.",
  },
} as const satisfies Record<string, SeoCopy>;

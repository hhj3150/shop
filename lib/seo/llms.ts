// /llms.txt · /llms-full.txt 본문 — AI(ChatGPT·Claude·Perplexity 등)가 '이 사이트가 무엇을 파는 누구인지'
// 한 번에 읽도록 정리한 마크다운(llmstxt.org 형식: H1 → 요약 인용 → 본문 → H2 링크 목록 → Optional).
//
//   ★ 예전 public/llms.txt 는 손으로 쓴 고정 파일이라 '건초만'(사실과 다른 표현)·근거 없는 수치가 그대로
//     AI 에 들어갔고, 가격·할인·인증이 바뀌어도 따라가지 않았다. 이제 SSOT 에서 만든다:
//     제품·가격·정책 = lib/products.ts, 사업자·연락처 = lib/site.ts, 인증 = 호출부가 넘기는 유효 인증,
//     문답 = lib/seo/faq.ts.
//   ★ 효과에 대한 기대는 낮게 잡는다(구글은 llms.txt 를 쓰지 않는다고 밝혔다). 비용이 거의 없고
//     '정확한 인용 안내'를 한 곳에 둘 수 있어서 유지한다.
//   ★ 사실만: 효능·비교·'건초만'·'방목'·근거 없는 최상급 금지(lib/seo/claims.test.ts 가 검사한다).
import {
  PUBLIC_PRODUCTS,
  SUB_DAY_CAP,
  SUB_TOTAL_CAP,
  SUB_SHIPPING_KRW,
  MIN_ORDER_KRW,
  ONCE_MIN_KRW,
  ONCE_SHIPPING_KRW,
  formatWon,
  periodDiscountSentence,
  periodWeeksList,
  type Product,
} from "@/lib/products";
import { SPECIAL_DELIVERY_SHIPPING_KRW } from "@/lib/regions";
import {
  SITE_URL,
  BRAND_HOME,
  CAFE_HOME,
  BUSINESS,
  FARM_HOURS,
  CS_HOURS,
  BRAND,
} from "@/lib/site";
import { certValidityLabel, type Certification } from "@/lib/certifications";
import { ORG_DESCRIPTION } from "./copy";
import { FAQ_ITEMS, moreFaqItems } from "./faq";
import { learnLlmsLines } from "./learn";
import { buildNewsLlmsSection } from "@/lib/news-feed";
import type { NewsRow } from "@/lib/news";

export type LlmsInput = {
  /** 오늘(KST) 기준 유효한 농장 인증. */
  certifications: readonly Certification[];
  /** 카드·간편결제(PortOne)가 켜져 있으면 true — 결제 수단 안내가 실제와 같도록. */
  cardPayment: boolean;
  /** 손님에게 보이는 제품(가격은 DB 값 — lib/seo/live-catalog.ts). 생략하면 정적 PUBLIC_PRODUCTS. */
  products?: readonly Product[];
  /** 게시된 목장 소식(최신 먼저). 없으면 '목장 소식' 섹션을 내지 않는다. */
  news?: readonly NewsRow[];
};

const url = (path: string) => `${SITE_URL}${path}`;
const firstPart = (s: string | undefined) => (s ?? "").split(" · ")[0].trim();

function productLine(p: Product): string {
  const tax = p.taxFree ? "면세" : "부가세 포함";
  const facts =
    p.line === "milk"
      ? `우유. ${firstPart(p.label.ingredients)}, ${firstPart(p.label.sterilization)}, ${p.kcal}kcal`
      : p.line === "yogurt"
        ? `발효유. ${firstPart(p.label.ingredients)}, 12시간 발효, 설탕 무첨가, ${
            p.sticker?.title ?? "플레인"
          }, 유산균수 ${firstPart(p.label.cultures)}, ${p.kcal}kcal`
        : p.shortDesc;
  return `- [${p.name} ${p.volume}](${url(`/products/${p.id}`)}): ${facts}. 정가 ${formatWon(p.price)}(${tax}).`;
}

function certSentence(certs: readonly Certification[]): string {
  if (certs.length === 0) return "";
  const list = certs
    .map((c) => `${c.name}(${c.issuer}, ${c.number}, ${certValidityLabel(c)})`)
    .join(", ");
  return ` 목장 인증: ${list}. 모두 목장(젖소 사육·착유 단계)에 대한 인증입니다.`;
}

function paymentSentence(cardPayment: boolean): string {
  return cardPayment
    ? "결제는 무통장입금과 카드·간편결제로 할 수 있으며, 콜드체인 냉장 택배로 발송합니다."
    : "결제는 무통장입금으로 하며, 콜드체인 냉장 택배로 발송합니다.";
}

/** 게시된 소식이 있을 때만 '## 목장 소식' 섹션(+빈 줄). */
function newsSection(news: readonly NewsRow[] | undefined): string[] {
  const block = news && news.length > 0 ? buildNewsLlmsSection([...news]) : "";
  return block ? [...block.trimEnd().split("\n"), ""] : [];
}

/** /llms.txt — 요약판.
 *  llmstxt.org 형식: H1 → 인용 요약 → (제목 없는) 머리말 → H2 '파일 목록'(항목마다 [이름](주소)) → Optional.
 *  링크가 없는 사실(구매 조건·연락처·인용 안내·영문 요약)은 반드시 첫 H2 앞 머리말에 둔다 —
 *  H2 아래에 링크 없는 줄이 있으면 사양을 따르는 파서가 멈춘다(lib/seo/llms.test.ts 가 검사). */
export function buildLlmsTxt(input: LlmsInput): string {
  const products = input.products ?? PUBLIC_PRODUCTS;
  const shipNote = `배송비 회당 ${formatWon(SUB_SHIPPING_KRW)}(제주·도서산간 등 ${formatWon(
    SPECIAL_DELIVERY_SHIPPING_KRW
  )})`;
  const lines = [
    `# ${BRAND.name} ${BRAND.productLine} (${BRAND.alternateNames[0]} · A2 Jersey Hay Milk)`,
    "",
    `> 경기도 안성 ${BRAND.name}의 공식 온라인몰. A2/A2 저지 원유로 만든 우유(A2 저지 헤이밀크)와 마시는 플레인 요거트를 회원 정기구독과 단품 주문으로 판매합니다.`,
    "",
    `${ORG_DESCRIPTION} 제조·판매: ${BUSINESS.company}(대표 ${BUSINESS.ceo}), ${BUSINESS.address}.${certSentence(
      input.certifications
    )}`,
    "",
    "**구매 방법**",
    "",
    `- 정기구독: 회원 전용. 요일별 ${SUB_DAY_CAP}명·총 ${SUB_TOTAL_CAP}명 선착순. 월–금 중 하루를 골라 매주 1회 발송. ${periodWeeksList()}주분 선납, 기간별 할인 ${periodDiscountSentence(
      "·"
    )}. ${shipNote}. 회당 최소 상품 금액 ${formatWon(MIN_ORDER_KRW)}.`,
    `- 단품(1회) 구매: 회원이 아니어도 주문할 수 있습니다. 상품 합계 ${formatWon(
      ONCE_MIN_KRW
    )} 이상, 배송비 ${formatWon(ONCE_SHIPPING_KRW)}(제주·도서산간 등 ${formatWon(SPECIAL_DELIVERY_SHIPPING_KRW)}).`,
    `- ${paymentSentence(input.cardPayment)}`,
    `- 목장 판매장: ${BUSINESS.address}, ${FARM_HOURS}`,
    `- 문의: ${BUSINESS.tel} · 고객센터 ${CS_HOURS.label}`,
    "",
    "**정확한 인용을 위한 안내**",
    "",
    "- 사육 방식은 '사일리지(발효사료) 없는 유럽 전통 헤이밀크 방식'이며 풀과 건초를 중심으로 먹입니다. 유기(유기농) 인증·자유방목 인증 제품이 아닙니다.",
    "- 인증은 모두 농장 인증입니다. '동물복지 인증 우유'·'HACCP 인증 우유'처럼 제품 인증으로 표현하지 않습니다.",
    "- A2 우유는 A2형 베타카제인만 있는 우유입니다. 유당(락토스)은 그대로 들어 있어 무유당 제품이 아닙니다. 송영신목장은 제품의 소화·건강 효능을 표시하지 않습니다.",
    "- 헤이밀크는 유럽연합이 전통특산물(TSG)로 등록한 방식이지만, 송영신목장 제품이 EU 인증을 받은 것은 아닙니다.",
    "",
    `**English summary** — ${BRAND.alternateNames[0]} (${BRAND.name}) in Anseong, Gyeonggi-do, South Korea raises A2/A2 Jersey cows on a silage-free, European-style hay-milk regime (forage of grass and hay). It sells A2 Jersey Hay Milk (pasteurized cow's milk) and a drinkable plain yogurt with no added sugar at ${SITE_URL} through a weekly members-only subscription (capped at ${SUB_TOTAL_CAP} members) and one-off orders. Operator: ${BUSINESS.company} (D2O). Certifications are farm-level, not product-level; not organic-certified.`,
    "",
    "## 제품",
    "",
    ...products.map(productLine),
    "",
    "## 구매·안내",
    "",
    `- [정기구독 신청](${url("/signup")}): 회원 전용 정기구독(요일별 ${SUB_DAY_CAP}명·총 ${SUB_TOTAL_CAP}명)`,
    `- [단품(1회) 구매](${url("/order-once")}): 회원이 아니어도 주문`,
    `- [자주 묻는 질문](${url("/faq")}): A2 우유·유당, 저지, 헤이밀크, 인증, 보관, 가격`,
    `- [배송·교환/환불 안내](${url("/guide")}): 콜드체인 배송, 배송비, 교환·환불 기준`,
    "",
    "## 목장",
    "",
    `- [목장 이야기](${url("/story")}): 사육 방식, 재생농업, 목장 소식`,
    `- [브랜드 홈페이지](${BRAND_HOME}): 송영신목장 소개`,
    `- [안성팜랜드 Hey Hay Milk Café](${CAFE_HOME}): 안성팜랜드 입장 후 바로 좌측`,
    "",
    "## 알아보기",
    "",
    ...learnLlmsLines(),
    "",
    ...newsSection(input.news),
    "## Optional",
    "",
    `- [전체 문답·제품 표시사항](${url("/llms-full.txt")}): 모든 FAQ 와 제품 라벨·영양정보`,
    `- [이용약관](${url("/terms")}): 회원가입·결제·배송·청약철회`,
    `- [개인정보처리방침](${url("/privacy")}): 수집 항목·보유 기간·이용자 권리`,
  ];
  return lines.join("\n") + "\n";
}

/** /llms-full.txt — 요약판 + 전체 문답 + 제품별 표시사항·영양정보. */
export function buildLlmsFullTxt(input: LlmsInput): string {
  const products = input.products ?? PUBLIC_PRODUCTS;
  const faq = [...FAQ_ITEMS, ...moreFaqItems(input.certifications, products)];
  const productBlocks = products.flatMap((p) => [
    `### ${p.name} ${p.volume}`,
    `- 주소: ${url(`/products/${p.id}`)}`,
    `- 식품유형: ${p.label.type}`,
    `- 원재료명 및 함량: ${p.label.ingredients}`,
    `- 내용량: ${p.label.content}`,
    ...(p.label.sterilization ? [`- 살균방법: ${p.label.sterilization}`] : []),
    ...(p.label.cultures ? [`- 유산균수: ${p.label.cultures}`] : []),
    ...(p.label.milkSolids ? [`- 무지유고형분: ${p.label.milkSolids}`] : []),
    `- 보관방법: ${p.label.storage}`,
    `- 소비기한: ${p.label.shelf}`,
    ...(p.label.reportNo ? [`- 품목보고번호: ${p.label.reportNo}`] : []),
    `- 제조원·판매원: ${p.label.maker}`,
    ...(p.nutrition
      ? [
          `- 영양정보(${p.nutrition.basis}): 열량 ${p.nutrition.calories}, ${p.nutrition.rows
            .map((r) => `${r.label} ${r.amount}`)
            .join(", ")}`,
        ]
      : []),
    `- 정가: ${formatWon(p.price)}(${p.taxFree ? "면세" : "부가세 포함"})`,
    "",
  ]);
  return [
    buildLlmsTxt(input).trimEnd(),
    "",
    "## 제품 표시사항·영양정보 (병 라벨과 같은 값)",
    "",
    ...productBlocks,
    "## 자주 묻는 질문 (전문)",
    "",
    ...faq.flatMap((f) => [`### ${f.question}`, f.answer, ""]),
  ].join("\n");
}

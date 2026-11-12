// 검색·AI가 인용할 FAQ 데이터. buildFAQPage(FAQ_ITEMS)의 입력.
// 배송·교환/환불 문구는 app/guide/page.tsx와 일치시킨다(불일치 시 가이드를 진실로 본다).
//
// 금액·할인율·정원은 lib/products.ts 단일 출처에서 끌어온다.
//   이 FAQ 는 화면(FaqSection)·schema.org FAQPage·고객 도우미 세 곳이 함께 읽는다.
//   숫자를 여기 손으로 적어 두면 정책을 바꿀 때 세 곳이 한꺼번에 옛 값을 말한다.
import {
  ONCE_MIN_KRW,
  ONCE_SHIPPING_KRW,
  PERIOD_LABEL,
  SUB_PERIODS,
  SUB_SHIPPING_KRW,
  SUB_TOTAL_CAP,
  formatWon,
  periodDiscountSentence,
  PUBLIC_PRODUCTS,
  type Product,
} from "@/lib/products";
import { SPECIAL_DELIVERY_SHIPPING_KRW } from "@/lib/regions";
import { BUSINESS, FARM_HOURS } from "@/lib/site";
import { certValidityLabel, type Certification } from "@/lib/certifications";

export type FaqItem = { question: string; answer: string };

export const FAQ_ITEMS: readonly FaqItem[] = [
  {
    question: "정기구독은 어떻게 신청하나요?",
    answer:
      `선착순 ${SUB_TOTAL_CAP}인 한정 회원제입니다. 월–금 중 택배 발송 요일 하나를 골라 매주 1회 발송되며(택배 특성상 보통 다음 날 수령), ${SUB_PERIODS.map((m) => PERIOD_LABEL[m]).join("·")} 중 기간을 선택해 그 기간분을 무통장입금으로 선납합니다. 기간이 길수록 할인이 커져 ${periodDiscountSentence("·")}가 적용되며, 배송비는 회당 ${formatWon(SUB_SHIPPING_KRW)}입니다(제주·도서산간 등은 회당 ${formatWon(SPECIAL_DELIVERY_SHIPPING_KRW)}).`,
  },
  {
    question: "배송은 언제 시작되나요?",
    answer:
      "무통장입금이 확인된 다음 날부터 선택하신 요일의 가장 가까운 날에 발송하며, 이후 매주 같은 요일에 신선한 상태로 콜드체인 발송됩니다.",
  },
  {
    question: "우유가 얼마나 신선한가요?",
    answer:
      "아침에 짠 원유를 그날 오후에 가공해, 다음 날 콜드체인으로 보내드립니다. 착유부터 배송까지 시간을 최소화해 가장 신선한 상태로 받으시도록 합니다. 맛있는 요리가 좋은 원료에서 나오듯, 우유는 신선함이 생명이라고 믿습니다.",
  },
  {
    question: "교환이나 환불이 되나요?",
    answer:
      "신선식품 특성상 단순 변심에 의한 교환·환불은 제한될 수 있습니다. 다만 상품에 하자가 있거나 배송 중 문제가 발생한 경우 수령 후 빠른 시일 내에 고객센터로 연락 주시면 교환 또는 환불해 드립니다. 입금 후 발송 준비 전 취소는 전액 환불됩니다.",
  },
  {
    question: "A2 저지 헤이밀크가 무엇인가요?",
    answer:
      "A2 베타카제인만 내는 A2/A2 저지 젖소에서 짠 우유로, 사일리지(발효사료) 없이 풀과 건초를 중심으로 먹여 기릅니다. 경기도 안성 송영신목장에서 직접 짜서 HTST로 살균해 보냅니다.",
  },
  {
    question: "A2 우유는 일반 우유와 무엇이 다른가요? 왜 어떤 분은 우유를 마시면 속이 불편할까요?",
    answer:
      "일반 우유에는 베타카제인 단백질이 A1·A2 두 형태로 섞여 있습니다. 송영신목장은 100% A2 저지 헤이밀크 — A2 베타카제인만 내는 저지젖소에서 짠 우유라 A1이 없습니다. A2 우유가 더 편하게 느껴진다는 분들이 있어 해외에서 주목받아 왔습니다. 다만 A2는 '유당(락토스)'과는 다른 이야기여서, 유당불내증이 있으신 분께 무유당(락토프리)을 대신하지는 않습니다. 체질·알레르기가 있으시면 소량으로 먼저 드셔 보시길 권합니다.",
  },
  {
    question: "A2 저지 우유는 유당(락토스)이 없나요?",
    answer:
      "아니요. A2는 베타카제인 단백질의 '종류'에 대한 것이고, 유당과는 별개입니다. 저희 우유에도 우유 본연의 유당이 들어 있어 무유당(락토프리) 제품이 아닙니다. 유당 때문에 불편하셨던 분이라면 이 점을 참고해 주세요.",
  },
  {
    question: "저지(Jersey) 우유는 일반 우유와 무엇이 다른가요?",
    answer:
      "저지젖소 우유는 유고형분과 유지방이 풍부해 더 진하고 고소하며, 베타카로틴이 많아 옅은 황금빛을 띱니다. 송영신목장은 사일리지(발효사료) 없이 풀과 건초를 중심으로 먹여 기른 헤이밀크(건초우유)로, HTST로 살균하고 균질은 최소화해 우유 본연의 풍미를 살립니다.",
  },
  {
    question: "아이에게 먹여도 될까요?",
    answer:
      "신선하게 짜서 콜드체인으로 보내는 우유라 온 가족이 함께 드시기 좋습니다. 다만 돌(12개월) 이전 영아에게 생우유를 먹이는 경우나 우유 알레르기가 있는 경우에는 전문가와 상의하시길 권합니다.",
  },
  {
    question: "회원이 아니어도 살 수 있나요?",
    answer:
      `네. 정기구독과 별개로 단품(1회) 구매가 가능합니다. 회당 최소 상품 금액 ${formatWon(ONCE_MIN_KRW)} 이상부터 주문하실 수 있으며, 배송비는 ${formatWon(ONCE_SHIPPING_KRW)}입니다(제주·도서산간 등은 ${formatWon(SPECIAL_DELIVERY_SHIPPING_KRW)}).`,
  },
] as const;

// ───────── /faq 페이지 전용 추가 문답(검색·AI 가 실제로 묻는 질문) ─────────
//   홈(FaqSection)·고객 도우미는 위 FAQ_ITEMS 만 쓴다. 아래는 /faq 에서 FAQ_ITEMS 뒤에 이어 붙인다.
//   ★ 모든 숫자·이름·주소·인증은 SSOT 에서 만든다(lib/site.ts · lib/products.ts · lib/certifications.ts).
//   ★ 인증은 '농장' 인증으로만 적는다 — '동물복지 우유'·'HACCP 우유'처럼 제품 인증으로 쓰지 않는다.
//   ★ 인증 목록은 호출부가 오늘(KST) 기준 activeCertifications 로 넘긴다(만료 인증 자동 제외).

const firstLabelPart = (s: string | undefined) => (s ?? "").split(" · ")[0].trim();

export function moreFaqItems(
  certs: readonly Certification[],
  // 가격은 DB 값이어야 한다 — /faq 는 lib/seo/live-catalog.ts 의 livePublicProducts() 를 넘긴다.
  products: readonly Product[] = PUBLIC_PRODUCTS
): FaqItem[] {
  const yogurts = products.filter((p) => p.line === "yogurt");
  const yogurtVolumes = yogurts.map((p) => p.volume.replace(/mL$/i, "")).join("·");
  const certList = certs
    .map((c) => `${c.name}(${c.issuer}, ${c.number}, ${certValidityLabel(c)})`)
    .join(", ");
  const priceList = products.map((p) => `${p.name} ${p.volume} ${formatWon(p.price)}`).join(", ");

  return [
    {
      question: "송영신목장 A2 저지 우유는 어디서 살 수 있나요?",
      answer: `공식 온라인몰(shop.a2jerseymilk.com)에서 회원 정기구독과 단품(1회) 주문으로 판매합니다. ${BUSINESS.address} 목장 판매장(${FARM_HOURS})과 안성팜랜드 안 Hey Hay Milk Café(입장 후 바로 좌측)에서도 만나실 수 있습니다.`,
    },
    {
      question: "헤이밀크(Hay Milk)는 무엇인가요?",
      answer:
        "사일리지(발효사료)를 먹이지 않고 풀과 건초를 중심으로 소를 기르는 유럽 알프스 지역의 전통 낙농 방식(독일어 Heumilch), 또는 그렇게 얻은 우유를 말합니다. 송영신목장은 이 방식을 따라 A2/A2 저지를 기릅니다. 유럽연합이 전통특산물(TSG)로 등록한 방식이지만, 송영신목장 제품이 EU 인증을 받은 것은 아닙니다.",
    },
    ...(certs.length > 0
      ? [
          {
            question: "어떤 인증을 받은 목장인가요? 유기농 우유인가요?",
            answer: `송영신목장은 ${certList}을 받은 젖소 목장입니다. 모두 목장(젖소 사육·착유 단계)에 대한 인증이며 제품 인증이 아닙니다. 유기(유기농) 인증은 받지 않았습니다.`,
          },
        ]
      : []),
    {
      question: "우유 위에 크림층이 생겨요. 괜찮은가요?",
      answer:
        "균질을 최소한으로 해서, 시간이 지나면 병 위쪽에 크림이 떠오를 수 있습니다. 우유 성분이 자연스럽게 나뉜 것이니 드시기 전에 병을 가볍게 흔들어 주세요.",
    },
    ...(yogurts.length > 0
      ? [
          {
            question: "요거트는 떠먹는 타입인가요?",
            answer: `아니요. 송영신목장 A2 저지 플레인 요거트(${yogurtVolumes}mL)는 병째 흔들어 마시는 드링킹 타입입니다. 원재료는 ${firstLabelPart(
              yogurts[0].label.ingredients
            )}이며 설탕을 넣지 않았습니다.`,
          },
        ]
      : []),
    {
      question: "보관과 소비기한은 어떻게 되나요?",
      answer:
        "0~10℃에서 냉장 보관해 주세요. 소비기한은 병에 따로 표기되어 있습니다. 신선식품이라 받으신 뒤 가능한 한 빨리 드시길 권합니다.",
    },
    {
      question: "가격은 얼마인가요?",
      answer: `정가는 ${priceList}입니다. 정기구독 회원가는 기간에 따라 ${periodDiscountSentence(
        "·"
      )} 할인되며, 배송비는 회당 ${formatWon(SUB_SHIPPING_KRW)}(제주·도서산간 등 ${formatWon(
        SPECIAL_DELIVERY_SHIPPING_KRW
      )})입니다. 회원이 아니어도 상품 합계 ${formatWon(ONCE_MIN_KRW)}부터 단품으로 주문하실 수 있습니다.`,
    },
  ];
}

// 손님이 보는 제품 사실이 여러 곳에서 어긋나지 않는지 지킨다.
//
//   [왜] 같은 숫자가 lib/products.ts · lib/seo/faq.ts · 고객 도우미 세 곳에 따로 적혀
//     있었다. 정책을 바꾸면 화면만 맞고 도우미는 옛 값을 계속 말하는 상태가 된다.
//     실제로 요거트는 더 심했다 — 병에 붙는 메모지는 '드링킹 타입'이라고 하는데
//     도우미는 "떠먹는 질감"이라고 안내하고 있었다(#193 이 잡으려던 오해를 되레 키움).
//
//   [무엇] 숫자·표현을 단일 출처에서 끌어 쓰는지 확인한다. 값 자체를 박아 두지 않고
//     PRODUCTS/상수와 대조하므로, 가격이나 할인율을 바꿔도 이 테스트는 따라온다.
import { describe, it, expect } from "vitest";
import {
  ONCE_MIN_KRW,
  ONCE_SHIPPING_KRW,
  PERIOD_DISCOUNT,
  PERIOD_LABEL,
  PUBLIC_PRODUCTS,
  SUB_DAY_CAP,
  SUB_PERIODS,
  SUB_SHIPPING_KRW,
  SUB_TOTAL_CAP,
  formatWon,
  periodDiscountSentence,
} from "@/lib/products";
import { SPECIAL_DELIVERY_SHIPPING_KRW } from "@/lib/regions";
import { FAQ_ITEMS } from "@/lib/seo/faq";
import { buildCustomerSystemPrompt } from "@/lib/assistant/knowledge";

const prompt = buildCustomerSystemPrompt();
const faqText = FAQ_ITEMS.map((f) => `${f.question}\n${f.answer}`).join("\n");
const 손님이_보는_모든_문장 = `${prompt}\n${faqText}`;

const 식품 = PUBLIC_PRODUCTS.filter((p) => p.nutrition);

describe("도우미가 실제 제품 데이터를 말한다", () => {
  it("네 제품의 이름·용량·가격을 그대로 안내한다", () => {
    for (const p of PUBLIC_PRODUCTS.filter((x) => !x.onceOnly)) {
      expect(prompt, `${p.id} 이름`).toContain(p.name);
      expect(prompt, `${p.id} 용량`).toContain(p.volume);
      expect(prompt, `${p.id} 가격`).toContain(formatWon(p.price));
    }
  });

  it("병 라벨의 총 열량을 제품별로 안내한다", () => {
    for (const p of 식품) {
      expect(prompt, `${p.id} 열량`).toContain(`${p.kcal} kcal`);
    }
  });

  it("배송비·최소금액·정원을 상수 그대로 안내한다", () => {
    for (const [값, 라벨] of [
      [SUB_SHIPPING_KRW, "구독 배송비"],
      [SPECIAL_DELIVERY_SHIPPING_KRW, "특수배송지역 배송비"],
      [ONCE_MIN_KRW, "단품 최소금액"],
      [ONCE_SHIPPING_KRW, "단품 배송비"],
    ] as const) {
      expect(prompt, 라벨).toContain(formatWon(값));
    }
    expect(prompt).toContain(String(SUB_DAY_CAP));
    expect(prompt).toContain(String(SUB_TOTAL_CAP));
  });

  it("기간별 할인율을 상수 그대로 안내한다", () => {
    for (const m of SUB_PERIODS) {
      const 퍼센트 = `${Math.round(PERIOD_DISCOUNT[m] * 100)}%`;
      expect(prompt, `${PERIOD_LABEL[m]} 할인`).toContain(퍼센트);
    }
  });
});

describe("FAQ 도 같은 출처를 쓴다", () => {
  it("배송비·단품 최소금액이 상수와 일치한다", () => {
    expect(faqText).toContain(formatWon(SUB_SHIPPING_KRW));
    expect(faqText).toContain(formatWon(SPECIAL_DELIVERY_SHIPPING_KRW));
    expect(faqText).toContain(formatWon(ONCE_MIN_KRW));
  });

  it("할인 문구가 공용 문장과 일치한다", () => {
    expect(faqText).toContain(periodDiscountSentence("·"));
  });

  it("정기구독 정원이 상수와 일치한다", () => {
    expect(faqText).toContain(`${SUB_TOTAL_CAP}인`);
  });
});

describe("요거트는 '마시는 타입'으로 일관되게 말한다", () => {
  const 요거트 = PUBLIC_PRODUCTS.filter((p) => p.line === "yogurt");

  it("두 요거트 모두 드링킹 타입 메모지를 단다", () => {
    expect(요거트.length).toBeGreaterThan(0);
    for (const p of 요거트) {
      expect(p.sticker?.title, `${p.id} 메모지`).toBe("드링킹 타입");
    }
  });

  it("도우미가 '떠먹는' 제형이라고 말하지 않는다", () => {
    // '떠먹는 꾸덕한 타입이 아니라' 처럼 부정문으로만 등장해야 한다.
    for (const 줄 of 손님이_보는_모든_문장.split("\n")) {
      if (!줄.includes("떠먹")) continue;
      expect(줄, `떠먹는다고 단정한 문장: ${줄.trim()}`).toMatch(/떠먹[^.]*(아니|오해)/);
    }
  });

  it("요거트를 '통'이라 부르지 않는다 — 넷 다 같은 PET 병이다", () => {
    for (const p of 요거트) {
      const 사실 = [
        ...p.specs.map((s) => `${s.label} ${s.value}`),
        p.signature?.topLabel ?? "",
        p.shortDesc,
      ].join(" | ");
      expect(사실, `${p.id}`).not.toMatch(/통/);
    }
  });
});

describe("병 라벨에 인쇄된 표시가 데이터에도 있다", () => {
  it("네 제품 모두 '경기도 퀸스저지'를 싣는다", () => {
    for (const p of 식품) {
      const 값 = p.specs.map((s) => s.value).join(" | ");
      expect(값, `${p.id}`).toContain("경기도 퀸스저지");
    }
  });

  it("label.content 의 열량이 kcal 필드와 일치한다", () => {
    for (const p of 식품) {
      expect(p.label.content, `${p.id}`).toContain(`${p.kcal} kcal`);
      expect(p.label.content, `${p.id} 용량`).toContain(p.volume.replace("mL", " mL"));
    }
  });

  it("specs 의 열량 표기가 kcal 필드와 일치한다", () => {
    for (const p of 식품) {
      const 열량 = p.specs.find((s) => s.label === "열량");
      expect(열량, `${p.id} 열량 행`).toBeDefined();
      expect(열량!.value, `${p.id}`).toContain(`${p.kcal} kcal`);
    }
  });
});

describe("요거트 유산균 수치가 서로 맞는다", () => {
  it("총 CFU = 1mL당 7.2억 × 용량", () => {
    for (const p of PUBLIC_PRODUCTS.filter((x) => x.line === "yogurt")) {
      const mL = Number(p.volume.replace("mL", ""));
      const 총억 = 7.2 * mL; // 억 단위
      expect(p.label.cultures, `${p.id}`).toContain("1 mL당 7.2억 CFU");
      expect(p.label.cultures, `${p.id} 총량`).toContain(
        `${총억.toLocaleString("en-US")}억 CFU`
      );
      expect(p.sticker?.sub, `${p.id} 메모지`).toContain("7.2억 CFU/mL");
    }
  });
});

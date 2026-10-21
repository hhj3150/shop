import { describe, it, expect } from "vitest";
import {
  selectRecipients,
  type RecipientOrder,
  type RecipientProfile,
  type RecipientSlot,
} from "./broadcast-recipients";

// id 는 문자열이라 번호로 쓸 수 없으므로, 호출 순서대로 유효한 11자리 번호를 붙인다.
let phoneSeq = 0;
function profile(id: string, consent = false): RecipientProfile {
  phoneSeq += 1;
  return {
    id,
    name: id,
    phone: `010${String(phoneSeq).padStart(8, "0")}`,
    marketing_consent: consent,
  };
}

describe("selectRecipients — 필터 매칭", () => {
  const profiles = [profile("1"), profile("2"), profile("3"), profile("4")];
  const slots: RecipientSlot[] = [
    { user_id: "1", delivery_day: "mon", status: "활성" },
    { user_id: "2", delivery_day: "wed", status: "해지" }, // 과거 구독자
  ];
  const orders: RecipientOrder[] = [
    { user_id: "3", order_type: "단품", status: "배송완료" },
    { user_id: "4", order_type: "단품", status: "취소" }, // 취소 주문은 이력으로 안 침
  ];

  it("아무 필터도 없으면 아무도 고르지 않는다", () => {
    const r = selectRecipients({ profiles, slots, orders, filters: [], isAd: false });
    expect(r.candidates).toHaveLength(0);
    expect(r.adExcluded).toBe(0);
  });

  it("active 는 활성 구독자만", () => {
    const r = selectRecipients({ profiles, slots, orders, filters: ["active"], isAd: false });
    expect(r.candidates.map((p) => p.id)).toEqual(["1"]);
  });

  it("once 는 취소 아닌 단품 주문자만 — 취소 주문자는 빠진다", () => {
    const r = selectRecipients({ profiles, slots, orders, filters: ["once"], isAd: false });
    expect(r.candidates.map((p) => p.id)).toEqual(["3"]);
  });

  it("customer 는 구독 이력(해지 포함) + 주문 이력 합집합", () => {
    const r = selectRecipients({ profiles, slots, orders, filters: ["customer"], isAd: false });
    expect(r.candidates.map((p) => p.id)).toEqual(["1", "2", "3"]);
  });

  it("nosub 는 구독 슬롯이 한 번도 없던 회원만", () => {
    const r = selectRecipients({ profiles, slots, orders, filters: ["nosub"], isAd: false });
    expect(r.candidates.map((p) => p.id)).toEqual(["3", "4"]);
  });

  it("요일 필터는 그 요일 활성 구독자만", () => {
    const r = selectRecipients({ profiles, slots, orders, filters: ["mon"], isAd: false });
    expect(r.candidates.map((p) => p.id)).toEqual(["1"]);
    const wed = selectRecipients({ profiles, slots, orders, filters: ["wed"], isAd: false });
    expect(wed.candidates).toHaveLength(0); // 해지 슬롯은 요일 명단에 안 잡힌다
  });

  it("여러 필터는 합집합이고 중복은 한 번만", () => {
    const r = selectRecipients({
      profiles,
      slots,
      orders,
      filters: ["active", "mon", "once"],
      isAd: false,
    });
    expect(r.candidates.map((p) => p.id)).toEqual(["1", "3"]);
  });

  it("번호가 없거나 자릿수가 안 맞으면 제외한다", () => {
    const bad: RecipientProfile[] = [
      { id: "9", name: "번호없음", phone: "" },
      { id: "8", name: "짧음", phone: "0101" },
      { id: "7", name: "정상", phone: "01012345678" },
    ];
    const r = selectRecipients({ profiles: bad, slots: [], orders: [], filters: ["all"], isAd: false });
    expect(r.candidates.map((p) => p.id)).toEqual(["7"]);
  });
});

describe("selectRecipients — 광고 동의 필터와 제외 인원 노출", () => {
  const profiles = [profile("1", true), profile("2", false), profile("3", false)];
  const slots: RecipientSlot[] = [
    { user_id: "1", delivery_day: "mon", status: "활성" },
    { user_id: "2", delivery_day: "mon", status: "활성" },
    { user_id: "3", delivery_day: "mon", status: "활성" },
  ];

  it("공지(비광고)는 동의와 무관하게 전원에게 간다", () => {
    const r = selectRecipients({ profiles, slots, orders: [], filters: ["active"], isAd: false });
    expect(r.candidates).toHaveLength(3);
    expect(r.adExcluded).toBe(0);
  });

  it("광고면 동의자만 남기고, 잘려나간 인원수를 함께 돌려준다", () => {
    const r = selectRecipients({ profiles, slots, orders: [], filters: ["active"], isAd: true });
    expect(r.candidates.map((p) => p.id)).toEqual(["1"]);
    expect(r.matched).toHaveLength(3); // 필터에는 3명이 걸렸다는 사실이 보존된다
    expect(r.adExcluded).toBe(2);
  });

  it("marketing_consent 가 undefined 면 미동의로 본다(광고 발송 시)", () => {
    const unknown: RecipientProfile[] = [{ id: "1", name: "미상", phone: "01012345678" }];
    const r = selectRecipients({
      profiles: unknown,
      slots: [],
      orders: [],
      filters: ["all"],
      isAd: true,
    });
    expect(r.candidates).toHaveLength(0);
    expect(r.adExcluded).toBe(1);
  });
});

// 2026-08-12 실사고 재현 — 하절기 휴가 안내가 「광고」로 나가 구매 고객 절반이 못 받았다.
//   축소 모형: 구매 고객 4명(동의 2) + 구매 이력 없는 가입자 2명(동의 2).
describe("2026-08-12 하절기 휴가 안내 미수신 사고 재현", () => {
  const profiles: RecipientProfile[] = [
    profile("sub-yes", true), // 구독 · 동의
    profile("sub-no1", false), // 구독 · 미동의  ← 못 받은 사람
    profile("sub-no2", false), // 구독 · 미동의  ← 못 받은 사람
    profile("once-yes", true), // 단품 · 동의
    profile("signup-a", true), // 아무것도 안 삼 · 동의
    profile("signup-b", true), // 아무것도 안 삼 · 동의
  ];
  const slots: RecipientSlot[] = [
    { user_id: "sub-yes", delivery_day: "mon", status: "활성" },
    { user_id: "sub-no1", delivery_day: "mon", status: "활성" },
    { user_id: "sub-no2", delivery_day: "tue", status: "활성" },
  ];
  const orders: RecipientOrder[] = [
    { user_id: "once-yes", order_type: "단품", status: "배송완료" },
  ];

  it("사고 재현 — 전체 회원 + 광고: 구매 고객 절반이 빠지고 가입자만 채워진다", () => {
    const r = selectRecipients({ profiles, slots, orders, filters: ["all"], isAd: true });
    expect(r.candidates.map((p) => p.id)).toEqual([
      "sub-yes",
      "once-yes",
      "signup-a",
      "signup-b",
    ]);
    // 구매 고객 4명 중 2명이 못 받았는데, 발송 인원은 4명이라 겉으로는 멀쩡해 보인다.
    expect(r.adExcluded).toBe(2); // ← 이 수치를 화면에 띄워야 사고를 알아챈다
  });

  it("교정 — 구매 고객 전체 + 공지(비광고): 구매 고객 4명 전원, 가입자는 제외", () => {
    const r = selectRecipients({ profiles, slots, orders, filters: ["customer"], isAd: false });
    expect(r.candidates.map((p) => p.id)).toEqual([
      "sub-yes",
      "sub-no1",
      "sub-no2",
      "once-yes",
    ]);
    expect(r.adExcluded).toBe(0);
  });
});

import { describe, it, expect } from "vitest";
import { orderFingerprint, idempotencyKeyFor } from "./idempotency";

// 실제 주문 payload 를 닮은 fixture.
const base = {
  items: [{ productId: "milk-180", qty: 2, unitPrice: 10000 }],
  period: 3,
  ship: {
    name: "홍길동",
    phone: "01012345678",
    postcode: "12345",
    address: "서울시 어딘가",
    addressDetail: "101호",
    depositorName: "홍길동",
  },
  deliveryMethod: "택배",
  isGift: false,
  cashReceiptType: "발행안함",
  useReferralCredit: true,
};

const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

describe("orderFingerprint", () => {
  it("같은 내용이면 같은 지문 — 더블클릭·재시도가 주문을 두 번 만들지 않는다", () => {
    expect(orderFingerprint(base)).toBe(orderFingerprint(clone(base)));
  });

  it("키 순서가 달라도 같은 지문", () => {
    const reordered = {
      useReferralCredit: true,
      cashReceiptType: "발행안함",
      isGift: false,
      deliveryMethod: "택배",
      ship: {
        depositorName: "홍길동",
        addressDetail: "101호",
        address: "서울시 어딘가",
        postcode: "12345",
        phone: "01012345678",
        name: "홍길동",
      },
      period: 3,
      items: [{ unitPrice: 10000, qty: 2, productId: "milk-180" }],
    };
    expect(orderFingerprint(reordered)).toBe(orderFingerprint(base));
  });

  it("undefined 필드는 없는 것과 같다", () => {
    expect(orderFingerprint({ ...base, memo: undefined })).toBe(orderFingerprint(base));
  });

  // ── 아래가 이 파일의 이유 — 하나라도 바뀌면 지문이 달라져야 한다 ──
  const changes: Array<[string, unknown]> = [
    ["수량", { ...base, items: [{ productId: "milk-180", qty: 4, unitPrice: 10000 }] }],
    ["품목", { ...base, items: [{ productId: "milk-900", qty: 2, unitPrice: 10000 }] }],
    ["단가", { ...base, items: [{ productId: "milk-180", qty: 2, unitPrice: 11000 }] }],
    ["품목 추가", {
      ...base,
      items: [
        { productId: "milk-180", qty: 2, unitPrice: 10000 },
        { productId: "milk-900", qty: 1, unitPrice: 20000 },
      ],
    }],
    ["구독 기간", { ...base, period: 6 }],
    ["배송지 주소", { ...base, ship: { ...base.ship, address: "부산시 다른곳" } }],
    ["상세주소", { ...base, ship: { ...base.ship, addressDetail: "202호" } }],
    ["연락처", { ...base, ship: { ...base.ship, phone: "01099998888" } }],
    ["입금자명", { ...base, ship: { ...base.ship, depositorName: "김철수" } }],
    ["배송방법", { ...base, deliveryMethod: "방문수령" }],
    ["선물 여부", { ...base, isGift: true }],
    ["현금영수증", { ...base, cashReceiptType: "소득공제" }],
    ["쿠폰 사용 토글", { ...base, useReferralCredit: false }],
  ];

  it.each(changes)("%s 가 바뀌면 지문도 바뀐다", (_label, changed) => {
    expect(orderFingerprint(changed)).not.toBe(orderFingerprint(base));
  });

  it("품목 순서가 바뀌면 다른 지문 — 배열은 순서를 의미로 본다", () => {
    const a = { items: [{ productId: "a" }, { productId: "b" }] };
    const b = { items: [{ productId: "b" }, { productId: "a" }] };
    expect(orderFingerprint(a)).not.toBe(orderFingerprint(b));
  });
});

describe("idempotencyKeyFor", () => {
  const nonce = "11111111-2222-3333-4444-555555555555";

  it("내용이 같으면 같은 키", () => {
    expect(idempotencyKeyFor(nonce, base)).toBe(idempotencyKeyFor(nonce, clone(base)));
  });

  it("★회귀: 결제 취소 후 수량을 바꿔 재제출하면 키가 달라진다", () => {
    // 옛 동작: 키가 그대로라 서버가 '옛 주문'을 돌려줘 옛 금액으로 결제됐다.
    const changed = { ...base, items: [{ productId: "milk-180", qty: 4, unitPrice: 10000 }] };
    expect(idempotencyKeyFor(nonce, changed)).not.toBe(idempotencyKeyFor(nonce, base));
  });

  it("주문 접수 후 nonce 가 돌면, 같은 구성으로 다시 주문할 수 있다", () => {
    const next = "99999999-8888-7777-6666-555555555555";
    expect(idempotencyKeyFor(next, base)).not.toBe(idempotencyKeyFor(nonce, base));
  });

  it("키는 nonce 로 시작한다(디버깅 시 세션 추적용)", () => {
    expect(idempotencyKeyFor(nonce, base).startsWith(`${nonce}-`)).toBe(true);
  });
});

import { describe, it, expect } from "vitest";
import {
  basicAuthHeader,
  returnSignature,
  responseSignature,
  sha256Hex,
  verifyAuthResult,
  verifyResponseSignature,
  parseAuthResult,
  paymentTaxFreeAmount,
  planCancel,
  webhookDedupeKey,
  goodsNameFor,
  cancelOrderIdFor,
  type AuthResult,
  type OrderForTax,
} from "./core";

const CID = "S2_testclient";
const SK = "testsecretkey";

describe("서명·인증 (매뉴얼 공식)", () => {
  it("Basic 인증은 매뉴얼 예시와 같다", () => {
    // common/api.md 예시값
    expect(basicAuthHeader("af0d116236df437f831483ee9c500bc4", "433a8421be754b34989048cf148a5ffc")).toBe(
      "Basic YWYwZDExNjIzNmRmNDM3ZjgzMTQ4M2VlOWM1MDBiYzQ6NDMzYTg0MjFiZTc1NGIzNDk4OTA0OGNmMTQ4YTVmZmM="
    );
  });
  it("returnUrl 서명 = sha256(authToken+clientId+amount+secret)", () => {
    expect(returnSignature("tok", CID, 15000, SK)).toBe(sha256Hex(`tok${CID}15000${SK}`));
  });
  it("응답 서명 = sha256(tid+amount+ediDate+secret)", () => {
    expect(responseSignature("T1", 15000, "2026-11-21T10:00:00.000+0900", SK)).toBe(
      sha256Hex(`T115000${"2026-11-21T10:00:00.000+0900"}${SK}`)
    );
  });
});

function auth(over: Partial<AuthResult> = {}): AuthResult {
  const base: AuthResult = {
    authResultCode: "0000",
    authResultMsg: "인증 성공",
    tid: "TID1",
    clientId: CID,
    orderId: "SY20261121-AAAA",
    amount: 15000,
    authToken: "AUTHTOKEN",
    signature: "",
    mallReserved: "",
  };
  const r = { ...base, ...over };
  if (!over.signature) r.signature = returnSignature(r.authToken, CID, r.amount, SK);
  return r;
}

describe("returnUrl 검증 — 승인 전에 거른다", () => {
  it("정상", () => expect(verifyAuthResult(auth(), CID, SK, 15000)).toEqual({ ok: true }));
  it("고객이 결제창을 닫음(결과코드 ≠ 0000)", () =>
    expect(verifyAuthResult(auth({ authResultCode: "I002" }), CID, SK, 15000)).toEqual({ ok: false, reason: "auth_failed" }));
  it("금액 위변조: 서명은 맞지만 DB 금액과 다르면 승인하지 않는다", () =>
    expect(verifyAuthResult(auth({ amount: 100 }), CID, SK, 15000)).toEqual({ ok: false, reason: "amount_mismatch" }));
  it("금액만 바꾸고 서명은 그대로면 서명 불일치", () => {
    const r = auth();
    expect(verifyAuthResult({ ...r, amount: 100 }, CID, SK, 100)).toEqual({ ok: false, reason: "bad_signature" });
  });
  it("다른 상점 clientId", () =>
    expect(verifyAuthResult(auth({ clientId: "OTHER" }), CID, SK, 15000)).toEqual({ ok: false, reason: "client_mismatch" }));
  it("폼 파싱", () => {
    const f = new FormData();
    f.set("authResultCode", "0000");
    f.set("amount", "15000");
    f.set("tid", "T");
    expect(parseAuthResult(f)).toMatchObject({ authResultCode: "0000", amount: 15000, tid: "T", orderId: "" });
  });
});

describe("승인·웹훅 응답 서명", () => {
  const p = { tid: "T1", amount: 15000, ediDate: "2026-11-21T10:00:00.000+0900", status: "paid" };
  it("맞는 서명", () => expect(verifyResponseSignature({ ...p, signature: responseSignature(p.tid, p.amount, p.ediDate, SK) }, SK)).toBe(true));
  it("금액을 바꾼 위조 통보", () =>
    expect(verifyResponseSignature({ ...p, amount: 1, signature: responseSignature(p.tid, p.amount, p.ediDate, SK) }, SK)).toBe(false));
  it("서명 없음", () => expect(verifyResponseSignature(p, SK)).toBe(false));
});

// 우유 180 ×2(면세 3,500) + 요거트 500 ×1(과세 10,000) + 배송비 4,000 (과세 품목이 있으니 배송비 과세)
const mixed: OrderForTax = {
  items: [
    { product_id: "milk-180", unit_price: 3500, qty: 2 },
    { product_id: "yogurt-500", unit_price: 10000, qty: 1 },
  ],
  total_amount: 21000,
  shipping_fee: 4000,
};

describe("면세금액", () => {
  it("혼합 주문: 우유만 면세, 배송비는 과세", () => expect(paymentTaxFreeAmount(mixed)).toBe(7000));
  it("우유만: 배송비까지 면세", () =>
    expect(paymentTaxFreeAmount({ items: [{ product_id: "milk-750", unit_price: 12000, qty: 2 }], total_amount: 28000, shipping_fee: 4000 })).toBe(28000));
  it("구독: 회당 수량 × 주수", () =>
    expect(
      paymentTaxFreeAmount({
        items: [
          { product_id: "milk-180", unit_price: 3500, qty: 2 },
          { product_id: "yogurt-180", unit_price: 4300, qty: 1 },
        ],
        total_amount: (7000 + 4300) * 4,
        block_weeks: 4,
        shipping_fee: 0,
      })
    ).toBe(28000));
});

describe("취소 계획 — 금액·면세금액은 서버가 정한다", () => {
  const base = { order: mixed, paidAmount: 21000, paidTaxFree: 7000, cancelledAmt: 0, cancelledTaxFree: 0 };

  it("전체취소: 남은 금액·면세 전부", () =>
    expect(planCancel({ ...base, mode: "full" })).toEqual({ ok: true, full: true, cancelAmt: 21000, taxFreeAmt: 7000 }));

  it("부분취소(과세+면세 혼합): 우유 1 + 요거트 1 → 13,500 중 면세 3,500", () => {
    const r = planCancel({
      ...base,
      mode: "items",
      items: [
        { product_id: "milk-180", qty: 1 },
        { product_id: "yogurt-500", qty: 1 },
      ],
      includeShipping: false,
    });
    expect(r).toMatchObject({ ok: true, full: false, cancelAmt: 13500, taxFreeAmt: 3500 });
  });

  it("두 번째 부분취소가 잔액 전부면 남은 면세를 정확히 털어낸다", () => {
    const r = planCancel({
      ...base,
      cancelledAmt: 13500,
      cancelledTaxFree: 3500,
      mode: "items",
      items: [{ product_id: "milk-180", qty: 1 }],
      includeShipping: true,
    });
    expect(r).toMatchObject({ ok: true, cancelAmt: 7500, taxFreeAmt: 3500 });
  });

  it("주문 수량보다 많이 취소하려 하면 거절", () =>
    expect(planCancel({ ...base, mode: "items", items: [{ product_id: "milk-180", qty: 3 }], includeShipping: false }).ok).toBe(false));

  it("금액 입력: 원 결제 면세 비율(1/3)", () =>
    expect(planCancel({ ...base, mode: "amount", amount: 6000 })).toMatchObject({ ok: true, cancelAmt: 6000, taxFreeAmt: 2000 }));

  it("취소 가능 금액 초과는 거절", () => expect(planCancel({ ...base, cancelledAmt: 20000, mode: "amount", amount: 2000 }).ok).toBe(false));

  it("이미 전액 취소", () => expect(planCancel({ ...base, cancelledAmt: 21000, mode: "full" }).ok).toBe(false));

  it("적립금 차감 주문(정가 25,000 → 실결제 21,000)도 같은 비율로 줄인다", () => {
    const disc = { ...mixed, total_amount: 21000, shipping_fee: 4000 };
    disc.items = [
      { product_id: "milk-180", unit_price: 3500, qty: 2 },
      { product_id: "yogurt-500", unit_price: 10000, qty: 1 },
      { product_id: "yogurt-180", unit_price: 4000, qty: 1 },
    ];
    const r = planCancel({ ...base, order: disc, mode: "items", items: [{ product_id: "milk-180", qty: 2 }], includeShipping: false });
    // 7,000 × 21000/25000 = 5,880
    expect(r).toMatchObject({ ok: true, cancelAmt: 5880, taxFreeAmt: 5880 });
  });
});

describe("기타", () => {
  it("웹훅 중복 키: 같은 통보는 같은 키, 부분취소 회차는 다른 키", () => {
    const a = { tid: "T", status: "paid", balanceAmt: 21000, ediDate: "x" };
    expect(webhookDedupeKey(a)).toBe(webhookDedupeKey({ ...a }));
    expect(webhookDedupeKey({ ...a, status: "partialCancelled", cancelledTid: "C1", balanceAmt: 7500 })).not.toBe(
      webhookDedupeKey({ ...a, status: "partialCancelled", cancelledTid: "C2", balanceAmt: 0 })
    );
  });
  it("상품명: 40자·따옴표/파이프 치환", () => {
    expect(goodsNameFor(['A2 "저지" 헤이밀크|180mL', "B"])).toBe("A2 -저지- 헤이밀크-180mL 외 1건");
    expect(goodsNameFor(["가".repeat(50)]).length).toBe(40);
  });
  it("부분취소 orderId 는 회차마다 다르다", () => expect(cancelOrderIdFor("SY1", 1)).not.toBe(cancelOrderIdFor("SY1", 2)));
});

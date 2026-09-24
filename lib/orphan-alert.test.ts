import { describe, it, expect } from "vitest";
import { buildOrphanAlertText, type OrphanReason } from "./orphan-alert";

describe("buildOrphanAlertText", () => {
  it("주문번호·수령인·금액·수단을 모두 포함한다", () => {
    const text = buildOrphanAlertText({
      orderNo: "A1B2-3C4D",
      shipName: "김종민",
      shipPhone: "01012345678",
      paidAmount: 64000,
      payMethod: "무통장입금",
    });
    expect(text).toContain("고아입금");
    expect(text).toContain("A1B2-3C4D");
    expect(text).toContain("김종민");
    expect(text).toContain("01012345678");
    expect(text).toContain("64,000원"); // 천단위 콤마
    expect(text).toContain("무통장입금");
  });

  it("누락 필드는 안전한 기본 문구로 대체한다", () => {
    const text = buildOrphanAlertText({
      orderNo: "X9",
      shipName: null,
      shipPhone: null,
      paidAmount: null,
      payMethod: null,
    });
    expect(text).toContain("X9");
    expect(text).toContain("이름미상");
    expect(text).toContain("연락처미상");
    expect(text).toContain("금액미상");
    expect(text).toContain("수단미상");
  });

  // ── 사유별 안내 ──
  //   문자를 받은 사람이 바로 움직일 수 있어야 한다. 사유마다 해야 할 일이 다르다.
  const base = {
    orderNo: "A1",
    shipName: "홍길동",
    shipPhone: "01011112222",
    paidAmount: 100000,
    payMethod: "무통장입금",
  };

  it("사유가 없으면 기존처럼 '취소주문'으로 안내한다(옛 RPC 호환)", () => {
    const text = buildOrphanAlertText(base);
    expect(text).toContain("취소주문");
    expect(text).toContain("이미 취소된 주문에 입금이 확인됐습니다");
  });

  it("해지구독연장 — 회차가 반영되지 않았음을 알린다", () => {
    const text = buildOrphanAlertText({ ...base, reason: "해지구독연장" });
    expect(text).toContain("해지구독연장");
    expect(text).toContain("회차는 더해지지 않았고");
    expect(text).toContain("환불 또는 재구독");
  });

  it("연장좌석충돌 — 입금은 됐지만 좌석 이동이 막혔음을 알린다", () => {
    const text = buildOrphanAlertText({ ...base, reason: "연장좌석충돌" });
    expect(text).toContain("연장좌석충돌");
    expect(text).toContain("요일 좌석 이동이 막혀");
  });

  it("사유마다 본문이 서로 다르다 — 같은 문구를 받으면 구분이 안 된다", () => {
    const reasons: OrphanReason[] = ["취소주문", "해지구독연장", "연장좌석충돌"];
    const texts = reasons.map((reason) => buildOrphanAlertText({ ...base, reason }));
    expect(new Set(texts).size).toBe(reasons.length);
  });
});

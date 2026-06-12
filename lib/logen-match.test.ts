import { describe, it, expect } from "vitest";
import { matchLogen, normalizeName } from "./logen-match";
import type { LogenRow } from "./logen-excel";

const row = (p: Partial<LogenRow>): LogenRow =>
  ({ tracking: "T1", recipientName: "", phone7: "", orderNo: "", ...p });
const ord = (id: string, name: string, phone: string, tracking: string | null = null) =>
  ({ id, order_no: id, ship_name: name, ship_phone: phone, tracking_no: tracking });

describe("normalizeName", () => {
  it("직함·괄호·공백 제거", () => {
    expect(normalizeName("이일석대표")).toBe("이일석");
    expect(normalizeName("박미영(문성권)")).toBe("박미영");
    expect(normalizeName(" 김 태연 ")).toBe("김태연");
  });
});

describe("matchLogen", () => {
  const orders = [
    ord("A", "김태연", "010-7663-1234"),
    ord("B", "윤화영", "010-6408-9999"),
  ];

  it("휴대폰7+이름 일치 → high matched", () => {
    const r = matchLogen([row({ tracking: "44538341186", recipientName: "김태연", phone7: "0107663" })], orders);
    expect(r.matched).toEqual([{ rowIdx: 0, orderId: "A", tracking: "44538341186", confidence: "high" }]);
    expect(r.unmatched).toHaveLength(0);
  });

  it("휴대폰7 일치·이름 불일치 → review", () => {
    const r = matchLogen([row({ tracking: "T", recipientName: "다른이름", phone7: "0107663" })], orders);
    expect(r.matched[0].confidence).toBe("review");
  });

  it("+82 폰도 정규화로 매칭(주문 폰이 +82형)", () => {
    const o = [ord("A", "김태연", "+82 10-7663-1234")];
    const r = matchLogen([row({ recipientName: "김태연", phone7: "0107663" })], o);
    expect(r.matched[0].orderId).toBe("A");
  });

  it("휴대폰7 무효 → unmatched", () => {
    const r = matchLogen([row({ recipientName: "김태연", phone7: "" })], orders);
    expect(r.unmatched).toHaveLength(1);
    expect(r.matched).toHaveLength(0);
  });

  it("한 행이 2주문과 휴대폰7 일치 → ambiguous", () => {
    const o = [ord("A", "김태연", "010-7663-1111"), ord("C", "다른", "010-7663-2222")];
    const r = matchLogen([row({ recipientName: "김태연", phone7: "0107663" })], o);
    expect(r.ambiguous[0].candidateOrderIds.sort()).toEqual(["A", "C"]);
    expect(r.matched).toHaveLength(0);
  });

  it("두 행이 한 주문 점유 → 둘 다 ambiguous", () => {
    const rows = [
      row({ tracking: "T1", recipientName: "김태연", phone7: "0107663" }),
      row({ tracking: "T2", recipientName: "김태연", phone7: "0107663" }),
    ];
    const r = matchLogen(rows, [ord("A", "김태연", "010-7663-1234")]);
    expect(r.ambiguous).toHaveLength(2);
    expect(r.matched).toHaveLength(0);
  });

  it("주문에 송장 이미 있으면 alreadyFilled", () => {
    const o = [ord("A", "김태연", "010-7663-1234", "99999999999")];
    const r = matchLogen([row({ tracking: "T", recipientName: "김태연", phone7: "0107663" })], o);
    expect(r.alreadyFilled[0].orderId).toBe("A");
    expect(r.matched).toHaveLength(0);
  });

  it("col8 주문번호 정확매칭 우선", () => {
    const r = matchLogen([row({ tracking: "T", orderNo: "B", recipientName: "윤화영", phone7: "" })], orders);
    expect(r.matched[0].orderId).toBe("B");
  });

  it("order_no 중복이면 정확매칭도 ambiguous", () => {
    const o = [ord("A", "김태연", "010-1111-1111"), { id: "A2", order_no: "A", ship_name: "딴사람", ship_phone: "010-2222-2222", tracking_no: null }];
    const r = matchLogen([row({ tracking: "T", orderNo: "A", phone7: "" })], o);
    expect(r.ambiguous[0].candidateOrderIds.sort()).toEqual(["A", "A2"]);
    expect(r.matched).toHaveLength(0);
  });
});

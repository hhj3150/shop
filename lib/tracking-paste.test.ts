import { describe, it, expect } from "vitest";
import { parseTrackingPaste, matchTracking } from "./tracking-paste";

describe("parseTrackingPaste", () => {
  it("탭 구분(엑셀) 2열을 파싱", () => {
    const r = parseTrackingPaste("SY-1001\t123456789012\nSY-1002\t987654321098");
    expect(r).toEqual([
      { orderNo: "SY-1001", tracking: "123456789012" },
      { orderNo: "SY-1002", tracking: "987654321098" },
    ]);
  });

  it("콤마(CSV) 구분도 파싱", () => {
    const r = parseTrackingPaste("SY-1001,123456789012");
    expect(r).toEqual([{ orderNo: "SY-1001", tracking: "123456789012" }]);
  });

  it("단일 공백 구분도 파싱", () => {
    const r = parseTrackingPaste("SY-1001 123456789012");
    expect(r).toEqual([{ orderNo: "SY-1001", tracking: "123456789012" }]);
  });

  it("택배사 열이 끼어도 숫자 송장 토큰을 고른다", () => {
    const r = parseTrackingPaste("SY-1001\t한진택배\t123456789012");
    expect(r).toEqual([{ orderNo: "SY-1001", tracking: "123456789012" }]);
  });

  it("헤더 행(송장번호 숫자 없음)은 건너뛴다", () => {
    const r = parseTrackingPaste("주문번호\t송장번호\nSY-1001\t123456789012");
    expect(r).toEqual([{ orderNo: "SY-1001", tracking: "123456789012" }]);
  });

  it("빈 줄·공백 줄은 무시", () => {
    const r = parseTrackingPaste("\n  \nSY-1001\t123456789012\n\n");
    expect(r).toHaveLength(1);
  });

  it("송장번호의 하이픈/공백은 제거", () => {
    const r = parseTrackingPaste("SY-1001\t1234-5678-9012");
    expect(r[0].tracking).toBe("1234-5678-9012".replace(/\s/g, ""));
  });

  it("같은 주문번호 중복은 마지막 값 채택", () => {
    const r = parseTrackingPaste("SY-1001\t111111\nSY-1001\t222222");
    expect(r).toEqual([{ orderNo: "SY-1001", tracking: "222222" }]);
  });

  it("5자리 이하 숫자는 송장으로 보지 않음(미파싱)", () => {
    expect(parseTrackingPaste("SY-1001\t1234")).toEqual([]);
  });
});

describe("matchTracking", () => {
  it("알려진 주문번호만 매칭, 나머지는 미매칭", () => {
    const parsed = [
      { orderNo: "SY-1001", tracking: "111111" },
      { orderNo: "SY-9999", tracking: "222222" },
    ];
    const r = matchTracking(parsed, new Set(["SY-1001"]));
    expect(r.matched).toEqual([{ orderNo: "SY-1001", tracking: "111111" }]);
    expect(r.unmatched).toEqual(["SY-9999"]);
  });
});

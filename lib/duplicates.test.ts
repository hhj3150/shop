import { describe, it, expect } from "vitest";
import { duplicateIds, normalizePhone } from "@/lib/duplicates";

describe("normalizePhone", () => {
  it("숫자만 남긴다(하이픈·공백 무시)", () => {
    expect(normalizePhone("010-1234-5678")).toBe("01012345678");
    expect(normalizePhone("010 1234 5678")).toBe("01012345678");
  });
  it("표기가 달라도 같은 번호면 같은 값", () => {
    expect(normalizePhone("010-1234-5678")).toBe(normalizePhone("01012345678"));
  });
  it("자릿수가 너무 짧거나 비면 null", () => {
    expect(normalizePhone("123")).toBeNull();
    expect(normalizePhone("")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });
});

describe("duplicateIds", () => {
  type Row = { id: string; key: string | null };
  const idOf = (r: Row) => r.id;
  const keyOf = (r: Row) => r.key;

  it("같은 키가 2개 이상이면 모두 중복으로 표시", () => {
    const rows: Row[] = [
      { id: "a", key: "010" },
      { id: "b", key: "010" },
      { id: "c", key: "999" },
    ];
    const dup = duplicateIds(rows, idOf, keyOf);
    expect(dup.has("a")).toBe(true);
    expect(dup.has("b")).toBe(true);
    expect(dup.has("c")).toBe(false);
  });

  it("키가 유일하면 중복 없음", () => {
    const rows: Row[] = [
      { id: "a", key: "1" },
      { id: "b", key: "2" },
    ];
    expect(duplicateIds(rows, idOf, keyOf).size).toBe(0);
  });

  it("키가 null인 항목은 판정에서 제외(서로 묶지 않음)", () => {
    const rows: Row[] = [
      { id: "a", key: null },
      { id: "b", key: null },
      { id: "c", key: "x" },
    ];
    expect(duplicateIds(rows, idOf, keyOf).size).toBe(0);
  });

  it("3개 이상 묶임도 전부 포함", () => {
    const rows: Row[] = [
      { id: "a", key: "k" },
      { id: "b", key: "k" },
      { id: "c", key: "k" },
    ];
    expect(duplicateIds(rows, idOf, keyOf)).toEqual(new Set(["a", "b", "c"]));
  });
});

import { describe, it, expect } from "vitest";
import { buildTotalsRow } from "./dispatch-csv";

// 발송명단 헤더(20칸)의 제품 컬럼 시작 인덱스 = 12(우유180).
//   유입,이름,연락처,우편번호,주소,상세주소,최근주문,구분,배송요일,회차,남은회차,발송일,
//   우유180(12),우유750,요거트180,요거트500,택배사,송장번호,소득공발행,상태(19)
const WIDTH = 20;
const FIRST_BUCKET = 12;

describe("buildTotalsRow", () => {
  it("헤더와 동일 너비로, 제품 수량을 제품 컬럼 위치에 정확히 둔다", () => {
    const row = buildTotalsRow({
      label: "총 개수",
      width: WIDTH,
      firstBucketIndex: FIRST_BUCKET,
      buckets: ["10", "29", "11", "19"],
      grandTotal: "18건",
    });
    expect(row).toHaveLength(WIDTH);
    expect(row[0]).toBe("총 개수");
    expect(row.slice(12, 16)).toEqual(["10", "29", "11", "19"]); // 우유180~요거트500
    expect(row[19]).toBe("18건"); // 마지막 칸
  });

  it("선두(라벨 다음 ~ 제품 직전)와 제품 직후~총합 직전은 빈칸", () => {
    const row = buildTotalsRow({
      label: "총 L량",
      width: WIDTH,
      firstBucketIndex: FIRST_BUCKET,
      buckets: ["1.8L", "21.8L", "2L", "9.5L"],
      grandTotal: "35.1L",
    });
    // 이름~발송일(1~11) 빈칸 — 특히 발송일(11)에 수량이 새지 않아야 한다(회귀 가드).
    expect(row.slice(1, 12).every((c) => c === "")).toBe(true);
    expect(row[11]).toBe(""); // 발송일 칸이 비어야 '한 칸 밀림' 버그가 없는 것
    // 택배사·송장번호·소득공발행(16~18) 빈칸
    expect(row.slice(16, 19).every((c) => c === "")).toBe(true);
    expect(row.slice(12, 16)).toEqual(["1.8L", "21.8L", "2L", "9.5L"]);
    expect(row[19]).toBe("35.1L");
  });

  it("행 전체 길이가 헤더 길이와 같아 데이터 행과 정렬된다", () => {
    const row = buildTotalsRow({
      label: "총 개수",
      width: WIDTH,
      firstBucketIndex: FIRST_BUCKET,
      buckets: ["0", "0", "0", "0"],
      grandTotal: "0건",
    });
    expect(row.length).toBe(WIDTH);
  });
});

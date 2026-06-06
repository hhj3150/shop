import { describe, it, expect } from "vitest";
import {
  reviewSummary,
  averageRating,
  maskName,
  type ReviewRow,
} from "./reviews";

function row(rating: number, created_at: string): ReviewRow {
  return {
    id: created_at,
    product_id: "p",
    author_name: "송영신",
    rating,
    body: "좋아요",
    created_at,
    is_mine: false,
  };
}

describe("averageRating", () => {
  it("빈 배열은 0", () => {
    expect(averageRating([])).toBe(0);
  });
  it("소수 첫째 자리로 반올림", () => {
    expect(averageRating([row(5, "1"), row(4, "2"), row(4, "3")])).toBe(4.3);
  });
});

// 이 규칙은 서버(SQL public.mask_name)와 1:1로 일치해야 한다.
// 공개 RPC(list_reviews)가 실명을 서버에서 마스킹하므로, 네트워크 응답엔
// 실명이 실리지 않고 클라이언트 maskName 호출은 멱등한 방어선이 된다.
describe("maskName", () => {
  it("첫 글자만 남기고 나머지는 마스킹(한글)", () => {
    expect(maskName("송영신")).toBe("송**");
    expect(maskName("하현제")).toBe("하**");
  });
  it("두 글자 이름도 첫 글자만 남긴다", () => {
    expect(maskName("김밥")).toBe("김*");
  });
  it("한 글자는 그대로 둔다", () => {
    expect(maskName("하")).toBe("하");
  });
  it("빈 문자열·공백뿐이면 '회원'", () => {
    expect(maskName("")).toBe("회원");
    expect(maskName("   ")).toBe("회원");
  });
  it("앞뒤 공백은 제거 후 마스킹", () => {
    expect(maskName("  송영신  ")).toBe("송**");
  });
  it("영문 이름도 같은 규칙", () => {
    expect(maskName("Kim")).toBe("K**");
  });
  it("이미 마스킹된 값에 다시 적용해도 동일(멱등)", () => {
    expect(maskName("송**")).toBe("송**");
  });
});

describe("reviewSummary", () => {
  it("빈 입력이면 count 0, average 0, recent 빈 배열", () => {
    expect(reviewSummary([])).toEqual({ count: 0, average: 0, recent: [] });
  });

  it("count와 average를 집계하고 recent는 기본 2개까지 순서 유지", () => {
    const reviews = [row(5, "3"), row(4, "2"), row(3, "1")];
    const s = reviewSummary(reviews);
    expect(s.count).toBe(3);
    expect(s.average).toBe(4);
    expect(s.recent.map((r) => r.created_at)).toEqual(["3", "2"]);
  });

  it("recentCount가 길이보다 크면 전체를 반환", () => {
    const reviews = [row(5, "2"), row(4, "1")];
    expect(reviewSummary(reviews, 5).recent).toHaveLength(2);
  });

  it("recentCount 0이면 recent는 빈 배열", () => {
    expect(reviewSummary([row(5, "1")], 0).recent).toEqual([]);
  });
});

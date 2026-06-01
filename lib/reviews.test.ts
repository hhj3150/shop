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
    user_id: "u",
    product_id: "p",
    author_name: "송영신",
    rating,
    body: "좋아요",
    created_at,
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

describe("maskName", () => {
  it("첫 글자만 남기고 마스킹", () => {
    expect(maskName("송영신")).toBe("송**");
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

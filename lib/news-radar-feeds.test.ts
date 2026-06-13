import { describe, it, expect } from "vitest";
import { RADAR_FEEDS, activeFeeds } from "./news-radar-feeds";
describe("news-radar-feeds", () => {
  it("스타터 피드는 RSS URL·source·category 를 갖는다", () => {
    expect(RADAR_FEEDS.length).toBeGreaterThanOrEqual(3);
    for (const f of RADAR_FEEDS) {
      expect(f.url).toMatch(/^https:\/\//);
      expect(f.source).toBeTruthy();
      expect(["human", "pet"]).toContain(f.category);
    }
  });
  it("activeFeeds(false)는 펫 피드를 제외", () => {
    expect(activeFeeds(false).every((f) => f.category === "human")).toBe(true);
  });
  it("activeFeeds(true)는 전체 반환", () => {
    expect(activeFeeds(true).length).toBe(RADAR_FEEDS.length);
  });
});

import { describe, it, expect } from "vitest";
import { filmWatchUrl, firstDeliveryRitualNote } from "./first-delivery";
import { BRAND_FILM_ID } from "./brand-film";

describe("filmWatchUrl", () => {
  it("브랜드필름 watch 단축 링크", () => {
    expect(filmWatchUrl()).toBe(`https://youtu.be/${BRAND_FILM_ID}`);
    expect(filmWatchUrl("abc123")).toBe("https://youtu.be/abc123");
  });
});

describe("firstDeliveryRitualNote", () => {
  it("빈 줄로 본문과 분리하고 필름 링크를 포함한다", () => {
    const note = firstDeliveryRitualNote();
    expect(note.startsWith("\n\n")).toBe(true);
    expect(note).toContain(filmWatchUrl());
    expect(note).toContain("왜 이 우유");
  });
});

import { describe, it, expect } from "vitest";
import { BRAND_FILM_ID, buildFilmEmbedUrl } from "./brand-film";

describe("buildFilmEmbedUrl", () => {
  it("nocookie 임베드 호스트 + videoId 경로를 쓴다", () => {
    const url = buildFilmEmbedUrl("abc123");
    expect(url.startsWith("https://www.youtube-nocookie.com/embed/abc123?")).toBe(
      true
    );
  });

  it("반복 재생을 위해 loop=1과 playlist=videoId를 갖는다", () => {
    const params = new URL(buildFilmEmbedUrl("abc123")).searchParams;
    expect(params.get("loop")).toBe("1");
    // 단일 영상 반복은 playlist에 자기 자신을 넣어야 동작한다.
    expect(params.get("playlist")).toBe("abc123");
  });

  it("자동 재생 + 인라인 재생 파라미터를 갖는다", () => {
    const params = new URL(buildFilmEmbedUrl("abc123")).searchParams;
    expect(params.get("autoplay")).toBe("1");
    expect(params.get("playsinline")).toBe("1");
  });

  it("BRAND_FILM_ID는 제공된 영상 ID다", () => {
    expect(BRAND_FILM_ID).toBe("bI5EmgK0i2A");
  });
});

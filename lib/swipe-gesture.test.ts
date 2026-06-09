import { describe, it, expect } from "vitest";
import { lockDirection, shouldSwipe } from "./swipe-gesture";

describe("lockDirection", () => {
  it("임계 미만 움직임은 미정(none)", () => {
    expect(lockDirection(5, 4)).toBe("none");
    expect(lockDirection(9, 9)).toBe("none");
  });

  it("가로가 우세하면 h", () => {
    expect(lockDirection(40, 10)).toBe("h");
  });

  it("세로가 우세하면 v (엄지 스크롤 시작)", () => {
    expect(lockDirection(10, 40)).toBe("v");
  });

  it("동률이면 세로(스크롤) 우선", () => {
    expect(lockDirection(20, 20)).toBe("v");
  });
});

describe("shouldSwipe", () => {
  it("가로로 잠긴 충분한 이동만 스와이프", () => {
    expect(shouldSwipe("h", 80)).toBe(true);
    expect(shouldSwipe("h", -80)).toBe(true);
  });

  it("가로로 잠겼어도 이동이 짧으면 무시", () => {
    expect(shouldSwipe("h", 40)).toBe(false);
  });

  it("세로로 잠긴(스크롤) 제스처는 끝에서 가로로 휘어도 무시 — 버그 회귀 방지", () => {
    // 세로 스크롤이 끝점에서 dx=-70 으로 휘어도, v 로 잠겼으면 이동 없음.
    expect(shouldSwipe("v", -70)).toBe(false);
  });

  it("방향 미정(none)이면 무시", () => {
    expect(shouldSwipe("none", 100)).toBe(false);
  });
});

import { describe, it, expect, vi } from "vitest";
import { withTimeout, TimeoutError } from "./with-timeout";

describe("withTimeout — 멈춘 요청을 '모르는 상태'로 두지 않는다", () => {
  it("제시간에 끝나면 그 값을 그대로 돌려준다", async () => {
    await expect(withTimeout(Promise.resolve(7), 50, "늦음")).resolves.toBe(7);
  });

  it("원래 실패는 그대로 전달한다 — 타임아웃이 사유를 덮지 않는다", async () => {
    const boom = new Error("서버가 거절했습니다");
    await expect(withTimeout(Promise.reject(boom), 50, "늦음")).rejects.toBe(boom);
  });

  // ★ 이게 핵심: 영영 안 끝나는 요청도 반드시 끝난다(거부로).
  it("응답이 안 오면 TimeoutError 로 끝낸다", async () => {
    vi.useFakeTimers();
    try {
      const never = new Promise<number>(() => {});
      const p = withTimeout(never, 1000, "연장 신청이 확인되지 않았습니다");
      const assertion = expect(p).rejects.toBeInstanceOf(TimeoutError);
      await vi.advanceTimersByTimeAsync(1000);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  it("문구를 그대로 쓴다 — 손님이 읽을 문장이다", async () => {
    vi.useFakeTimers();
    try {
      const p = withTimeout(new Promise<number>(() => {}), 10, "연장 신청이 확인되지 않았습니다");
      const assertion = expect(p).rejects.toThrow("연장 신청이 확인되지 않았습니다");
      await vi.advanceTimersByTimeAsync(10);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });

  // 성공한 뒤 타이머가 남아 있으면 테스트·브라우저 모두에서 쓸데없이 깨어난다.
  it("끝나면 타이머를 치운다", async () => {
    vi.useFakeTimers();
    try {
      const clear = vi.spyOn(globalThis, "clearTimeout");
      await withTimeout(Promise.resolve(1), 1000, "늦음");
      expect(clear).toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});

// Supabase 쿼리 빌더는 Promise 가 아니라 thenable 이다. Promise 로만 받으면
//   호출처가 한 겹 감싸야 하고, 그 겹이 빠진 자리에서 타임아웃이 조용히 사라진다.
describe("thenable 도 받는다", () => {
  it("then 만 있는 객체에도 걸린다", async () => {
    const thenable: PromiseLike<number> = {
      then: <A, B>(ok?: ((v: number) => A | PromiseLike<A>) | null): PromiseLike<A | B> =>
        Promise.resolve(ok ? ok(42) : (undefined as never)),
    };
    await expect(withTimeout(thenable, 50, "늦음")).resolves.toBe(42);
  });
});

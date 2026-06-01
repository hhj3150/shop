import { describe, it, expect, vi } from "vitest";
import { shareOrCopy, type ShareDeps } from "./share";

const PAYLOAD = { title: "송영신목장", text: "A2 저지 헤이밀크", url: "https://shop.a2jerseymilk.com" };

describe("shareOrCopy", () => {
  it("navigator.share가 있으면 share를 호출하고 'shared' 반환", async () => {
    const share = vi.fn().mockResolvedValue(undefined);
    const deps: ShareDeps = { share, writeText: vi.fn() };
    const res = await shareOrCopy(deps, PAYLOAD);
    expect(share).toHaveBeenCalledWith(PAYLOAD);
    expect(res).toBe("shared");
  });

  it("share가 없으면 클립보드에 url 복사하고 'copied' 반환", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    const deps: ShareDeps = { share: undefined, writeText };
    const res = await shareOrCopy(deps, PAYLOAD);
    expect(writeText).toHaveBeenCalledWith(PAYLOAD.url);
    expect(res).toBe("copied");
  });

  it("사용자가 공유를 취소(AbortError)하면 'cancelled' 반환, 폴백 없음", async () => {
    const err = Object.assign(new Error("cancel"), { name: "AbortError" });
    const share = vi.fn().mockRejectedValue(err);
    const writeText = vi.fn();
    const res = await shareOrCopy({ share, writeText }, PAYLOAD);
    expect(res).toBe("cancelled");
    expect(writeText).not.toHaveBeenCalled();
  });

  it("share가 AbortError 외 사유로 실패하면 클립보드로 폴백하고 'copied'", async () => {
    const share = vi.fn().mockRejectedValue(new Error("boom"));
    const writeText = vi.fn().mockResolvedValue(undefined);
    const res = await shareOrCopy({ share, writeText }, PAYLOAD);
    expect(writeText).toHaveBeenCalledWith(PAYLOAD.url);
    expect(res).toBe("copied");
  });
});

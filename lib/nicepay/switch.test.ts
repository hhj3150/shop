import { describe, it, expect, afterEach, vi } from "vitest";
import { nicepayCheckoutConfig, nicepayConfig, nicepaySwitchOn } from "./server";

const KEYS = {
  NICEPAY_CLIENT_ID: "S2_x",
  NICEPAY_SECRET_KEY: "sk",
  NICEPAY_API_BASE: "https://sandbox-api.nicepay.co.kr",
};

afterEach(() => vi.unstubAllEnvs());

function env(vars: Record<string, string>) {
  for (const k of ["NICEPAY_ENABLED", ...Object.keys(KEYS)]) vi.stubEnv(k, "");
  for (const [k, v] of Object.entries(vars)) vi.stubEnv(k, v);
}

describe("카드결제 스위치(NICEPAY_ENABLED)", () => {
  it("운영 현재 상태(키 없음·스위치 없음): 손님 결제·관리자 모두 꺼짐", () => {
    env({});
    expect(nicepaySwitchOn()).toBe(false);
    expect(nicepayCheckoutConfig()).toBeNull();
    expect(nicepayConfig()).toBeNull();
  });
  it("키는 있어도 스위치가 꺼져 있으면 손님 결제는 꺼짐(관리자 취소·웹훅은 동작)", () => {
    env({ ...KEYS });
    expect(nicepayCheckoutConfig()).toBeNull();
    expect(nicepayConfig()).not.toBeNull();
    env({ ...KEYS, NICEPAY_ENABLED: "false" });
    expect(nicepayCheckoutConfig()).toBeNull();
  });
  it("스위치 켜짐 + 키: 손님 결제 켜짐", () => {
    env({ ...KEYS, NICEPAY_ENABLED: "true" });
    expect(nicepayCheckoutConfig()).toMatchObject({ sandbox: true });
  });
  it("스위치만 켜고 키가 없으면 꺼짐(오류 없이)", () => {
    env({ NICEPAY_ENABLED: "true" });
    expect(nicepayCheckoutConfig()).toBeNull();
  });
  it("허용되지 않은 API 주소면 꺼짐", () => {
    env({ ...KEYS, NICEPAY_ENABLED: "true", NICEPAY_API_BASE: "https://evil.example.com" });
    expect(nicepayCheckoutConfig()).toBeNull();
  });
});

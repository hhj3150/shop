import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  normalizePhone,
  validateOrderNumber,
  registerOrder,
  verifyWebhookAuth,
} from "./payaction";

describe("normalizePhone", () => {
  it("하이픈·공백을 제거해 숫자만 남긴다", () => {
    expect(normalizePhone("010-1234-5678")).toBe("01012345678");
    expect(normalizePhone("010 1234 5678")).toBe("01012345678");
  });

  it("국가코드 +82 를 0 으로 치환한다", () => {
    expect(normalizePhone("+82 10-1234-5678")).toBe("01012345678");
    expect(normalizePhone("821012345678")).toBe("01012345678");
  });

  it("이미 정규화된 번호는 그대로 둔다(멱등)", () => {
    expect(normalizePhone("01012345678")).toBe("01012345678");
  });
});

describe("validateOrderNumber", () => {
  it("우리 주문번호(SY...-NNNN, 15자)는 유효", () => {
    expect(validateOrderNumber("SY20260603-1234")).toBe(true);
  });

  it("빈 값은 무효", () => {
    expect(validateOrderNumber("")).toBe(false);
    expect(validateOrderNumber("   ")).toBe(false);
  });

  it("22자 초과는 무효(알림톡 발송 불가 방지)", () => {
    expect(validateOrderNumber("A".repeat(22))).toBe(true);
    expect(validateOrderNumber("A".repeat(23))).toBe(false);
  });
});

describe("verifyWebhookAuth", () => {
  beforeEach(() => {
    process.env.PAYACTION_WEBHOOK_KEY = "wh-key";
    process.env.PAYACTION_MALL_ID = "mall-1";
  });
  afterEach(() => {
    delete process.env.PAYACTION_WEBHOOK_KEY;
    delete process.env.PAYACTION_MALL_ID;
  });

  it("키·상점ID 가 모두 일치하면 통과", () => {
    expect(verifyWebhookAuth("wh-key", "mall-1")).toBe(true);
  });

  it("웹훅키 불일치는 거절", () => {
    expect(verifyWebhookAuth("wrong", "mall-1")).toBe(false);
  });

  it("상점ID 불일치는 거절", () => {
    expect(verifyWebhookAuth("wh-key", "other")).toBe(false);
  });

  it("헤더 누락(null)은 거절", () => {
    expect(verifyWebhookAuth(null, "mall-1")).toBe(false);
    expect(verifyWebhookAuth("wh-key", null)).toBe(false);
  });

  it("환경 미설정이면 항상 거절", () => {
    delete process.env.PAYACTION_WEBHOOK_KEY;
    expect(verifyWebhookAuth("wh-key", "mall-1")).toBe(false);
  });
});

describe("registerOrder", () => {
  const base = {
    orderNumber: "SY20260603-1234",
    orderAmount: 19000,
    orderDate: "2026-06-03T11:31:00+09:00",
    billingName: "홍길동",
    ordererName: "홍길동",
    ordererPhone: "010-1234-5678",
  };

  beforeEach(() => {
    process.env.PAYACTION_API_BASE = "https://api.payaction.app";
    process.env.PAYACTION_API_KEY = "test-api-key";
    process.env.PAYACTION_MALL_ID = "test-mall-id";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.PAYACTION_API_KEY;
    delete process.env.PAYACTION_MALL_ID;
    delete process.env.PAYACTION_API_BASE;
  });

  it("미설정(키 없음)이면 fetch 호출 없이 not_configured", async () => {
    delete process.env.PAYACTION_API_KEY;
    const fetchSpy = vi.spyOn(global, "fetch");
    const r = await registerOrder(base);
    expect(r).toEqual({ ok: false, reason: "not_configured" });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("유효하지 않은 주문번호는 fetch 없이 거부", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    const r = await registerOrder({ ...base, orderNumber: "A".repeat(23) });
    expect(r.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("입금자명(billing_name)이 비면 fetch 없이 거부", async () => {
    const fetchSpy = vi.spyOn(global, "fetch");
    const r = await registerOrder({ ...base, billingName: "  " });
    expect(r.ok).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("정상 응답(status:success)이면 ok, 헤더·바디를 규격대로 전송", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "success", response: {} }), { status: 200 }),
    );
    const r = await registerOrder(base);
    expect(r).toEqual({ ok: true });

    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("https://api.payaction.app/order");
    const headers = (init as RequestInit).headers as Record<string, string>;
    expect(headers["x-api-key"]).toBe("test-api-key");
    expect(headers["x-mall-id"]).toBe("test-mall-id");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.order_number).toBe("SY20260603-1234");
    expect(body.order_amount).toBe(19000);
    expect(body.billing_name).toBe("홍길동");
    expect(body.orderer_phone_number).toBe("01012345678"); // 정규화됨
  });

  it("실패 응답(status:error)이면 메시지를 reason 으로 반환", async () => {
    vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "error", response: { message: "중복 주문번호" } }), {
        status: 200,
      }),
    );
    const r = await registerOrder(base);
    expect(r).toEqual({ ok: false, reason: "중복 주문번호" });
  });

  it("네트워크 예외는 reason 으로 흡수(throw 안 함)", async () => {
    vi.spyOn(global, "fetch").mockRejectedValue(new Error("network down"));
    const r = await registerOrder(base);
    expect(r.ok).toBe(false);
  });

  it("전화번호 없으면 orderer_phone_number 를 보내지 않는다", async () => {
    const fetchSpy = vi.spyOn(global, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ status: "success", response: {} }), { status: 200 }),
    );
    const { ordererPhone, ...noPhone } = base;
    void ordererPhone;
    await registerOrder(noPhone);
    const body = JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string);
    expect("orderer_phone_number" in body).toBe(false);
  });
});

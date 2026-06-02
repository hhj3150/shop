import { describe, it, expect } from "vitest";
import { decideRenewalStage, buildRenewalMessage, type RenewalTarget } from "./renewal-retention";

// 기준 현재시각: KST 2026-06-10 12:00 (UTC 03:00) → KST 오늘 = 2026-06-10.
const now = new Date("2026-06-10T03:00:00.000Z");

describe("decideRenewalStage (KST 만료 잔여일 윈도우)", () => {
  it("D-8 이상은 none", () => {
    expect(decideRenewalStage("2026-06-18", now, [])).toBe("none"); // d=8
  });
  it("D-7은 D7", () => {
    expect(decideRenewalStage("2026-06-17", now, [])).toBe("D7"); // d=7
  });
  it("D-4는 D7", () => {
    expect(decideRenewalStage("2026-06-14", now, [])).toBe("D7"); // d=4
  });
  it("D-3은 D3", () => {
    expect(decideRenewalStage("2026-06-13", now, [])).toBe("D3"); // d=3
  });
  it("D-1은 D3", () => {
    expect(decideRenewalStage("2026-06-11", now, [])).toBe("D3"); // d=1
  });
  it("D7 이미 발송했으면 none", () => {
    expect(decideRenewalStage("2026-06-17", now, ["D7"])).toBe("none");
  });
  it("D3 이미 발송했으면 none", () => {
    expect(decideRenewalStage("2026-06-13", now, ["D3"])).toBe("none");
  });
  it("D-3 윈도우(d<=3)에선 D7 단계가 미발송이어도 D7을 보내지 않는다", () => {
    // d=2, D3는 이미 보냈고 D7은 미발송 → 상호배타로 none (뒤늦은 D-7 방지)
    expect(decideRenewalStage("2026-06-12", now, ["D3"])).toBe("none"); // d=2
  });
  it("만료 당일(d=0)은 none", () => {
    expect(decideRenewalStage("2026-06-10", now, [])).toBe("none");
  });
  it("만료 경과(d<0)는 none", () => {
    expect(decideRenewalStage("2026-06-09", now, [])).toBe("none"); // d=-1
  });
});

describe("decideRenewalStage (KST 자정 경계)", () => {
  it("KST 자정 직후엔 오늘이 넘어가 d가 1 줄어든다", () => {
    const justAfterMidnightKst = new Date("2026-06-09T15:30:00.000Z"); // KST 06-10 00:30
    expect(decideRenewalStage("2026-06-17", justAfterMidnightKst, [])).toBe("D7"); // d=7
  });
  it("KST 자정 직전엔 어제 기준이라 d가 1 크다", () => {
    const justBeforeMidnightKst = new Date("2026-06-09T14:30:00.000Z"); // KST 06-09 23:30
    expect(decideRenewalStage("2026-06-17", justBeforeMidnightKst, [])).toBe("none"); // d=8
  });
});

const SHOP_FOR_TEST = "송영신목장";

describe("buildRenewalMessage (EXPIRE_SOON)", () => {
  const t: RenewalTarget = {
    slotId: 7,
    name: "홍길동",
    phone: "01012345678",
    expiryDate: "2026-06-17",
    sentStages: [],
  };

  it("EXPIRE_SOON 템플릿키와 변수 #{고객명}/#{만료일}을 매핑한다", () => {
    const m = buildRenewalMessage(t);
    expect(m.templateKey).toBe("EXPIRE_SOON");
    expect(m.variables["#{고객명}"]).toBe("홍길동");
    expect(m.variables["#{만료일}"]).toBe("6월 17일");
  });

  it("LMS 폴백 본문에 이름과 만료일(M월 D일)이 들어간다", () => {
    const m = buildRenewalMessage(t);
    expect(m.text).toContain("홍길동");
    expect(m.text).toContain("6월 17일");
    expect(m.subject).toContain(SHOP_FOR_TEST);
  });
});

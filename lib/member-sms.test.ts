import { describe, it, expect } from "vitest";
import { buildMemberSmsPayload } from "./member-sms";

describe("buildMemberSmsPayload", () => {
  it("단건 발송은 항상 isAd:false (정보성 강제 — 광고 규제 우회 방지)", () => {
    const p = buildMemberSmsPayload("01012345678", "입금 확인됐습니다.");
    expect(p.isAd).toBe(false);
  });

  it("수신자는 해당 번호 1명만", () => {
    const p = buildMemberSmsPayload("01012345678", "안내");
    expect(p.recipients).toEqual(["01012345678"]);
  });

  it("메시지 앞뒤 공백은 정리", () => {
    const p = buildMemberSmsPayload("01012345678", "  내용  ");
    expect(p.message).toBe("내용");
  });
});

import { describe, it, expect } from "vitest";
import { payActionReasonLabel } from "./payaction-reason";

describe("payActionReasonLabel", () => {
  it("환경변수 미설정은 재배포 안내로 바꾼다", () => {
    expect(payActionReasonLabel("not_configured")).toContain("환경변수");
    expect(payActionReasonLabel("not_configured")).toContain("재배포");
  });

  it("인증 실패(http_401/http_403)는 키 불일치 안내로 바꾼다", () => {
    expect(payActionReasonLabel("http_401")).toContain("키");
    expect(payActionReasonLabel("http_403")).toContain("키");
  });

  it("PayAction 서버 오류(http_5xx)는 재시도 안내로 바꾼다", () => {
    expect(payActionReasonLabel("http_500")).toContain("서버");
    expect(payActionReasonLabel("http_503")).toContain("서버");
  });

  it("입금자명 누락은 수기 처리 안내로 바꾼다", () => {
    expect(payActionReasonLabel("missing_depositor_name")).toContain("입금자명");
    expect(payActionReasonLabel("missing_billing_name")).toContain("입금자명");
  });

  it("이미 확인·취소된 주문(not_pending)은 재등록 불필요 안내", () => {
    expect(payActionReasonLabel("not_pending")).toContain("재등록");
  });

  it("주문 없음/조회 실패도 한국어로 바꾼다", () => {
    expect(payActionReasonLabel("order_not_found")).toContain("주문");
    expect(payActionReasonLabel("lookup_failed")).toContain("조회");
  });

  it("연결 실패는 네트워크 안내로 바꾼다", () => {
    expect(payActionReasonLabel("request_failed")).toContain("연결");
  });

  it("매핑에 없는 사유는 원문을 그대로 보존한다", () => {
    expect(payActionReasonLabel("some_unknown_reason")).toBe("some_unknown_reason");
  });

  it("빈 사유는 일반 실패 문구로 대체한다", () => {
    expect(payActionReasonLabel("")).toContain("실패");
    expect(payActionReasonLabel(undefined)).toContain("실패");
  });
});

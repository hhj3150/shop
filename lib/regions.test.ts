import { describe, expect, it } from "vitest";
import {
  SPECIAL_DELIVERY_SHIPPING_KRW,
  isSpecialDeliveryPostcode,
} from "./regions";

describe("isSpecialDeliveryPostcode", () => {
  it("제주 전역(63000~63644)을 특수지역으로 본다", () => {
    expect(isSpecialDeliveryPostcode("63000")).toBe(true);
    expect(isSpecialDeliveryPostcode("63322")).toBe(true); // 제주시
    expect(isSpecialDeliveryPostcode("63644")).toBe(true); // 서귀포 끝
  });

  it("제주 경계 밖은 일반 지역이다", () => {
    expect(isSpecialDeliveryPostcode("62999")).toBe(false);
    expect(isSpecialDeliveryPostcode("63645")).toBe(false);
  });

  it("울릉도(40200~40240)를 특수지역으로 본다", () => {
    expect(isSpecialDeliveryPostcode("40200")).toBe(true);
    expect(isSpecialDeliveryPostcode("40240")).toBe(true);
    expect(isSpecialDeliveryPostcode("40199")).toBe(false);
    expect(isSpecialDeliveryPostcode("40241")).toBe(false);
  });

  it("일반 도시 우편번호는 일반 지역이다", () => {
    expect(isSpecialDeliveryPostcode("06236")).toBe(false); // 서울 강남
    expect(isSpecialDeliveryPostcode("48058")).toBe(false); // 부산 해운대
  });

  it("하이픈/공백을 제거한 숫자 5자리로 판별한다", () => {
    expect(isSpecialDeliveryPostcode(" 63322 ")).toBe(true); // 공백 제거 → 제주
    expect(isSpecialDeliveryPostcode("633-22")).toBe(true); // 하이픈 제거 → 63322(제주)
    expect(isSpecialDeliveryPostcode("63322-1")).toBe(false); // 숫자 6자리 → 형식 외
  });

  it("빈 값·형식 오류는 일반 지역(false)으로 처리한다", () => {
    expect(isSpecialDeliveryPostcode("")).toBe(false);
    expect(isSpecialDeliveryPostcode(null)).toBe(false);
    expect(isSpecialDeliveryPostcode(undefined)).toBe(false);
    expect(isSpecialDeliveryPostcode("123")).toBe(false);
    expect(isSpecialDeliveryPostcode("abcde")).toBe(false);
  });

  it("특수배송 배송비는 5,000원이다", () => {
    expect(SPECIAL_DELIVERY_SHIPPING_KRW).toBe(5000);
  });
});

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

  it("인천 섬 지역(중구·강화·옹진)을 특수지역으로 본다", () => {
    expect(isSpecialDeliveryPostcode("22387")).toBe(true); // 인천 중구 무의도
    expect(isSpecialDeliveryPostcode("23007")).toBe(true); // 인천 강화 섬
    expect(isSpecialDeliveryPostcode("23110")).toBe(true); // 인천 옹진 섬1
    expect(isSpecialDeliveryPostcode("23130")).toBe(true); // 인천 옹진 섬2(백령 등)
    expect(isSpecialDeliveryPostcode("23117")).toBe(false); // 섬 구간 밖
  });

  it("충남 개별 도서 우편번호를 특수지역으로 본다", () => {
    expect(isSpecialDeliveryPostcode("31708")).toBe(true); // 당진 섬
    expect(isSpecialDeliveryPostcode("32133")).toBe(true); // 태안 섬
    expect(isSpecialDeliveryPostcode("33411")).toBe(true); // 보령 섬
    expect(isSpecialDeliveryPostcode("31709")).toBe(false); // 인접 일반
  });

  it("남부 도서(전남·경남·전북)를 특수지역으로 본다", () => {
    expect(isSpecialDeliveryPostcode("52570")).toBe(true); // 경남 사천 섬
    expect(isSpecialDeliveryPostcode("53032")).toBe(true); // 경남 통영 섬1
    expect(isSpecialDeliveryPostcode("53100")).toBe(true); // 경남 통영 섬2
    expect(isSpecialDeliveryPostcode("56348")).toBe(true); // 전북 부안 섬(위도)
    expect(isSpecialDeliveryPostcode("57068")).toBe(true); // 전남 영광 섬
    expect(isSpecialDeliveryPostcode("58761")).toBe(true); // 전남 목포 섬
    expect(isSpecialDeliveryPostcode("58800")).toBe(true); // 전남 신안 섬1
    expect(isSpecialDeliveryPostcode("58826")).toBe(true); // 전남 신안 섬3(단일)
    expect(isSpecialDeliveryPostcode("58866")).toBe(true); // 전남 신안 섬4 끝
    expect(isSpecialDeliveryPostcode("58955")).toBe(true); // 전남 진도 섬(조도 등)
    expect(isSpecialDeliveryPostcode("59102")).toBe(true); // 전남 완도 섬1
    expect(isSpecialDeliveryPostcode("59106")).toBe(true); // 전남 완도 섬2(단일)
    expect(isSpecialDeliveryPostcode("59150")).toBe(true); // 전남 완도 섬5
    expect(isSpecialDeliveryPostcode("59650")).toBe(true); // 전남 여수 섬1(단일)
    expect(isSpecialDeliveryPostcode("59766")).toBe(true); // 전남 여수 섬2(단일)
    expect(isSpecialDeliveryPostcode("59785")).toBe(true); // 전남 여수 섬3
  });

  it("섬과 섞인 시·교량연결 본섬은 일반 지역으로 본다(과청구 방지)", () => {
    expect(isSpecialDeliveryPostcode("53000")).toBe(false); // 통영 시내(육지)
    expect(isSpecialDeliveryPostcode("53088")).toBe(false); // 통영 섬2 구간 직전
    expect(isSpecialDeliveryPostcode("59700")).toBe(false); // 여수 시내(육지)
    expect(isSpecialDeliveryPostcode("58900")).toBe(false); // 진도읍(본섬·교량연결)
    expect(isSpecialDeliveryPostcode("59100")).toBe(false); // 완도읍(본섬·교량연결)
    expect(isSpecialDeliveryPostcode("59101")).toBe(false); // 완도 섬1 구간 직전
  });

  it("출처 오류·교량연결로 제외한 우편번호는 일반 지역이다", () => {
    expect(isSpecialDeliveryPostcode("54000")).toBe(false); // 통영으로 잘못 표기된 전북 코드(제외)
    expect(isSpecialDeliveryPostcode("46768")).toBe(false); // 부산 강서구 가덕도(교량연결·출처불일치, 제외)
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

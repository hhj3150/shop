import { describe, expect, it } from "vitest";
import { profileBackfillPatch, subscriptionShipAddressPatch } from "./profile";

const empty = { phone: "", postcode: null, address: null, address_detail: null };
const ship = {
  phone: "010-1234-5678",
  postcode: "06236",
  address: "서울 강남구 테헤란로 1",
  addressDetail: "101호",
};

describe("profileBackfillPatch", () => {
  it("빈 프로필이면 모든 칸을 채운다(전화는 숫자만)", () => {
    expect(profileBackfillPatch(empty, ship)).toEqual({
      phone: "01012345678",
      postcode: "06236",
      address: "서울 강남구 테헤란로 1",
      address_detail: "101호",
    });
  });

  it("이미 값이 있는 칸은 덮어쓰지 않는다", () => {
    const profile = {
      phone: "01099998888",
      postcode: "12345",
      address: "기존 주소",
      address_detail: null,
    };
    expect(profileBackfillPatch(profile, ship)).toEqual({ address_detail: "101호" });
  });

  it("모든 칸이 차 있으면 빈 패치", () => {
    const profile = {
      phone: "01099998888",
      postcode: "12345",
      address: "기존 주소",
      address_detail: "기존 상세",
    };
    expect(profileBackfillPatch(profile, ship)).toEqual({});
  });

  it("주문서 칸이 비어 있으면 채우지 않는다", () => {
    expect(
      profileBackfillPatch(empty, { phone: "", postcode: "  ", address: "", addressDetail: "" })
    ).toEqual({});
  });
});

describe("subscriptionShipAddressPatch", () => {
  it("주소가 있으면 ship_* 패치를 만든다(공백 정리·빈 상세는 null)", () => {
    expect(
      subscriptionShipAddressPatch({ postcode: "06236", address: " 서울 강남구 1 ", addressDetail: "" })
    ).toEqual({
      ship_postcode: "06236",
      ship_address: "서울 강남구 1",
      ship_address_detail: null,
    });
  });

  it("상세주소도 함께 담는다", () => {
    expect(
      subscriptionShipAddressPatch({ postcode: "12345", address: "부산 해운대 2", addressDetail: "202호" })
    ).toEqual({
      ship_postcode: "12345",
      ship_address: "부산 해운대 2",
      ship_address_detail: "202호",
    });
  });

  it("주소가 비면 null — 빈 주소로 기존 배송지를 덮어쓰지 않는다", () => {
    expect(
      subscriptionShipAddressPatch({ postcode: "06236", address: "   ", addressDetail: "101호" })
    ).toBeNull();
  });
});

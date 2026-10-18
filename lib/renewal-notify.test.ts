import { describe, it, expect } from "vitest";
import { renewalNoticeTarget } from "./renewal-notify";

const buyer = { name: "김철수", phone: "010-1111-2222" };
const ship = { name: "이묘순", phone: "010-3333-4444" };

describe("renewalNoticeTarget — 돈 이야기는 돈 내는 사람에게", () => {
  // ★ 실사고: 선물 구독 연장 안내가 '받는 분' 5명에게 갔다.
  //   신청한 적 없는 분들이 "입금하실 금액 ○○원" 문자를 받았다.
  it("선물이어도 회원(구매자)에게 보낸다", () => {
    const t = renewalNoticeTarget(buyer, ship);
    expect(t?.phone).toBe("01011112222");
    expect(t?.fallback).toBe(false);
  });

  // 선물이면 배송지 이름은 받는 분이다 — 구매자에게 '이묘순님,' 으로 인사하면 안 된다.
  it("인사말도 회원 이름으로 한다", () => {
    expect(renewalNoticeTarget(buyer, ship)?.name).toBe("김철수");
  });

  // 일반 주문은 두 번호가 같아 동작이 바뀌지 않는다.
  it("일반 주문은 지금까지와 같다", () => {
    const same = { name: "김철수", phone: "010-1111-2222" };
    expect(renewalNoticeTarget(buyer, same)?.phone).toBe("01011112222");
  });

  // 번호가 없다고 안 보내면 손님이 입금 계좌를 못 받는다 — 보내되 폴백임을 남긴다.
  it("회원 번호를 모르면 배송지 번호로 떨어지되 표시를 남긴다", () => {
    const t = renewalNoticeTarget({ name: "김철수", phone: "" }, ship);
    expect(t?.phone).toBe("01033334444");
    expect(t?.fallback).toBe(true);
    expect(t?.name).toBe("김철수");
  });

  it("회원 이름을 모르면 배송지 이름이라도 쓴다", () => {
    expect(renewalNoticeTarget({ phone: "01011112222" }, ship)?.name).toBe("이묘순");
  });

  it("둘 다 없으면 보내지 않는다", () => {
    expect(renewalNoticeTarget(null, null)).toBeNull();
    expect(renewalNoticeTarget({ phone: "" }, { phone: "   " })).toBeNull();
  });

  it("하이픈·공백이 섞여도 숫자만 남긴다", () => {
    expect(renewalNoticeTarget({ phone: " 010 - 1111 - 2222 " }, null)?.phone).toBe("01011112222");
  });
});

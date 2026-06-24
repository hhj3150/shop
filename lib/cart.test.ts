import { describe, it, expect } from "vitest";
import { cartDeliveryDays, type DeliveryDay } from "./cart";

// 한 정기구독 주문은 한 배송 요일만 허용한다. cartDeliveryDays 가 담긴 요일을 월→금 순으로
//   중복 없이 돌려주고, 길이>1 이면 다요일(차단 대상)임을 검증한다. 클라이언트(체크아웃·장바구니
//   드로어) 차단과 서버 create_subscription_order 가드가 같은 규칙을 공유한다.
const item = (deliveryDay: DeliveryDay) => ({ deliveryDay });

describe("cartDeliveryDays", () => {
  it("빈 장바구니는 빈 배열", () => {
    expect(cartDeliveryDays([])).toEqual([]);
  });

  it("같은 요일만 담기면 한 요일(중복 제거)", () => {
    expect(cartDeliveryDays([item("wed"), item("wed")])).toEqual(["wed"]);
  });

  it("여러 요일이 섞이면 월→금 정렬로 모두 반환(다요일 → 차단)", () => {
    const days = cartDeliveryDays([item("wed"), item("mon")]);
    expect(days).toEqual(["mon", "wed"]);
    expect(days.length > 1).toBe(true);
  });

  it("입력 순서와 무관하게 항상 월→금 캐노니컬 순서", () => {
    expect(cartDeliveryDays([item("fri"), item("tue"), item("mon")])).toEqual([
      "mon",
      "tue",
      "fri",
    ]);
  });
});

import { describe, it, expect } from "vitest";
import {
  cartDeliveryDays,
  conflictingDeliveryDays,
  slotOnCartDay,
  type DeliveryDay,
} from "./cart";

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

// 같은 요일 기존 구독 충돌 감지. 한 회원은 요일별 슬롯 하나만 가질 수 있으므로
//   (unique index subscription_slots_user_day_uniq, status<>'해지') 장바구니 요일이 내
//   기존 슬롯 요일과 겹치면 신규 신청 불가 — 체크아웃이 제출 전에 연장/다른 요일을 안내한다.
//   서버 create_subscription_order 가드와 같은 규칙(2026-07-06 유니크 위반 클레임의 짝 수정).
describe("conflictingDeliveryDays", () => {
  it("기존 슬롯이 없으면 충돌 없음", () => {
    expect(conflictingDeliveryDays(["mon"], [])).toEqual([]);
  });

  it("장바구니 요일과 기존 슬롯 요일이 겹치면 그 요일을 반환", () => {
    expect(conflictingDeliveryDays(["mon"], ["mon"])).toEqual(["mon"]);
  });

  it("겹치지 않는 요일이면 충돌 없음(다른 요일 신규 신청 허용)", () => {
    expect(conflictingDeliveryDays(["tue"], ["mon", "fri"])).toEqual([]);
  });

  it("여러 요일이 겹치면 월→금 캐노니컬 순서로 모두 반환", () => {
    expect(conflictingDeliveryDays(["fri", "mon"], ["fri", "wed", "mon"])).toEqual([
      "mon",
      "fri",
    ]);
  });
});

// 단일 요일 장바구니의 그 요일을 점유한 내 슬롯 찾기. 활성이면 체크아웃이 연장(재입금)으로
//   접수하고(같은 요일 유지·구성품 변경·미리 신청 지원), 신청·대기면 상태 안내 후 차단한다.
describe("slotOnCartDay", () => {
  const slot = (id: number, delivery_day: DeliveryDay, status: string) => ({
    id,
    delivery_day,
    status,
  });

  it("슬롯이 없으면 null", () => {
    expect(slotOnCartDay(["mon"], [])).toBeNull();
  });

  it("같은 요일 슬롯을 반환(활성 → 연장 전환 대상)", () => {
    expect(slotOnCartDay(["mon"], [slot(40, "mon", "활성")])).toEqual(
      slot(40, "mon", "활성")
    );
  });

  it("다른 요일 슬롯만 있으면 null(새 요일 신규 신청 허용)", () => {
    expect(slotOnCartDay(["tue"], [slot(40, "mon", "활성")])).toBeNull();
  });

  it("다요일 장바구니는 null(multiDay 차단이 선행)", () => {
    expect(slotOnCartDay(["mon", "tue"], [slot(40, "mon", "활성")])).toBeNull();
  });

  it("신청·대기 슬롯도 그대로 반환(호출부가 status 로 연장/차단 분기)", () => {
    expect(slotOnCartDay(["wed"], [slot(7, "wed", "대기")])).toEqual(
      slot(7, "wed", "대기")
    );
  });
});

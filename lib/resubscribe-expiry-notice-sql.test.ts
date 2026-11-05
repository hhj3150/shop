// 재구독 손님에게 '만료됩니다'가 매주 반복되던 사고(2026-11-05 송영신 님)를 못박는다.
//
//   원인 1: 보충 출고(10/21분을 10/26에 출고)가 ship_date=10/21 로 남아, 확정일(10/22)
//           이후만 세는 slot_shipped_rounds 가 영영 못 셌다 → 3/4 에서 멈춰 만료일이 매주 밀림.
//   원인 2: 연장 대신 '새 구독'으로 다시 신청하면 재구독 안내 대상에서 빠지지 않았다.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const sql = readFileSync(
  fileURLToPath(new URL("../supabase/migration-resubscribe-expiry-notice.sql", import.meta.url)),
  "utf8"
);

/** 주석(-- …)을 걷어낸 실행 SQL. */
const runnable = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

const shippedFn = runnable.slice(
  runnable.indexOf("function public.slot_shipped_rounds"),
  runnable.indexOf("function public.renewal_reminder_targets")
);
const targetsFn = runnable.slice(runnable.indexOf("function public.renewal_reminder_targets"));

describe("slot_shipped_rounds — 확정일 뒤 실제로 기록된 보충 출고", () => {
  it("확정일 이후에 기록된 출고는 ship_date 가 과거여도 센다", () => {
    expect(shippedFn).toMatch(/sl\.ship_date > s\.rounds_confirmed_at/);
    expect(shippedFn).toMatch(
      /coalesce\(sl\.shipped_at, sl\.deducted_at\) at time zone 'Asia\/Seoul'\)::date\s*>\s*s\.rounds_confirmed_at/
    );
  });

  // 같은 날 원주문·연장주문을 둘 다 출고해도 한 회차다 — 결제 회차가 깎이면 안 된다.
  it("한 날짜 = 한 회차(distinct ship_date) 원칙을 유지한다", () => {
    expect(shippedFn).toMatch(/count\(distinct sl\.ship_date\)/);
  });

  it("미확정 구독은 null — 옛 달력 계산으로 떨어진다", () => {
    expect(shippedFn).toMatch(/rounds_confirmed_count is null or s\.rounds_confirmed_at is null then null/);
  });

  it("연장 주문 출고도 같은 슬롯으로 센다", () => {
    expect(shippedFn).toMatch(/r\.renews_slot_id = s\.id/);
  });
});

describe("renewal_reminder_targets — 이미 새로 구독한 손님 제외", () => {
  it("같은 손님의 더 늦은 새 구독(연장 아님·취소 아님·해지 아님)을 찾는다", () => {
    expect(targetsFn).toMatch(/n\.user_id = c\.user_id/);
    expect(targetsFn).toMatch(/n\.has_subscription/);
    expect(targetsFn).toMatch(/n\.renews_slot_id is null/);
    expect(targetsFn).toMatch(/n\.created_at > c\.order_created_at/);
    expect(targetsFn).toMatch(/n\.status <> '취소'/);
    expect(targetsFn).toMatch(/coalesce\(ns\.status, '활성'\) <> '해지'/);
  });

  // 선물(다른 받는 분)의 만료는 따로 알려야 한다.
  it("같은 받는 분(주소 또는 전화)일 때만 재구독으로 본다", () => {
    expect(targetsFn).toMatch(/n\.ship_address/);
    expect(targetsFn).toMatch(/n\.ship_phone/);
  });

  // 처음부터 두 구독을 같이 받는 손님(월·수 등)은 각 구독의 만료 안내가 그대로 나가야 한다.
  it("만료 안내를 받은 뒤 또는 만료 14일 전 이후에 신청한 것만 재구독으로 본다", () => {
    expect(targetsFn).toMatch(/rr0\.sent_at <= n\.created_at/);
    expect(targetsFn).toMatch(/>= c\.expiry_date - 14/);
  });

  it("최종 대상은 제외를 거친 live 에서만 뽑는다", () => {
    expect(targetsFn).toMatch(/from live c/);
  });

  // 함수를 통째로 replace 하므로 기존 보호 장치가 같이 사라지지 않았는지 확인한다.
  it("기존 보호 장치를 유지한다", () => {
    expect(targetsFn).toMatch(/raise exception 'forbidden'/);
    expect(targetsFn).toMatch(/r\.renews_slot_id = s\.id and r\.status = '입금대기'/);
    expect(targetsFn).toMatch(/when b\.shipped is null then/);
    expect(targetsFn).toMatch(/when b\.shipped >= b\.total then v_today/);
    expect(targetsFn).toMatch(/public\.sub_delivery_dates\(/);
    expect(targetsFn).toMatch(/v_today\s+date := \(now\(\) at time zone 'Asia\/Seoul'\)::date/);
    expect(targetsFn).toMatch(/between \(v_today - 3\) and \(v_today \+ 7\)/);
    expect(targetsFn).toMatch(/security definer/);
  });
});

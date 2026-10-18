// 연장주문이 '선물'이라는 사실을 잃지 않게 — 되돌아가면 주소가 덮인다.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const sql = readFileSync(
  fileURLToPath(new URL("../supabase/migration-renewal-keeps-gift.sql", import.meta.url)),
  "utf8"
);
const runnable = sql
  .split("\n")
  .filter((l) => !l.trimStart().startsWith("--"))
  .join("\n");

describe("migration-renewal-keeps-gift.sql", () => {
  // ★ 이 한 줄이 핵심이다. false 로 박으면 '받는 분 주소인데 선물이 아닌 주문'이 되고,
  //   sync_my_order_shipping(= is_gift=false 인 본인 주문을 전부 갱신)이 구매자 주소로
  //   덮어쓴다. 어머니께 가던 우유가 구매자 집으로 간다.
  it("원주문의 선물 여부를 그대로 승계한다", () => {
    expect(runnable).toMatch(/coalesce\(v_src\.is_gift,\s*false\)/);
    // 리터럴 false 를 is_gift 자리에 다시 박지 못하게 한다.
    const values = runnable.slice(runnable.indexOf("v_uid, v_order_no, v_total"));
    expect(/,\s*false,\s*p_slot_id/.test(values), "is_gift 자리에 false 가 다시 박혔다").toBe(false);
  });

  it("보낸이·선물 메시지도 함께 가져온다", () => {
    expect(runnable).toMatch(/is_gift,\s*gifter_name,\s*gift_message/);
    expect(runnable).toMatch(/v_src\.gifter_name/);
    expect(runnable).toMatch(/v_src\.gift_message/);
  });

  // 아래는 이번 수정과 무관하지만 함수를 통째로 replace 하므로 같이 사라질 수 있다.
  it("배송지 승계를 유지한다", () => {
    for (const col of ["ship_name", "ship_phone", "ship_postcode", "ship_address", "ship_address_detail"]) {
      expect(runnable, `${col} 승계가 빠졌다`).toMatch(new RegExp(`v_src\\.${col}`));
    }
  });

  it("본인·활성 구독만, 입금대기 중복은 거절", () => {
    expect(runnable).toMatch(/user_id = v_uid and status = '활성'/);
    expect(runnable).toMatch(/renews_slot_id = p_slot_id and status = '입금대기'/);
  });

  it("금액을 서버가 다시 계산한다", () => {
    expect(runnable).toMatch(/public\.period_discount\(p_period\)/);
    expect(runnable).toMatch(/v_per_list < 24000/);
    expect(runnable).toMatch(/is_special_delivery_postcode/);
  });

  it("요일 좌석 검사를 유지한다", () => {
    expect(runnable).toMatch(/v_taken >= 100/);
  });

  it("조건을 무력화하는 상수가 섞여 있지 않다", () => {
    expect(/\b(where|and|or|when)\s+false\b/i.test(runnable)).toBe(false);
    expect(/\b(where|and|or|when)\s+true\b/i.test(runnable)).toBe(false);
  });
});

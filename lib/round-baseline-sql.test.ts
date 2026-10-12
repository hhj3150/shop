// 회차 확정 기준점 마이그레이션 — 안전장치가 되돌아가지 않게 막는다.
//
//   이 기능은 '손님이 결제한 회차'를 직접 건드린다. 확정값을 잘못 넣으면 받을 회차가
//   사라지고, 그건 되돌릴 수 없다. 그래서 SQL 쪽 방어를 테스트로 못박는다.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const sql = readFileSync(
  fileURLToPath(new URL("../supabase/migration-round-baseline.sql", import.meta.url)),
  "utf8"
);

/** 주석(-- …)을 걷어낸 실행 SQL. 주석 속 문구를 근거로 삼지 않기 위해서다. */
const runnable = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("migration-round-baseline.sql", () => {
  it("확정값·확정일 컬럼을 추가한다(멱등)", () => {
    expect(runnable).toMatch(/add column if not exists rounds_confirmed_count/);
    expect(runnable).toMatch(/add column if not exists rounds_confirmed_at/);
  });

  // 한쪽만 채워지면 계산이 어디서 끊길지 모른다 — 둘은 항상 같이 간다.
  it("확정값·확정일이 짝으로만 존재하도록 제약을 건다", () => {
    expect(runnable).toMatch(/subscription_slots_rounds_confirmed_pair/);
    expect(runnable).toMatch(
      /rounds_confirmed_count is null and rounds_confirmed_at is null/
    );
    expect(runnable).toMatch(/rounds_confirmed_count >= 0/);
  });

  // ★ 한 날짜 = 한 회차. distinct 가 빠지면 같은 날 중복 출고가 두 회차로 세어져
  //   손님이 결제한 회차가 사라진다.
  it("확정일 이후 발송을 '서로 다른 날짜'로 센다", () => {
    expect(runnable).toMatch(/count\(distinct sl\.ship_date\)/);
  });

  // 확정일 '당일까지'는 확정값에 포함된다. >= 로 세면 당일분을 두 번 센다.
  it("확정일 이후만 더한다(당일 중복 가산 금지)", () => {
    expect(runnable).toMatch(/sl\.ship_date > s\.rounds_confirmed_at/);
    expect(runnable).not.toMatch(/sl\.ship_date >= s\.rounds_confirmed_at/);
  });

  // 연장주문 발송은 원주문 id 가 아니라 연장주문 id 에 달린다. 빠뜨리면 회차가 모자라 보인다.
  it("원주문과 연장주문 발송을 모두 센다", () => {
    expect(runnable).toMatch(/sl\.order_id = s\.order_id/);
    expect(runnable).toMatch(/renews_slot_id = s\.id/);
  });

  // 문자열 검사는 '지웠는가'는 잡아도 '무력화했는가'는 못 잡는다(예: `false and …`).
  //   조건을 통째로 끄는 흔한 패턴만이라도 막아 둔다.
  it("조건을 무력화하는 상수가 섞여 있지 않다", () => {
    expect(/\bfalse\s+and\b/i.test(runnable), "false and 로 조건을 끄면 안 된다").toBe(false);
    expect(/\btrue\s+or\b/i.test(runnable), "true or 로 조건을 끄면 안 된다").toBe(false);
    expect(/\bif\s+false\s+then\b/i.test(runnable), "if false then 으로 막으면 안 된다").toBe(false);
  });

  it("미확정 슬롯은 null 을 돌려준다 — 옛 계산이 그대로 돈다", () => {
    expect(runnable).toMatch(
      /when s\.rounds_confirmed_count is null or s\.rounds_confirmed_at is null then null/
    );
  });

  it("확정 RPC 는 관리자만 쓸 수 있다", () => {
    expect(runnable).toMatch(/is_admin\(\)/);
    expect(runnable).toMatch(/revoke execute on function public\.admin_confirm_slot_rounds\([^)]*\) from anon/);
  });

  // 결제 회차를 넘겨 확정하면 손님이 받을 회차가 사라진다 — 되돌릴 수 없는 방향.
  it("결제 회차보다 많이 확정할 수 없다", () => {
    expect(runnable).toMatch(/p_count > coalesce\(v_total, 0\)/);
    expect(runnable).toMatch(/보다 많이 확정할 수 없습니다/);
  });

  it("음수 확정을 막는다", () => {
    expect(runnable).toMatch(/p_count < 0/);
  });

  it("확정 기준일은 KST 로 잡는다", () => {
    expect(runnable).toMatch(/public\.kst_today\(\)/);
  });

  it("확정 이력을 order_events 에 남긴다 — 나중에 되짚을 수 있어야 한다", () => {
    expect(runnable).toMatch(/insert into public\.order_events/);
    expect(runnable).toMatch(/회차확정/);
  });

  // 이 설계의 핵심 — 기존 질서를 건드리지 않는다.
  it("기존 일정·금액 컬럼을 건드리지 않는다", () => {
    for (const col of [
      "started_at", "first_ship_date", "paused_days", "block_weeks", "extended_weeks",
    ]) {
      expect(
        new RegExp(`(update|set)\\s+[^;]*\\b${col}\\s*=`, "i").test(runnable),
        `${col} 을(를) 쓰면 안 된다`
      ).toBe(false);
    }
  });

  it("shipment_log 에 행을 만들지 않는다 — 손님 배송이력을 더럽히지 않는다", () => {
    expect(/insert\s+into\s+public\.shipment_log/i.test(runnable)).toBe(false);
  });
  // ── 관리자 확정 화면이 읽는 RPC ─────────────────────────────────────────────
  it("확정 현황 조회도 관리자만 쓸 수 있다", () => {
    expect(runnable).toMatch(/create or replace function public\.admin_round_baseline_rows\(\)/);
    expect(runnable).toMatch(
      /revoke execute on function public\.admin_round_baseline_rows\(\) from anon/
    );
    // is_admin 게이트가 선언부가 아니라 '본문 첫 줄'에 있어야 우회가 없다.
    const body = runnable.slice(runnable.indexOf("admin_round_baseline_rows"));
    expect(body.slice(0, body.indexOf("return query"))).toMatch(/if not public\.is_admin\(\)/);
  });

  // 조회 화면이 쓰기를 겸하면 확인·상한 검사를 건너뛸 길이 생긴다. 읽기만 한다.
  it("확정 현황 조회는 읽기 전용이다", () => {
    const fn = runnable.slice(runnable.indexOf("admin_round_baseline_rows"));
    expect(/\bupdate\s+public\./i.test(fn), "조회 함수가 쓰면 안 된다").toBe(false);
    expect(/\binsert\s+into\b/i.test(fn), "조회 함수가 쓰면 안 된다").toBe(false);
    expect(fn).toMatch(/\bstable\b/);
  });

  // 화면이 비교해 보여줘야 할 두 숫자 — 이게 어긋난 폭이 곧 사고의 크기다.
  it("우리 기록과 달력 기준을 함께 올린다", () => {
    const fn = runnable.slice(runnable.indexOf("admin_round_baseline_rows"));
    expect(fn).toMatch(/recorded_count\s+int/);
    expect(fn).toMatch(/calendar_rounds\s+int/);
    // 달력 기준은 배송일 생성 SSOT 를 그대로 쓴다 — 화면이 따로 계산하면 또 갈라진다.
    expect(fn).toMatch(/public\.sub_delivery_dates\(/);
  });

  // 한 날짜 = 한 회차. 조회 쪽에서도 같은 규칙이어야 확정값과 화면이 맞는다.
  it("조회도 발송을 '서로 다른 날짜'로 센다", () => {
    const fn = runnable.slice(runnable.indexOf("admin_round_baseline_rows"));
    expect(fn).toMatch(/count\(distinct sl\.ship_date\)/);
  });

  // 연장주문 발송이 빠지면 화면이 실제보다 적게 보여주고, 사장님이 그 숫자로 확정한다.
  it("조회도 원주문과 연장주문 발송을 모두 센다", () => {
    const fn = runnable.slice(runnable.indexOf("admin_round_baseline_rows"));
    expect(fn).toMatch(/renews_slot_id is not null/);
    expect(fn).toMatch(/slot_orders/);
  });
});

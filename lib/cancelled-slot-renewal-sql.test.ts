// 해지된 구독에 연장 입금이 들어오는 구멍 — migration 이 되돌아가지 않게 막는다.
//
//   재현 경로: 연장 신청('입금대기') → 구독 해지 → 뒤늦게 입금
//     → confirm_payment 가 슬롯 상태를 안 보고 '해지' 슬롯에 회차를 더한다
//     → 배송 명단은 '해지'를 제외하므로 물건은 안 나간다. 돈만 받는다.
//
//   막는 자리가 셋이라 셋 다 살아 있어야 한다. 하나라도 빠지면 경로가 다시 열린다.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const sql = readFileSync(
  fileURLToPath(
    new URL("../supabase/migration-cancelled-slot-renewal-deposit.sql", import.meta.url)
  ),
  "utf8"
);

/** 주석(-- …)을 걷어낸 실행 SQL. 주석 속 문구를 근거로 삼지 않기 위해서다. */
const runnable = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("migration-cancelled-slot-renewal-deposit.sql", () => {
  // ① 출발점 — 해지하면 대기 중인 연장 주문도 같이 취소된다
  it("슬롯이 '해지'가 될 때 '입금대기' 연장 주문을 취소하는 트리거가 있다", () => {
    expect(runnable).toContain("create trigger trg_cancel_pending_renewals");
    expect(runnable).toMatch(/after update of status on public\.subscription_slots/);
    expect(runnable).toMatch(/new\.status = '해지'/);
    expect(runnable).toMatch(/set status = '취소'[\s\S]{0,200}status = '입금대기'/);
  });

  it("트리거로 붙였다 — cancel_subscription 본문을 복사하지 않는다", () => {
    // 같은 본문을 두 마이그레이션이 들고 있으면 반드시 한쪽만 갱신된다.
    // 해지 경로도 하나가 아니다(손님·관리자·주문취소 연쇄) — 트리거가 전부를 덮는다.
    expect(runnable).not.toContain("create or replace function public.cancel_subscription");
  });

  // ② 회차 반영 — 해지된 구독에는 절대 더하지 않는다
  it("apply_renewal_slot_change 가 '해지' 슬롯을 거부한다", () => {
    const fn = runnable.slice(
      runnable.indexOf("function public.apply_renewal_slot_change"),
      runnable.indexOf("function public.confirm_payment")
    );
    expect(fn).toMatch(/v_status = '해지'/);
    expect(fn).toMatch(/raise exception/);
    // 상태를 읽어 와야 판정할 수 있다.
    expect(fn).toMatch(/select delivery_day, status, user_id/);
  });

  // ③ 도착점 — 그래도 입금이 들어오면 고아입금으로 남기고 사람을 부른다
  it("confirm_payment 가 '해지' 슬롯 연장 입금을 고아입금으로 적재한다", () => {
    expect(runnable).toContain("'해지구독연장'");
    expect(runnable).toMatch(/insert into public\.orphan_deposits/);
    expect(runnable).toContain("'orphan_reason', '해지구독연장'");
  });

  it("해지 슬롯 연장 입금은 '입금확인'으로 바꾸지 않는다", () => {
    // 환불이냐 재구독이냐는 사람이 정할 일이라, 상태를 바꾸지 않고 그대로 둔다.
    const branch = runnable.slice(
      runnable.indexOf("if v_slot_status = '해지' then"),
      runnable.indexOf("'orphan_reason', '해지구독연장'")
    );
    expect(branch).not.toContain("status = '입금확인'");
  });

  it("좌석 충돌은 결제확인 전체를 롤백하지 않는다", () => {
    // 예외가 밖으로 나가면 '입금확인'조차 안 남고 웹훅이 실패해 PayAction 이 무한 재전송한다.
    expect(runnable).toMatch(/exception when others then[\s\S]{0,400}'연장좌석충돌'/);
    expect(runnable).toContain("'orphan_reason', '연장좌석충돌'");
  });

  it("고아입금 적재는 멱등이다 — 웹훅 재전송이 관리자 문자를 반복 발송하지 않게", () => {
    const inserts = runnable.match(/on conflict \(order_no, pg_tx_id\) do nothing/g) ?? [];
    expect(inserts.length).toBe(3); // 취소주문 · 해지구독연장 · 연장좌석충돌
    const diags = runnable.match(/get diagnostics v_orphan_inserted = row_count/g) ?? [];
    expect(diags.length).toBe(3);
  });

  it("권한을 넓히지 않는다 — 내부 헬퍼는 anon 에 주지 않는다", () => {
    expect(runnable).toMatch(
      /revoke execute on function public\.apply_renewal_slot_change\(uuid\) from anon/
    );
  });
});

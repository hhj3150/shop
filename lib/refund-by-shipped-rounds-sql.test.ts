// 해지 환불이 '실제로 받은 회차'를 세는지 — 여기가 틀리면 손님 돈이 사라진다.
//
//   받지 않은 회차를 '배송됨'으로 세면 그만큼 환불에서 빠진다. 활성 구독 57건 ·
//   155회차가 그 상태였다(최대 497만원). 사장님 결정으로 실제 발송 기준으로 바꿨다.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const sql = readFileSync(
  fileURLToPath(new URL("../supabase/migration-refund-by-shipped-rounds.sql", import.meta.url)),
  "utf8"
);

/** 주석(-- …)을 걷어낸 실행 SQL. 주석 속 문구를 근거로 삼지 않기 위해서다. */
const runnable = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

/** cancel_subscription 본문만 — my_slot_shipped_rounds 쪽과 섞이지 않게 자른다. */
const cancelFn = runnable.slice(
  runnable.indexOf("function public.cancel_subscription"),
  runnable.indexOf("function public.my_slot_shipped_rounds")
);

describe("migration-refund-by-shipped-rounds.sql — cancel_subscription", () => {
  it("실제 발송 회차를 확정 기준점에서 가져온다", () => {
    expect(cancelFn).toMatch(/v_shipped\s*:?=\s*public\.slot_shipped_rounds\(p_slot_id\)/);
  });

  // 확정된 구독은 달력 계산을 '쓰지 않아야' 한다. 둘을 동시에 쓰면 어느 쪽이 이기는지
  //   읽는 사람이 알 수 없고, 분기 순서 한 줄로 환불액이 뒤집힌다.
  it("확정됐으면 발송 수로, 아니면 달력으로 — 둘 중 하나만 쓴다", () => {
    expect(cancelFn).toMatch(/if v_shipped is not null then/);
    const branch = cancelFn.slice(cancelFn.indexOf("if v_shipped is not null then"));
    const tail = branch.slice(0, branch.indexOf("end if;"));
    expect(tail).toMatch(/elsif v_started is null then/);
    expect(tail).toMatch(/sub_delivery_dates/); // 미확정 경로는 그대로 남아 있다
  });

  // 결제 회차(블록 체인 합)를 넘겨 세면 음수 구간이 생겨 환불이 0 으로 깎인다.
  it("받은 회차를 0 ~ 결제 회차로 가둔다", () => {
    expect(cancelFn).toMatch(/least\(greatest\(v_shipped, 0\), v_total\)/);
  });

  // 환불 산식(남은 회차 × 블록 단가 − 적립금 안분)은 이번에 건드리지 않는다.
  it("환불 산식은 그대로다", () => {
    expect(cancelFn).toMatch(/for v_k in \(v_delivered \+ 1\)\.\.v_total loop/);
    expect(cancelFn).toMatch(/v_refund := greatest\(0, v_refund\)/);
    expect(cancelFn).toMatch(/v_credit_arr\[v_i\]::numeric \* v_left_arr\[v_i\] \/ v_weeks_arr\[v_i\]/);
  });

  // 본인 구독만 해지할 수 있어야 한다 — 함수를 통째로 replace 하므로 같이 사라질 수 있다.
  it("본인 확인과 행 잠금을 유지한다", () => {
    expect(cancelFn).toMatch(/s\.user_id = v_uid/);
    expect(cancelFn).toMatch(/for update of s/);
    expect(cancelFn).toMatch(/s\.status in \('활성','대기'\)/);
  });

  it("해지 결과를 슬롯에 기록한다", () => {
    expect(cancelFn).toMatch(/set status\s*=\s*'해지'/);
    expect(cancelFn).toMatch(/refund_amount\s*=\s*v_refund/);
  });
});

describe("migration-refund-by-shipped-rounds.sql — my_slot_shipped_rounds", () => {
  const myFn = runnable.slice(runnable.indexOf("function public.my_slot_shipped_rounds"));

  // ★ 화면이 TS 로 따로 세면 환불과 갈라진다. 같은 함수를 보게 한다.
  it("환불과 같은 함수로 센다", () => {
    expect(myFn).toMatch(/public\.slot_shipped_rounds\(s\.id\)/);
  });

  it("본인 것만 돌려준다", () => {
    expect(myFn).toMatch(/s\.user_id = auth\.uid\(\)/);
    expect(myFn).toMatch(/revoke execute on function public\.my_slot_shipped_rounds\(\) from anon/);
  });

  // security definer 로 두면 user_id 조건 한 줄이 빠지는 순간 남의 구독이 보인다.
  it("security definer 가 아니다 — RLS 가 그대로 걸린다", () => {
    expect(myFn).toMatch(/security invoker/);
    expect(/security\s+definer/i.test(myFn)).toBe(false);
  });

  it("확정된 슬롯만 돌려준다 — 미확정은 호출처가 달력으로 떨어져야 한다", () => {
    expect(myFn).toMatch(/s\.rounds_confirmed_at is not null/);
  });
});

describe("환불 금액을 화면에서 계산하지 않는다", () => {
  // 금액을 두 곳에서 계산하면 실지급액과 어긋나고, 손님에게는 그 차이가 분쟁이 된다.
  it("클라이언트 환불 미리보기 함수가 없다", async () => {
    const mod = await import("./subscriptions");
    expect("refundAmount" in mod).toBe(false);
  });

  it("해지 화면이 금액을 적지 않는다", () => {
    const page = readFileSync(
      fileURLToPath(new URL("../app/account/page.tsx", import.meta.url)),
      "utf8"
    );
    // 해지 영역에서 환불 '예정액'을 돈으로 적는 표현이 없어야 한다.
    expect(/환불 예정액/.test(page)).toBe(false);
    expect(/formatKRW\(\s*refund\s*\)/.test(page)).toBe(false);
  });
});

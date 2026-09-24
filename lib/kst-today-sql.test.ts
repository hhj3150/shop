// 날짜 기준 KST 고정 — migration-kst-today.sql 이 되돌아가지 않게 막는다.
//
//   Postgres 의 current_date 는 UTC 기준이라 한국시간 00:00~09:00 에는 '어제'를 가리킨다.
//   그 아홉 시간 동안 조작하면 정지일·재개일·유통기한 판정이 하루씩 어긋난다.
//   운영 로직에서 '오늘'이 필요하면 public.kst_today() 를 쓴다.
//
//   .sql 은 tsc·lint 가 지켜주지 않으므로 여기서 최소한만 고정한다.
//   (운영 DB 의 실제 정의는 supabase/audit-integrity.sql 의 검증 쿼리로 확인한다.)
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const sql = readFileSync(
  fileURLToPath(new URL("../supabase/migration-kst-today.sql", import.meta.url)),
  "utf8"
);

/** 주석(-- …)을 걷어낸 실행 SQL 만 남긴다. 주석 속 current_date 는 설명이라 세면 안 된다. */
const runnable = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("migration-kst-today.sql", () => {
  it("kst_today() 를 정의한다", () => {
    expect(runnable).toMatch(/create or replace function public\.kst_today\(\)/);
    expect(runnable).toContain("(now() at time zone 'Asia/Seoul')::date");
  });

  it("kst_today() 는 stable 이다(immutable 이면 플래너가 값을 굳힌다)", () => {
    const body = runnable.slice(runnable.indexOf("function public.kst_today()"));
    expect(body.slice(0, 200)).toMatch(/\bstable\b/);
  });

  it("다시 쓴 함수 본문에 raw current_date 가 남아 있지 않다", () => {
    expect(runnable).not.toContain("current_date");
  });

  it("KST 로 옮긴 세 함수를 모두 다시 정의한다", () => {
    for (const fn of ["cancel_skip", "admin_set_subscription_paused", "stock_adjust"]) {
      expect(runnable).toContain(`create or replace function public.${fn}`);
    }
  });

  it("관리자 대행 재개도 '놓친 회차' 규칙을 쓴다(경과 일수 누적 금지)", () => {
    // resume_subscription 과 같은 규칙이어야 손님이 직접 한 것과 결과가 같다.
    expect(runnable).toContain("missed_delivery_weeks(");
    expect(runnable).toContain("v_missed * 7");
    // 옛 규칙의 흔적: 경과 일수를 그대로 더하던 자리.
    expect(runnable).not.toMatch(/v_today\s*-\s*coalesce\(v_slot\.paused_at/);
  });

  it("권한을 넓히지 않는다 — 관리자 대행 RPC 는 anon 에 주지 않는다", () => {
    expect(runnable).toMatch(
      /revoke execute on function public\.admin_set_subscription_paused\(bigint, boolean\) from anon/
    );
  });
});

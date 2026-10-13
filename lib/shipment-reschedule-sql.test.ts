// 배송일 변경 마이그레이션(migration-shipment-reschedule.sql)의 안전장치가 빠지지 않게 고정한다.
//   .sql 은 tsc·lint 가 지켜주지 않으므로 여기서 최소한만 본다.
//   (운영 DB 의 실제 정의는 pg_get_functiondef 로 확인한다 — supabase/README.md)
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const sql = readFileSync(
  fileURLToPath(new URL("../supabase/migration-shipment-reschedule.sql", import.meta.url)),
  "utf8"
);
const runnable = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

function body(fnSignatureStart: string): string {
  const i = runnable.indexOf(fnSignatureStart);
  expect(i).toBeGreaterThan(-1);
  const rest = runnable.slice(i);
  const end = rest.indexOf("\n$$;");
  return rest.slice(0, end > 0 ? end : undefined);
}

describe("migration-shipment-reschedule.sql", () => {
  it("표는 한 회차에 변경 1건만 두고, 같은 날·7일 이상 이동을 제약으로 막는다", () => {
    expect(runnable).toMatch(/create table if not exists public\.shipment_reschedules/);
    expect(runnable).toContain("unique (order_id, delivery_day, from_date)");
    expect(runnable).toContain("check (to_date <> from_date)");
    expect(runnable).toContain("check (abs(to_date - from_date) < 7)");
  });

  it("RLS 를 켜고, 쓰기 정책 없이 조회만 연다(쓰기는 RPC 로만)", () => {
    expect(runnable).toContain("alter table public.shipment_reschedules enable row level security");
    expect(runnable).toMatch(/create policy "shipment_reschedules_select"/);
    expect(runnable).not.toMatch(/create policy "shipment_reschedules_(insert|update|delete)"/);
    expect(runnable).not.toMatch(/create policy[^;]*for (insert|update|delete)/);
  });

  it("등록 RPC 는 관리자만, 규칙(±6일·주말·발송불가일·기출고)을 모두 검사한다", () => {
    const b = body("create or replace function public.admin_reschedule_shipment(");
    expect(b).toContain("security definer");
    expect(b).toContain("if not public.is_admin() then raise exception");
    expect(b).toContain("abs(p_to - p_from) >= 7");
    expect(b).toContain("extract(isodow from p_to)::int > 5");
    expect(b).toContain("public.is_dispatch_blocked(p_to)");
    expect(b).toContain("l.ship_date = p_from"); // 이미 출고된 회차
    expect(b).toContain("l.ship_date = p_to"); // 새 날짜에 다른 회차 출고
    expect(b).toContain("insert into public.order_events");
  });

  it("취소 RPC 는 옮긴 날짜로 이미 출고된 회차를 되돌리지 못하게 한다", () => {
    const b = body("create or replace function public.admin_cancel_reschedule(");
    expect(b).toContain("if not public.is_admin() then raise exception");
    expect(b).toContain("l.ship_date = v_row.to_date");
    expect(b).toContain("delete from public.shipment_reschedules where id = p_id");
  });

  it("두 RPC 모두 anon 실행 권한을 거둔다", () => {
    expect(runnable).toContain(
      "revoke execute on function public.admin_reschedule_shipment(uuid, text, date, date, text) from anon"
    );
    expect(runnable).toContain("revoke execute on function public.admin_cancel_reschedule(bigint) from anon");
  });

  it("발송 전날 예고 데이터셋에 reschedules 키를 더하고, 기존 키는 그대로 둔다", () => {
    const b = body("create or replace function public.ship_reminder_dataset(");
    for (const key of ["'orders'", "'items'", "'slots'", "'reminded'", "'dispatched'", "'reschedules'"]) {
      expect(b).toContain(key);
    }
    expect(b).toContain("from public.shipment_reschedules x");
    expect(b).toContain("vault.decrypted_secrets"); // 시크릿 게이트 유지
  });
});

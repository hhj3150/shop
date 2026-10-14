// 회차 보존 안전장치 마이그레이션(migration-round-guards.sql)의 핵심 검사가 빠지지 않게 고정한다.
//   .sql 은 tsc·lint 가 지켜주지 않으므로 여기서 최소한만 본다.
//   (운영 DB 의 실제 정의는 pg_get_functiondef 로 확인한다 — supabase/README.md)
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const sql = readFileSync(
  fileURLToPath(new URL("../supabase/migration-round-guards.sql", import.meta.url)),
  "utf8"
);
const runnable = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

function body(fnSignatureStart: string): string {
  const i = runnable.indexOf(fnSignatureStart);
  expect(i, fnSignatureStart).toBeGreaterThan(-1);
  const rest = runnable.slice(i);
  const end = rest.indexOf("\n$$;");
  return rest.slice(0, end > 0 ? end : undefined);
}

describe("migration-round-guards.sql", () => {
  it("정지 전 가드는 본인·관리자만, 진행 중 변경은 거절하고 미래 변경은 지운다", () => {
    const b = body("create or replace function public.guard_pause_reschedules(");
    expect(b).toContain("security definer");
    expect(b).toContain("if not public.is_admin() and v_slot.user_id is distinct from auth.uid()");
    expect(b).toContain("x.from_date < v_today");
    expect(b).toContain("x.to_date >= v_today");
    expect(b).toContain("그 배송이 나간 뒤에 정지할 수 있습니다");
    expect(b).toContain("delete from public.shipment_reschedules x");
    expect(b).toContain("x.from_date >= v_today");
    expect(runnable).toContain("revoke execute on function public.guard_pause_reschedules(bigint) from anon");
  });

  it("세 정지 경로(손님 정지·건너뛰기·관리자 정지)가 모두 가드를 먼저 부른다", () => {
    for (const sig of [
      "create or replace function public.pause_subscription(",
      "create or replace function public.skip_next_delivery(",
      "create or replace function public.admin_set_subscription_paused(",
    ]) {
      expect(body(sig), sig).toContain("perform public.guard_pause_reschedules(p_slot_id)");
    }
  });

  it("관리자 정지는 '재개' 경로에서는 가드를 부르지 않고 놓친 회차 적립을 그대로 둔다", () => {
    const b = body("create or replace function public.admin_set_subscription_paused(");
    const resumePart = b.slice(b.indexOf("if not v_slot.paused then"));
    expect(resumePart).not.toContain("guard_pause_reschedules");
    expect(resumePart).toContain("public.missed_delivery_weeks(");
    expect(resumePart).toContain("paused_days    = coalesce(paused_days, 0) + v_missed * 7");
  });

  it("배송일 변경 RPC 는 정지 중 구독·다른 요일 자리를 거절하고, 기존 검사도 그대로 둔다", () => {
    const b = body("create or replace function public.admin_reschedule_shipment(");
    expect(b).toContain("and s.paused) then");
    expect(b).toContain("정지(건너뛰기) 중인 구독은 배송일을 옮길 수 없습니다");
    expect(b).toContain("i.delivery_day = v_to_day");
    expect(b).toContain("한 날에 두 회차를 보낼 수 없습니다");
    // 기존 규칙 유지
    expect(b).toContain("abs(p_to - p_from) >= 7");
    expect(b).toContain("public.is_dispatch_blocked(p_to)");
    expect(b).toContain("l.ship_date = p_from");
    expect(b).toContain("insert into public.order_events");
  });

  it("요일 변경 RPC 는 진행 중 배송일 변경·오늘이 새 요일 배송일이면 거절하고, 기발송 수 검사는 그대로 둔다", () => {
    const b = body("create or replace function public.change_delivery_day(");
    expect(b).toContain("x.to_date >= v_today");
    expect(b).toContain("옮겨 둔 배송이 있어 요일을 바꿀 수 없습니다");
    expect(b).toContain("if v_slot.started_at is not null and not v_slot.paused then");
    expect(b).toContain("public.ship_date_in_week(v_week_base) = v_today");
    expect(b).toContain("오늘이 새 요일의 배송일이라 지금은 바꿀 수 없습니다");
    expect(b).toContain("if v_before <> v_after then");
    expect(b).toContain("pg_advisory_xact_lock(hashtext('slot_day:' || p_new_day))");
  });
});

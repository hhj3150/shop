// supabase/audit-integrity.sql 은 사장님이 주 1회 직접 돌리는 운영 점검 파일이다.
// 코드가 아니라 문서라서 tsc·lint 가 지켜주지 않는다 — 여기서 최소한만 지킨다.
//
//   ① 정지 보정이 옛 규칙('경과 일수')으로 되돌아가지 않을 것.
//      #175 에서 정지 보정을 '놓친 회차 × 7일'(missed_delivery_weeks)로 바꿨는데 이 파일만
//      옛 산식이 남아 있었다. 그러면 정지 중인 구독의 model_delivered 가 틀어져, 멀쩡한
//      구독이 '출고 기록 누락'으로 잡히거나 진짜 누락이 가려진다.
//   ② 주문 코어 RPC 권한·가드 점검 항목이 빠지지 않을 것.
//      2026-09 외부 점검이 "타인 명의 주문 생성 가능"으로 지적한 자리다. 실제로는 이미
//      막혀 있었지만(코어는 postgres·service_role 만, 가드도 전부 생존), 한 번 뚫리면
//      돈이 직접 새는 자리라 점검을 상시로 남긴다.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const sql = readFileSync(
  fileURLToPath(new URL("../supabase/audit-integrity.sql", import.meta.url)),
  "utf8"
);

describe("audit-integrity.sql", () => {
  it("정지 보정에 옛 '경과 일수' 산식이 남아 있지 않다", () => {
    // `current_date - <무언가>.paused_at` 형태가 정지 보정에 쓰이면 옛 규칙이다.
    expect(sql).not.toMatch(/current_date\s*-\s*\w+\.paused_at/);
  });

  it("정지 보정은 missed_delivery_weeks 를 쓴다", () => {
    expect(sql).toContain("missed_delivery_weeks(");
  });

  it("주문 코어 RPC 실행권한 점검(Q)이 들어 있다", () => {
    expect(sql).toContain("_create_once_order_core");
    expect(sql).toMatch(/anon=|authenticated=/);
  });

  it("주문 RPC 서버 권위 가드 점검(R)이 세 가드를 모두 본다", () => {
    // 재고 0 차단 · 정가 기준 최소주문 24,000원 · 멱등키. 옛 25,000원 기준 잔존도 잡는다.
    for (const needle of ["'stock'", "'24000'", "'25000'", "'idempotency'"]) {
      expect(sql).toContain(needle);
    }
  });

  it("출고 기록 누락 조회가 방문수령·취소 주문을 제외한다", () => {
    // 방문수령은 택배 출고가 없어 기록이 원래 0건이고, 취소 주문의 살아 있는 좌석은
    // D 항목이 따로 잡는다. 안 거르면 멀쩡한 건이 섞여 진짜 누락이 그 안에 묻힌다.
    const detail = sql.split("-- 출고 기록이 실제 발송을 못 따라가는 구독")[1] ?? "";
    expect(detail).toContain("delivery_method <> '방문수령'");
    expect(detail).toContain("o.status <> '취소'");
  });

  it("모든 점검 항목이 한 결과 집합으로 이어진다(union all + order by 1)", () => {
    // 항목을 추가하다 union all 을 빠뜨리면 그 항목이 조용히 실행되지 않는다.
    // 파일 뒤쪽 '상세' 절은 전부 주석이라, 실행되는 앞부분만 잘라서 본다.
    const runnable = sql.split("-- ── 상세")[0].trimEnd();
    expect(runnable.endsWith("order by 1;")).toBe(true);
    // 항목 수 = 첫 select 1개 + union all 개수. 최소 17개(A~P + Q·R)는 되어야 한다.
    const items = 1 + (runnable.match(/union all select '/g) ?? []).length;
    expect(items).toBeGreaterThanOrEqual(17);
  });
});

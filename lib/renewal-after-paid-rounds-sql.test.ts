// 재구독 안내 대상 선정 — '결제한 회차를 다 보낸 뒤에만' 이 깨지지 않게 못박는다.
//
//   이 함수가 틀리면 손님이 받지도 않은 회차를 끝난 것으로 치고 재결제를 권한다.
//   박재우 님(24회 결제 · 10회 수령)에게 실제로 일어났던 일이다.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const sql = readFileSync(
  fileURLToPath(new URL("../supabase/migration-renewal-after-paid-rounds.sql", import.meta.url)),
  "utf8"
);

/** 주석(-- …)을 걷어낸 실행 SQL. 주석 속 문구를 근거로 삼지 않기 위해서다. */
const runnable = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");

describe("migration-renewal-after-paid-rounds.sql", () => {
  // 실제 발송 수를 묻지 않으면 이 수정은 통째로 없는 것과 같다.
  it("실제 발송 회차를 확정 기준점에서 가져온다", () => {
    expect(runnable).toMatch(/public\.slot_shipped_rounds\(s\.id\)/);
  });

  // 미확정 구독까지 새 규칙으로 끌고 가면, 기록이 비어 있는 90여 명의 안내가 한꺼번에
  //   멈춰 버린다. 확정 전에는 반드시 옛 동작이어야 점진 적용이 성립한다.
  it("미확정 구독은 옛 달력 규칙을 그대로 쓴다", () => {
    expect(runnable).toMatch(/when b\.shipped is null then/);
    const branch = runnable.slice(runnable.indexOf("when b.shipped is null then"));
    expect(branch.slice(0, branch.indexOf("when b.shipped >= b.total"))).toMatch(
      /order by d\.k desc\s*\n?\s*limit 1/
    );
  });

  // 다 보냈는데도 종료 안내가 안 나가면 구독이 조용히 끊긴다 — 반대 방향의 사고다.
  it("결제분을 다 보냈으면 오늘을 종료일로 잡는다", () => {
    expect(runnable).toMatch(/when b\.shipped >= b\.total then v_today/);
  });

  // 남은 회차는 '오늘 이후' 슬롯에만 들어간다. 과거 슬롯을 세면 이미 지난 날짜가
  //   종료일로 잡혀 안내가 또 일찍 나간다.
  it("남은 회차를 오늘 이후 배송 슬롯에서만 센다", () => {
    expect(runnable).toMatch(/where d\.ship_date >= v_today/);
    expect(runnable).toMatch(/offset \(b\.total - b\.shipped - 1\)/);
  });

  // 밀린 구독은 남은 회차가 달력 끝을 넘어간다. 구간을 안 늘리면 종료일이 null 이 되어
  //   그 손님이 대상에서 통째로 빠지고(안내 영영 없음) 구독이 조용히 끝난다.
  it("밀린 만큼 배송일 생성 구간을 늘린다", () => {
    expect(runnable).toMatch(/b\.total \+ \(\(v_today - b\.started_at\) \/ 7\)::int \+ 2/);
  });

  // 배송일 규칙(공휴일·휴배송 이월)을 여기서 다시 쓰면 배송 화면과 갈라진다.
  it("배송일은 SSOT(sub_delivery_dates)로만 만든다", () => {
    expect(runnable).toMatch(/public\.sub_delivery_dates\(/);
    expect(/date_trunc|generate_series|interval\s+'7 day/i.test(runnable)).toBe(false);
  });

  // 아래 둘은 이번 수정과 무관하지만, 함수를 통째로 replace 하므로 같이 사라질 수 있다.
  it("비밀키 검사를 그대로 유지한다", () => {
    expect(runnable).toMatch(/renewal_reminder_secret/);
    expect(runnable).toMatch(/raise exception 'forbidden'/);
  });

  it("입금대기 연장주문이 있으면 대상에서 빼는 규칙을 유지한다", () => {
    expect(runnable).toMatch(/r\.renews_slot_id = s\.id and r\.status = '입금대기'/);
    expect(runnable).toMatch(/not exists/);
  });

  it("정지·해지 구독은 대상이 아니다", () => {
    expect(runnable).toMatch(/s\.status = '활성'/);
    expect(runnable).toMatch(/s\.paused = false/);
  });

  // 문자열 검사는 '지웠는가'는 잡아도 '무력화했는가'는 못 잡는다.
  //   조건을 통째로 끄는 흔한 패턴 — 참/거짓 리터럴을 연산항으로 끼워 넣는 것 — 을 막는다.
  //   (`s.paused = false` 처럼 컬럼과 비교하는 것은 정상이라 걸리지 않아야 한다.)
  it("조건을 무력화하는 상수가 섞여 있지 않다", () => {
    expect(
      /\b(where|and|or|when)\s+false\b/i.test(runnable),
      "false 를 연산항으로 끼워 조건을 끄면 안 된다"
    ).toBe(false);
    expect(
      /\b(where|and|or|when)\s+true\b/i.test(runnable),
      "true 를 연산항으로 끼워 조건을 끄면 안 된다"
    ).toBe(false);
    expect(/\bif\s+false\s+then\b/i.test(runnable)).toBe(false);
  });

  // 안내 시점(종료 7일 전)은 이번에 바꾸지 않는다 — 바꿀 거면 따로 결정할 일이다.
  it("안내 구간(종료 7일 전 ~ 3일 후)은 그대로다", () => {
    expect(runnable).toMatch(/between \(v_today - 3\) and \(v_today \+ 7\)/);
  });
});

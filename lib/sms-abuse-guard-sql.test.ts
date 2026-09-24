// 문자 남용 차단 — migration + notify 라우트의 방어가 되돌아가지 않게 막는다.
//
//   /api/notify 는 로그인한 회원이면 누구나 부를 수 있고, 수신번호는 그 사람이 만든
//   주문의 ship_phone 이다 — 사실상 임의의 번호다. 종류별 1회 제한은 '주문 단위'라
//   주문을 계속 만들면 그만큼 문자가 나간다. Solapi 요금은 목장이 낸다.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const sql = read("../supabase/migration-sms-abuse-guard.sql");
const runnable = sql
  .split("\n")
  .filter((line) => !line.trimStart().startsWith("--"))
  .join("\n");
const route = read("../app/api/notify/route.ts");

describe("migration-sms-abuse-guard.sql", () => {
  it("번호당 일일 발송 수를 세는 RPC 가 있다", () => {
    expect(runnable).toContain("function public.sms_daily_count(p_secret text, p_to_phone text)");
    expect(runnable).toMatch(/l\.ok is true/);
  });

  it("KST 기준으로 '오늘'을 센다 — UTC 면 새벽 아홉 시간이 어제로 샌다", () => {
    expect(runnable).toMatch(/sent_at at time zone 'Asia\/Seoul'\)::date/);
    expect(runnable).toMatch(/now\(\) at time zone 'Asia\/Seoul'\)::date/);
  });

  it("관리자 알림은 세지 않는다 — 사고 알림이 상한에 걸리면 상한이 사고를 덮는다", () => {
    expect(runnable).toMatch(/channel, ''\) <> 'admin_alert'/);
  });

  it("번호는 숫자만 남겨 비교한다(010-1234-5678 = 01012345678)", () => {
    expect(runnable).toMatch(/regexp_replace\(coalesce\(p_to_phone, ''\), '\[\^0-9\]', '', 'g'\)/);
  });

  it("슬롯 단위 중복발송 판정 RPC 가 있다", () => {
    expect(runnable).toContain("function public.sms_already_sent_slot");
    expect(runnable).toMatch(/meta ->> 'slotId'/);
  });

  it("두 RPC 모두 시크릿 게이트를 지난다", () => {
    const gates = runnable.match(/p_secret <> v_expected then\s+raise exception 'forbidden'/g) ?? [];
    expect(gates.length).toBe(2);
  });
});

describe("app/api/notify — 남용 차단", () => {
  it("해지 문자는 실제로 '해지'된 슬롯만 보낸다", () => {
    // 상태를 안 보면 살아 있는 구독에도 '해지가 접수되었습니다'가 나간다(손님 혼란 + 비용).
    expect(route).toMatch(/slot\.status !== "해지"/);
    expect(route).toContain('reason: "not_cancelled"');
    expect(route).toMatch(/\.select\("status, refund_amount, order_id, user_id"\)/);
  });

  it("해지 문자는 슬롯당 한 번 — 상태는 계속 '해지'라 상태 검사만으로는 못 막는다", () => {
    expect(route).toMatch(/alreadySentForSlot\("subscription_cancelled", slotId\)/);
    expect(route).toContain("sms_already_sent_slot");
  });

  it("일일 상한을 발송 직전에 확인한다", () => {
    expect(route).toContain("overDailyCap(phone)");
  });

  it("관리자 전용 종류는 상한에서 제외한다 — 상한이 운영을 막으면 안 된다", () => {
    expect(route).toMatch(/!ADMIN_KINDS\.has\(kind\) && \(await overDailyCap\(phone\)\)/);
  });

  it("상한에 걸린 건도 이력에 남긴다 — 왜 안 갔는지 나중에 알 수 있어야 한다", () => {
    expect(route).toContain('failReason: "daily_cap_exceeded"');
  });

  it("선물 메시지는 서버에서도 80자로 자른다(화면 maxLength 와 같은 값)", () => {
    // 임의의 번호로 나가는 자유 문구라, 화면 제한만 믿으면 RPC 직접 호출로 뚫린다.
    expect(route).toContain("GIFT_MESSAGE_MAX = 80");
    expect(route).toMatch(/\.slice\(0, GIFT_MESSAGE_MAX\)/);
  });
});

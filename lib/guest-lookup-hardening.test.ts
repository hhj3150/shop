// 비회원 주문조회 강화 — 세 방어가 되돌아가지 않게 막는다.
//
//   ① 주문번호 엔트로피: 무작위 부분이 네 자리 숫자면 날짜당 후보가 9,000개뿐이라,
//      전화번호 하나를 아는 사람이 전부 훑어볼 수 있다.
//   ② 조회 경로: RPC 가 anon 에 직접 열려 있으면 호출 횟수를 셀 자리가 없다.
//   ③ PayAction 주문자 연락처: 클라이언트 값을 쓰면 임의의 번호로 알림톡이 나간다.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel: string) =>
  readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const stripComments = (sql: string) =>
  sql
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("--"))
    .join("\n");

const hardening = stripComments(read("../supabase/migration-guest-lookup-hardening.sql"));
const revoke = stripComments(read("../supabase/migration-guest-lookup-revoke.sql"));
const route = read("../app/api/orders/lookup/route.ts");
const page = read("../app/orders/lookup/page.tsx");
const register = read("../app/api/payaction/register/route.ts");
const orders = read("../lib/orders.ts");

describe("① 주문번호 엔트로피", () => {
  it("무작위 부분이 영숫자 8자다", () => {
    expect(hardening).toContain("function public.gen_order_no()");
    expect(hardening).toMatch(/for i in 1\.\.8 loop/);
    expect(hardening).toContain("'ABCDEFGHJKMNPQRSTUVWXYZ23456789'");
  });

  it("혼동 문자(O·0·I·1·L)를 알파벳에서 뺀다 — 손님이 전화로 불러 준다", () => {
    const m = /alphabet text := '([A-Z0-9]+)'/.exec(hardening);
    expect(m).not.toBeNull();
    const alphabet = m![1];
    for (const ch of ["O", "0", "I", "1", "L"]) {
      expect(alphabet).not.toContain(ch);
    }
  });

  it("네 자리 숫자 방식으로 돌아가지 않는다", () => {
    expect(hardening).not.toMatch(/floor\(random\(\) \* 9000\)/);
  });

  it("중복이면 다시 뽑는다", () => {
    expect(hardening).toMatch(/exit when not exists \(select 1 from public\.orders where order_no = v_no\)/);
  });

  it("PayAction 한도(22자)를 넘지 않는다", () => {
    // 'SY'(2) + YYYYMMDD(8) + '-'(1) + 무작위(8) = 19자
    expect(2 + 8 + 1 + 8).toBeLessThanOrEqual(22);
  });
});

describe("② 조회 경로", () => {
  it("시크릿 게이트 3-인자판이 있다", () => {
    expect(hardening).toMatch(/function public\.lookup_order_by_no_phone\(\s*p_order_no text,\s*p_phone\s+text,\s*p_secret\s+text/);
    expect(hardening).toMatch(/p_secret <> v_expected then\s+raise exception 'forbidden'/);
  });

  it("권한 회수는 별도 파일이다 — 배포 전에 적용하면 조회가 멈춘다", () => {
    // 추가만 하는 파일과 회수하는 파일을 나눠, 적용 순서를 틀려도 손님이 막히지 않게 한다.
    expect(hardening).not.toMatch(/revoke execute on function public\.lookup_order_by_no_phone\(text, text\)/);
    expect(revoke).toMatch(/revoke execute on function public\.lookup_order_by_no_phone\(text, text\) from anon/);
  });

  it("authenticated 도 회수한다 — anon 만 막으면 회원가입으로 우회된다", () => {
    expect(revoke).toMatch(
      /revoke execute on function public\.lookup_order_by_no_phone\(text, text\) from authenticated/
    );
  });

  it("회수 파일은 3-인자판이 있는지 먼저 확인한다", () => {
    expect(revoke).toContain("lookup_order_by_no_phone(text,text,text)");
    expect(revoke).toMatch(/raise exception '선행 누락/);
  });

  it("라우트가 IP 단위 호출 제한을 건다", () => {
    expect(route).toContain("assistant_rate_check");
    expect(route).toMatch(/order-lookup:\$\{clientIp\(req\)\}/);
    expect(route).toMatch(/RATE_LIMIT = \d+/);
  });

  it("제한에 걸리면 429 + Retry-After", () => {
    expect(route).toContain("status: 429");
    expect(route).toContain('"Retry-After"');
  });

  it("입력 미달은 RPC 를 부르지 않는다 — 제한 횟수를 낭비하지 않는다", () => {
    expect(route).toMatch(/orderNo\.length < 8 \|\| phone\.length < 10/);
  });

  it("조회 화면이 RPC 를 직접 부르지 않는다", () => {
    expect(page).not.toContain('rpc("lookup_order_by_no_phone"');
    expect(page).toContain('fetch("/api/orders/lookup"');
  });
});

describe("③ PayAction 주문자 연락처", () => {
  it("연락처를 DB 에서 읽는다", () => {
    expect(hardening).toContain("function public.order_orderer_contact");
    expect(register).toContain('rpc("order_orderer_contact"');
  });

  it("선물이면 보내는 분(주문한 회원)의 번호를 쓴다", () => {
    expect(hardening).toMatch(/if v_o\.is_gift and v_o\.user_id is not null then/);
    expect(hardening).toMatch(/from public\.profiles p where p\.id = v_o\.user_id/);
  });

  it("클라이언트가 보낸 연락처·이메일을 쓰지 않는다", () => {
    expect(register).not.toContain("body.ordererPhone");
    expect(register).not.toContain("body.ordererEmail");
  });

  it("클라이언트 함수에서도 연락처 인자를 없앴다 — 보낼 자리가 남으면 다시 쓰인다", () => {
    expect(orders).toContain("registerPayActionDeposit(orderNo: string)");
    expect(orders).toContain("JSON.stringify({ orderNo })");
  });
});

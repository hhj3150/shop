// #253 후속(2026-11-24 독립 검토) — 운영 DB 에 적용한 정의를 저장소에서 고정한다.
//   운영 함수는 롤백 블록에서 6개 경우(T1~T6)를 굴려 확인한 뒤 적용했다. 여기서는 그 규칙이
//   다음 마이그레이션에서 조용히 사라지지 않도록 본문을 읽어 확인한다(guest-lookup-hardening 과 같은 방식).
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(__dirname, "..");
const sql = readFileSync(join(root, "supabase/migration-renewal-ship-to-followups.sql"), "utf8");
const route = readFileSync(join(root, "app/api/payaction/register/route.ts"), "utf8");
const admin = readFileSync(join(root, "app/admin/page.tsx"), "utf8");

function fnBody(name: string): string {
  const start = sql.indexOf(`create or replace function public.${name}(`);
  expect(start, `${name} 정의가 있어야 한다`).toBeGreaterThan(-1);
  const end = sql.indexOf("$$;", start);
  return sql.slice(start, end);
}

describe("① 다음 연장의 기본 받는 곳 = 마지막 확정 블록", () => {
  const body = fnBody("request_renewal");
  it("가장 최근 입금확인 연장의 받는 곳을 먼저 찾는다(created_at, id 역순)", () => {
    expect(body).toMatch(/select \* into v_ship_src\s+from public\.orders\s+where renews_slot_id = p_slot_id/);
    expect(body).toMatch(/order by created_at desc, id desc/);
    expect(body).toMatch(/'입금확인', '배송준비', '배송중', '배송완료'/);
  });
  it("없으면 원주문으로 떨어진다", () => {
    expect(body).toMatch(/if not found then\s+select \* into v_ship_src from public\.orders where id = v_slot\.order_id;/);
  });
  it("받는 곳·배송비는 그 원본(또는 p_ship) 기준, 선물·방법은 원주문 기준", () => {
    expect(body).toMatch(/v_ship_addr\s+:= v_ship_src\.ship_address/);
    expect(body).toMatch(/is_special_delivery_postcode\(v_ship_post\)/);
    expect(body).toMatch(/coalesce\(v_src\.is_gift, false\), v_src\.gifter_name/);
  });
  it("따로 정한 받는 곳 표시를 물려받거나(p_ship 이면) 켠다", () => {
    expect(body).toMatch(/v_custom\s+:= coalesce\(v_ship_src\.ship_to_custom, false\)/);
    expect(body).toMatch(/v_custom\s+:= true;/);
  });
});

describe("② PayAction 입금 완료 알림은 회원에게", () => {
  const body = fnBody("order_orderer_contact");
  it("선물뿐 아니라 연장 주문도 회원 프로필 번호를 쓴다", () => {
    expect(body).toMatch(/v_o\.is_gift or v_o\.renews_slot_id is not null/);
    expect(body).toMatch(/from public\.profiles p where p\.id = v_o\.user_id/);
  });
  it("연장 주문이면 주문자 이름도 회원 이름으로 준다", () => {
    expect(body).toMatch(/'orderer_name'/);
  });
  it("라우트가 그 이름을 주문자로 쓴다(배송 받는 분 이름이 아니라)", () => {
    expect(route).toMatch(/c\.orderer_name\?\.trim\(\)\) ordererName = c\.orderer_name\.trim\(\)/);
  });
});

describe("③ 따로 정한 받는 곳은 정보 동기화가 덮지 않는다", () => {
  it("손님 내 정보 동기화가 ship_to_custom 을 건너뛴다", () => {
    expect(fnBody("sync_my_order_shipping")).toMatch(/and not ship_to_custom/);
  });
  it("연장분 받는 곳 변경이 표시를 켠다", () => {
    expect(fnBody("set_my_renewal_ship_to")).toMatch(/ship_to_custom\s+= true/);
  });
  it("관리자 회원 정보 저장도 건너뛰고, 연장 주문 개별 수정은 표시를 켠다", () => {
    expect(admin).toMatch(/\.eq\("ship_to_custom", false\)/);
    expect(admin).toMatch(/order\.renews_slot_id != null \? \{ ship_to_custom: true \}/);
  });
});

describe("④ 배송비 판정은 실제 청구액 기준", () => {
  it("저장된 우편번호가 아니라 청구한 회당 배송비로 도서산간 여부를 본다", () => {
    const body = fnBody("set_my_renewal_ship_to");
    expect(body).toMatch(/v_charged_special := coalesce\(v_o\.shipping_fee, 0\) >= 5000 \* greatest/);
    expect(body).not.toMatch(/is_special_delivery_postcode\(v_o\.ship_postcode\)/);
  });
});

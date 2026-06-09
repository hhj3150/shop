import { describe, it, expect } from "vitest";
import { searchAdmin, type AdminSearchMember, type AdminSearchOrder } from "./admin-search";

const members: AdminSearchMember[] = [
  { id: "u1", name: "김종민", phone: "010-1111-2222", address: "서울시 강남구" },
  { id: "u2", name: "김민수", phone: "01033334444", address: "부산시 해운대구" },
  { id: "u3", name: "박영희", phone: "010-5555-6666", address: null },
];

const orders: AdminSearchOrder[] = [
  { order_no: "SY-1001", user_id: "u1", ship_name: "김종민", ship_phone: "010-1111-2222", depositor_name: "김종민", status: "입금확인", created_at: "2026-06-01T00:00:00Z" },
  { order_no: "SY-1002", user_id: null, ship_name: "이손님", ship_phone: "010-7777-8888", depositor_name: "이손님", status: "입금대기", created_at: "2026-06-05T00:00:00Z" },
  { order_no: "SY-1003", user_id: "u2", ship_name: "김민수", ship_phone: "01033334444", depositor_name: "엄마카드", status: "배송중", created_at: "2026-06-03T00:00:00Z" },
];

const data = { members, orders };

describe("searchAdmin", () => {
  it("빈 쿼리는 빈 결과", () => {
    expect(searchAdmin("", data)).toEqual({ members: [], orders: [] });
    expect(searchAdmin("   ", data)).toEqual({ members: [], orders: [] });
  });

  it("이름 부분일치로 회원을 찾는다", () => {
    const r = searchAdmin("김종", data);
    expect(r.members.map((m) => m.userId)).toContain("u1");
    expect(r.members[0].userId).toBe("u1"); // startsWith 가 상위
  });

  it("이름이 여럿 매칭되면 startsWith 가 includes 보다 상위", () => {
    // "김"으로 검색: 김종민·김민수 모두 startsWith → 입력 순서 유지
    const r = searchAdmin("김", data);
    expect(r.members.map((m) => m.userId)).toEqual(["u1", "u2"]);
  });

  it("전화는 하이픈 무시하고 숫자만으로 매칭", () => {
    const r = searchAdmin("010-1111", data);
    expect(r.members.map((m) => m.userId)).toContain("u1");
    const r2 = searchAdmin("33334444", data);
    expect(r2.members.map((m) => m.userId)).toContain("u2");
  });

  it("주소 부분일치로 회원을 찾는다", () => {
    const r = searchAdmin("해운대", data);
    expect(r.members.map((m) => m.userId)).toEqual(["u2"]);
  });

  it("주문번호로 주문을 찾는다", () => {
    const r = searchAdmin("SY-1002", data);
    expect(r.orders.map((o) => o.orderNo)).toContain("SY-1002");
    expect(r.orders[0].userId).toBeNull(); // 게스트 주문
  });

  it("입금자명으로 주문을 찾는다", () => {
    const r = searchAdmin("엄마카드", data);
    expect(r.orders.map((o) => o.orderNo)).toEqual(["SY-1003"]);
  });

  it("주문 동점은 최신순", () => {
    // 'SY-10' 은 세 주문 모두 includes → created_at 내림차순
    const r = searchAdmin("SY-10", data);
    expect(r.orders.map((o) => o.orderNo)).toEqual(["SY-1002", "SY-1003", "SY-1001"]);
  });

  it("limit 으로 그룹별 개수를 제한", () => {
    const r = searchAdmin("SY-10", data, 2);
    expect(r.orders).toHaveLength(2);
  });
});

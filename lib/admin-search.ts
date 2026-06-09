// 관리자 전역 검색 — 이미 로드된 회원/주문을 이름·전화·주소·주문번호·입금자명으로
//   부분일치 검색하는 순수 함수. React/Supabase 비의존 — 단위 테스트 대상.
//   전화는 하이픈·공백을 무시하고 숫자만으로 비교한다("010-1234" → "01012340000" 매칭).

export type AdminSearchMember = {
  id: string;
  name: string;
  phone: string;
  address: string | null;
};

export type AdminSearchOrder = {
  order_no: string;
  user_id: string | null;
  ship_name: string;
  ship_phone: string;
  depositor_name: string | null;
  status: string;
  created_at: string;
};

export type MemberHit = {
  kind: "member";
  userId: string;
  name: string;
  phone: string;
  address: string | null;
};

export type OrderHit = {
  kind: "order";
  orderNo: string;
  userId: string | null;
  name: string;
  status: string;
  createdAt: string;
};

export type AdminSearchResult = {
  members: MemberHit[];
  orders: OrderHit[];
};

// 소문자화 + 공백 제거(부분일치 비교용).
function norm(s: string | null | undefined): string {
  return (s ?? "").toLowerCase().replace(/\s+/g, "");
}

// 숫자만 추출(전화 비교용).
function digits(s: string | null | undefined): string {
  return (s ?? "").replace(/[^0-9]/g, "");
}

// 회원 1명의 매칭 점수(낮을수록 상위). 미매칭이면 null.
function memberScore(m: AdminSearchMember, q: string, qDigits: string): number | null {
  const name = norm(m.name);
  if (name.startsWith(q)) return 0;
  if (name.includes(q)) return 1;
  if (qDigits && digits(m.phone).includes(qDigits)) return 2;
  if (norm(m.address).includes(q)) return 3;
  return null;
}

// 주문 1건의 매칭 점수(낮을수록 상위). 미매칭이면 null.
function orderScore(o: AdminSearchOrder, q: string, qDigits: string): number | null {
  const no = norm(o.order_no);
  if (no.startsWith(q)) return 0;
  if (no.includes(q)) return 1;
  if (norm(o.ship_name).includes(q)) return 2;
  if (qDigits && digits(o.ship_phone).includes(qDigits)) return 3;
  if (norm(o.depositor_name).includes(q)) return 4;
  return null;
}

// 안정 정렬: 점수 오름차순, 동점은 입력 순서 유지.
function rankBy<T>(items: T[], score: (t: T) => number | null): T[] {
  const scored: { t: T; s: number; i: number }[] = [];
  items.forEach((t, i) => {
    const s = score(t);
    if (s !== null) scored.push({ t, s, i });
  });
  scored.sort((a, b) => (a.s !== b.s ? a.s - b.s : a.i - b.i));
  return scored.map((x) => x.t);
}

/**
 * 전역 검색. query 가 비면 빈 결과. 회원·주문을 각각 limit 개까지 반환한다.
 * 전화 검색은 숫자만으로 비교하므로 하이픈 유무와 무관하다.
 */
export function searchAdmin(
  query: string,
  data: { members: AdminSearchMember[]; orders: AdminSearchOrder[] },
  limit = 6
): AdminSearchResult {
  const q = norm(query);
  if (!q) return { members: [], orders: [] };
  const qDigits = digits(query);

  const members = rankBy(data.members, (m) => memberScore(m, q, qDigits))
    .slice(0, limit)
    .map((m): MemberHit => ({
      kind: "member",
      userId: m.id,
      name: m.name,
      phone: m.phone,
      address: m.address,
    }));

  // 주문은 동점이면 최신순(created_at 내림차순)으로 보이도록 사전 정렬 후 점수 정렬한다.
  const ordersByRecent = [...data.orders].sort((a, b) =>
    a.created_at < b.created_at ? 1 : a.created_at > b.created_at ? -1 : 0
  );
  const orders = rankBy(ordersByRecent, (o) => orderScore(o, q, qDigits))
    .slice(0, limit)
    .map((o): OrderHit => ({
      kind: "order",
      orderNo: o.order_no,
      userId: o.user_id,
      name: o.ship_name,
      status: o.status,
      createdAt: o.created_at,
    }));

  return { members, orders };
}

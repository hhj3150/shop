// PostgREST 행 상한(기본 1000)을 넘는 표를 '빠짐없이' 읽는다.
//
//   ★ 왜 필요한가 (2026-11-24)
//     출고 이력(shipment_log)을 페이지 없이 한 번에 읽고 있었다. 986행일 때 발견했는데,
//     1000행을 넘는 순간부터 서버가 앞의 1000행만 돌려주고 나머지는 '조용히' 버린다.
//     오류가 나지 않으니 화면은 멀쩡해 보이지만, 빠진 행의 회차는 '안 보낸 회차'가 되어
//     배송판의 출고 표시·과배송 방어선·확정 회차 계산이 한꺼번에 틀어진다.
//
//   규칙
//   · 반드시 정렬이 정해진 쿼리를 넘긴다(정렬 없이 range 로 자르면 페이지끼리 겹치거나 빠진다).
//   · 첫 요청에 전체 행 수(count)를 받아, 그만큼 모일 때까지 읽는다. 서버 상한이 1000 보다
//     작게 설정돼 있어도 '받은 행 수'만큼 다음 페이지로 넘어가므로 빠지지 않는다.
//   · 오류는 그대로 던진다. 일부만 읽고 멈추면 '일부가 전부인 척'하게 되므로, 차라리
//     화면이 실패를 알리게 한다(호출처가 이미 오류 문구를 띄운다).
export type PageResult<T> = { data: T[] | null; error: unknown; count?: number | null };

export const PAGE_SIZE = 1000;
// 무한 반복 방지선. 1000행 × 500쪽 = 50만 행 — 이 상점 규모에선 닿을 일이 없다.
const MAX_PAGES = 500;

export async function fetchAllPages<T>(
  page: (from: number, to: number, withCount: boolean) => PromiseLike<PageResult<T>>
): Promise<T[]> {
  const out: T[] = [];
  let total: number | null = null;
  for (let i = 0, from = 0; i < MAX_PAGES; i++) {
    const { data, error, count } = await page(from, from + PAGE_SIZE - 1, i === 0);
    if (error) throw error;
    if (i === 0 && typeof count === "number") total = count;
    const rows = data ?? [];
    if (rows.length === 0) break;
    out.push(...rows);
    from += rows.length;
    if (total != null && out.length >= total) break;
  }
  return out;
}

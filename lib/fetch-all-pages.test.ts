import { describe, expect, it } from "vitest";
import { fetchAllPages, PAGE_SIZE, type PageResult } from "./fetch-all-pages";

// 서버 흉내: rows 를 cap 행씩만 돌려준다(PostgREST max_rows).
function fakeServer(total: number, cap: number) {
  const rows = Array.from({ length: total }, (_, i) => i);
  const calls: Array<[number, number]> = [];
  const page = async (from: number, to: number, withCount: boolean): Promise<PageResult<number>> => {
    calls.push([from, to]);
    const end = Math.min(to + 1, from + cap, rows.length);
    return { data: rows.slice(from, end), error: null, count: withCount ? total : null };
  };
  return { page, calls };
}

describe("fetchAllPages", () => {
  it("상한(1000)을 넘는 표를 빠짐없이 읽는다 — 1006행", async () => {
    const { page } = fakeServer(1006, 1000);
    const got = await fetchAllPages(page);
    expect(got).toHaveLength(1006);
    expect(new Set(got).size).toBe(1006);
  });

  it("서버 상한이 요청 크기보다 작아도(500) 받은 만큼 넘어가 빠지지 않는다", async () => {
    const { page } = fakeServer(1234, 500);
    const got = await fetchAllPages(page);
    expect(got).toEqual(Array.from({ length: 1234 }, (_, i) => i));
  });

  it("상한 미만이면 요청 1회로 끝난다(지금과 같은 비용)", async () => {
    const { page, calls } = fakeServer(986, 1000);
    expect(await fetchAllPages(page)).toHaveLength(986);
    expect(calls).toEqual([[0, PAGE_SIZE - 1]]);
  });

  it("빈 표는 빈 배열", async () => {
    const { page } = fakeServer(0, 1000);
    expect(await fetchAllPages(page)).toEqual([]);
  });

  it("중간에 오류가 나면 일부만 돌려주지 않고 던진다", async () => {
    let n = 0;
    const page = async (from: number): Promise<PageResult<number>> => {
      n++;
      if (n === 2) return { data: null, error: new Error("boom") };
      return { data: Array.from({ length: 1000 }, (_, i) => from + i), error: null, count: 1500 };
    };
    await expect(fetchAllPages(page)).rejects.toThrow("boom");
  });

  it("count 를 못 받아도 빈 페이지가 나올 때까지 읽는다", async () => {
    const rows = Array.from({ length: 2100 }, (_, i) => i);
    const page = async (from: number, to: number): Promise<PageResult<number>> => ({
      data: rows.slice(from, Math.min(to + 1, from + 1000)),
      error: null,
      count: null,
    });
    expect(await fetchAllPages(page)).toHaveLength(2100);
  });
});

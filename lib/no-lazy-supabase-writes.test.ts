import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// supabase-js 의 쿼리 빌더(PostgrestBuilder)는 '게으르다' — then() 안에서 비로소
//   fetch 를 시작한다. 그래서 await 도 .then() 도 없이 `void builder` 로만 두면
//   식만 만들어지고 **요청이 아예 나가지 않는다**. 컴파일도 린트도 통과하고,
//   런타임 오류도 없다. 그냥 조용히 아무 일도 일어나지 않는다.
//
//   2026-09-24 이 실수로 세 곳이 죽어 있었다:
//     · lib/track.ts        → funnel_events 서비스 시작 이래 0건(퍼널을 전혀 못 봄)
//     · app/admin/page.tsx  → order_events 2건뿐(주문 상태변경 이력 통째로 누락)
//
//   눈에 보이지 않는 결함이라 사람이 지킬 수 없다. 정적으로 막는다.

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const DIRS = ["app", "components", "lib"];
const EXT = new Set([".ts", ".tsx"]);

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = path.join(dir, name);
    if (statSync(p).isDirectory()) {
      if (name === "node_modules" || name === ".next") continue;
      walk(p, out);
    } else if (EXT.has(path.extname(name))) {
      out.push(p);
    }
  }
  return out;
}

// `void <supabase 빌더 체인>` 중 .then( 이 없는 것을 찾는다.
//   supabase 접근은 getSupabase() / sb. / supabase. 셋 중 하나로 시작한다.
const VOID_CHAIN =
  /\bvoid\s+(?:get[Ss]upabase\(\)|sb|supabase)\s*[\s\S]{0,600}?;/g;

describe("supabase 쓰기가 조용히 사라지지 않는다", () => {
  const files = DIRS.flatMap((d) => walk(path.join(ROOT, d)));

  it("검사할 소스 파일이 존재한다", () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it("void 로만 던져 둔 supabase 호출이 없다 (then 없으면 요청이 안 나간다)", () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (f.endsWith("no-lazy-supabase-writes.test.ts")) continue;
      const src = readFileSync(f, "utf8");
      for (const m of src.matchAll(VOID_CHAIN)) {
        const chunk = m[0];
        // .then( 이나 await 이 붙어 있으면 실제로 실행된다 — 통과.
        if (chunk.includes(".then(") || chunk.includes("await ")) continue;
        const line = src.slice(0, m.index ?? 0).split("\n").length;
        offenders.push(`${path.relative(ROOT, f)}:${line}`);
      }
    }
    expect(
      offenders,
      `쿼리 빌더는 then() 을 불러야 요청이 나갑니다. .then(() => {}, () => {}) 를 붙이세요:\n  ${offenders.join(
        "\n  "
      )}`
    ).toEqual([]);
  });
});

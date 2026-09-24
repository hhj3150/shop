// 저장소 안에서 '여러 파일에 중복 정의된 함수'를 찾아 표로 낸다.
//
//   [왜] supabase/*.sql 은 적용 이력이지 현재 정의가 아니다. 한 함수가 여러 파일에서
//     create or replace 되면, grep 으로 먼저 걸린 파일이 최신이라는 보장이 없다.
//     실제로 외부 점검이 옛 정의를 읽고 "UTC 버그가 있다"고 두 건을 잘못 지적했다
//     (운영 DB 는 이미 KST 였다). 그 함정이 어디에 있는지 기계적으로 드러낸다.
//
//   실행: node supabase/list-redefinitions.mjs
//   README.md 의 목록을 갱신할 때 이 출력을 쓴다.
import { readFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";

const DIR = path.dirname(new URL(import.meta.url).pathname);
const RE = /create\s+or\s+replace\s+function\s+(?:public\.)?([a-z0-9_]+)\s*\(/gi;

const files = readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();

/** 파일별 마지막 커밋 시각(초). 커밋되지 않은 파일은 0. */
function lastCommit(file) {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%ct", "--", `supabase/${file}`], {
      cwd: path.join(DIR, ".."),
      encoding: "utf8",
    }).trim();
    return out ? Number(out) : 0;
  } catch {
    return 0;
  }
}

const times = new Map(files.map((f) => [f, lastCommit(f)]));
const defs = new Map(); // fn -> Set<file>

for (const f of files) {
  const src = readFileSync(path.join(DIR, f), "utf8");
  for (const m of src.matchAll(RE)) {
    const fn = m[1].toLowerCase();
    if (!defs.has(fn)) defs.set(fn, new Set());
    defs.get(fn).add(f);
  }
}

const multi = [...defs.entries()]
  .filter(([, fs]) => fs.size > 1)
  .map(([fn, fs]) => {
    const arr = [...fs];
    // 가장 나중에 커밋된 파일이 '아마도' 최신이다 — 확정은 운영 DB 만 할 수 있다.
    const latest = arr.sort((a, b) => times.get(b) - times.get(a) || a.localeCompare(b))[0];
    return { fn, count: fs.size, latest, all: arr };
  })
  .sort((a, b) => b.count - a.count || a.fn.localeCompare(b.fn));

console.log(`SQL 파일 ${files.length}개 · 함수 ${defs.size}종 · 중복 정의 ${multi.length}종\n`);
console.log("| 함수 | 정의된 파일 수 | 마지막으로 커밋된 파일(참고용) |");
console.log("| --- | --- | --- |");
for (const m of multi) {
  console.log(`| \`${m.fn}\` | ${m.count} | \`${m.latest}\` |`);
}
console.log(`\n※ '마지막으로 커밋된 파일'은 참고일 뿐이다. 현재 정의는 운영 DB 만이 안다.`);

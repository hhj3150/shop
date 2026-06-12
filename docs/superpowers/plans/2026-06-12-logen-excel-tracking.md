# 로젠 엑셀 송장 일괄 기재 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 로젠 `주문실적조회.xlsx`를 관리자 배송 패널에 업로드해 수하인명+휴대폰 앞7자리로 주문을 매칭하고, 운영자 승인분만 운송장번호를 일괄 기재한다.

**Architecture:** 순수 함수 2개(`logen-excel` 파싱 · `logen-match` 매칭) + 중립 전화 유틸(`phone`)을 만들고, 클라이언트 컴포넌트 `DispatchPanel`에 파일 업로드·미리보기 UI를 얹어 기존 `tracking[]` state/발송 플로우(`decideShipOut`)에 연결한다. xlsx 파싱은 SheetJS를 동적 import한다.

**Tech Stack:** TypeScript, Next.js(클라 컴포넌트), Supabase, vitest, SheetJS(`xlsx`).

**Spec:** `docs/superpowers/specs/2026-06-12-logen-excel-tracking-design.md`

**테스트 실행:** `npx vitest run <파일>` · 타입체크: `npx tsc --noEmit`

---

## File Structure

- Create `lib/phone.ts` — 중립 전화 정규화(`normalizePhone`: 비숫자 제거 + `+82`→`0`). 클라/서버 공용.
- Create `lib/phone.test.ts`
- Modify `lib/payaction.ts` — 자체 `normalizePhone`를 `lib/phone.ts` 재export/위임으로 교체(동작 불변).
- Create `lib/logen-excel.ts` — 시트 2차원 배열 → `LogenRow[]` 파서(헤더 텍스트 탐지).
- Create `lib/logen-excel.test.ts`
- Create `lib/logen-match.ts` — `LogenRow[]` × 후보주문 → `{matched, alreadyFilled, ambiguous, unmatched}`.
- Create `lib/logen-match.test.ts`
- Modify `components/DispatchPanel.tsx` — 업로드 입력 + 미리보기 + 적용(courier=logen 가드).
- Modify `package.json` — `xlsx` 의존성 추가.

---

## Chunk 1: 순수 로직 (phone · excel · match)

### Task 1: 전화 정규화 유틸 추출 (`lib/phone.ts`)

**Files:**
- Create: `lib/phone.ts`
- Test: `lib/phone.test.ts`
- Modify: `lib/payaction.ts` (기존 `normalizePhone` 위임)

- [ ] **Step 1: 실패 테스트 작성** — `lib/phone.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { normalizePhone, phone7 } from "./phone";

describe("normalizePhone", () => {
  it("하이픈/공백 제거", () => {
    expect(normalizePhone("010-7663-1234")).toBe("01076631234");
  });
  it("+82 국가코드를 0으로", () => {
    expect(normalizePhone("+82 10-7663-1234")).toBe("01076631234");
    expect(normalizePhone("821076631234")).toBe("01076631234");
  });
  it("null/빈값은 빈문자", () => {
    expect(normalizePhone(null)).toBe("");
    expect(normalizePhone("")).toBe("");
  });
});

describe("phone7", () => {
  it("정규화 후 앞 7자리", () => {
    expect(phone7("010-7663-1234")).toBe("0107663");
    expect(phone7("+82 10-7663-1234")).toBe("0107663");
  });
  it("7자리 미만이면 빈문자", () => {
    expect(phone7("010-12")).toBe("");
    expect(phone7(null)).toBe("");
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run lib/phone.test.ts` → FAIL(모듈 없음)

- [ ] **Step 3: 구현** — `lib/phone.ts`

```ts
// 전화번호 정규화 — 클라/서버 공용(서버전용 모듈 비의존).
//   payaction.ts 의 기존 로직과 동일: 비숫자 제거 후 '82' 국가코드는 '0' 으로 치환.
export function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  return digits.startsWith("82") ? "0" + digits.slice(2) : digits;
}

// 정규화 후 앞 7자리(010+중간4). 마스킹 매칭 키. 7자리 미만이면 무효(빈문자).
export function phone7(raw: string | null | undefined): string {
  const d = normalizePhone(raw);
  return d.length >= 7 ? d.slice(0, 7) : "";
}
```

- [ ] **Step 4: 통과 확인** — `npx vitest run lib/phone.test.ts` → PASS

- [ ] **Step 5: payaction 위임** — `lib/payaction.ts:13` 의 `normalizePhone` 본문을 `lib/phone.ts` 재사용으로 교체. 기존 시그니처/동작 보존:

```ts
import { normalizePhone } from "./phone";
export { normalizePhone };
```
(기존 `export function normalizePhone(raw: string): string {…}` 정의 제거. 호출부 `normalizePhone(input.ordererPhone)` 는 그대로 동작.)

- [ ] **Step 6: 회귀 확인** — `npx vitest run lib/payaction` 및 `npx tsc --noEmit` → PASS/0 errors

- [ ] **Step 7: Commit**

```bash
git add lib/phone.ts lib/phone.test.ts lib/payaction.ts
git commit -m "refactor: 전화 정규화를 클라/서버 공용 lib/phone.ts 로 추출"
```

---

### Task 2: 로젠 엑셀 파서 (`lib/logen-excel.ts`)

**Files:**
- Create: `lib/logen-excel.ts`
- Test: `lib/logen-excel.test.ts`

**입력 계약:** `parseLogenSheet(rows: string[][]): LogenRow[]`. `rows` 는 시트의 행×열 문자열 2차원 배열. SheetJS 변환(`sheet_to_json({header:1, raw:false, defval:""})`)은 호출부(컴포넌트) 책임 — 이 함수는 순수. ⚠ SheetJS는 행 끝 이후 셀을 채우지 않아 배열이 들쭉날쭉(ragged)할 수 있으므로, 파서의 `get()`은 `String(row[ci] ?? "")`로 방어한다(모든 행이 직사각형이라 가정하지 않음).

**헤더 탐지:** 상위 행들(밴드)에서 라벨이 처음 등장하는 셀의 **열 인덱스**를 잡는다. 찾을 라벨:
`운송장번호`(tracking), `수하인`(name — '수하인'/'수하인명' 부분일치), `휴대폰`(phone), `주문번호`(orderNo).
`운송장번호` 열을 못 찾으면 빈 배열. 데이터 행 = 헤더 라벨이 있던 마지막 행의 다음 행부터, `운송장번호` 셀이 비지 않은 행만.

- [ ] **Step 1: 실패 테스트 작성** — `lib/logen-excel.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { parseLogenSheet } from "./logen-excel";

// 실측 구조 축약: 제목행, 2줄 병합헤더(휴대폰 라벨이 둘째 헤더행), 데이터, 합계행.
function sample(): string[][] {
  const r: string[][] = [];
  r[0] = ["주문실적조회"];                                   // row1 제목
  r[1] = [];                                                 // row2
  // row3(idx2): 첫째 헤더행 (No., 주문번호 col8, 운송장번호 col9, 수하인 col13 …)
  const h1: string[] = [];
  h1[0] = "No."; h1[7] = "주문번호"; h1[8] = "운송장번호"; h1[12] = "수하인"; h1[16] = "휴대폰";
  r[2] = h1;
  // row4(idx3): 둘째 헤더행(병합 라벨) — 비워 둠(열 인덱스는 첫째 행에서 확정)
  r[3] = [];
  // 데이터행들 (idx4~)
  const d = (no: string, order: string, track: string, name: string, phone: string) => {
    const a: string[] = [];
    a[0] = no; a[7] = order; a[8] = track; a[12] = name; a[16] = phone;
    return a;
  };
  r[4] = d("1", "", "445-3834-1186", "김태연", "010-7663-****");
  r[5] = d("2", "", "445-3834-1190", "윤화영", "010-6408-****");
  r[6] = d("", "", "", "", "");                              // 합계행(운송장 빈칸) → 스킵
  return r;
}

describe("parseLogenSheet", () => {
  it("데이터행만 파싱, 송장 숫자화, 휴대폰7 추출", () => {
    const out = parseLogenSheet(sample());
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ tracking: "44538341186", recipientName: "김태연", phone7: "0107663", orderNo: "" });
    expect(out[1].tracking).toBe("44538341190");
    expect(out[1].phone7).toBe("0106408");
  });
  it("운송장번호 헤더 없으면 빈 배열", () => {
    expect(parseLogenSheet([["엉뚱"], ["a", "b"]])).toEqual([]);
  });
  it("col8 주문번호가 있으면 보존", () => {
    const rows = sample();
    rows[4][7] = "SY-20260608-001";
    expect(parseLogenSheet(rows)[0].orderNo).toBe("SY-20260608-001");
  });

  it("휴대폰 라벨이 둘째 헤더행(병합)에 있어도 열 인덱스로 탐지·데이터행 정확", () => {
    const r: string[][] = [];
    r[0] = ["주문실적조회"]; r[1] = [];
    const h1: string[] = []; h1[8] = "운송장번호"; h1[12] = "수하인"; r[2] = h1; // 첫 헤더행
    const h2: string[] = []; h2[16] = "휴대폰"; r[3] = h2;                        // 둘째 헤더행(병합 라벨)
    const d: string[] = []; d[8] = "445-3834-1186"; d[12] = "김태연"; d[16] = "010-7663-****"; r[4] = d;
    const out = parseLogenSheet(r);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ tracking: "44538341186", recipientName: "김태연", phone7: "0107663", orderNo: "" });
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run lib/logen-excel.test.ts` → FAIL

- [ ] **Step 3: 구현** — `lib/logen-excel.ts`

```ts
// 로젠 '주문실적조회.xlsx' 시트(행×열 문자열 배열) → 송장 매칭용 행 추출(순수).
//   헤더는 2줄 병합 구조라 라벨이 어느 헤더행에 있든 '열 인덱스'만 확정하면 된다.
import { phone7 } from "./phone";

export type LogenRow = {
  tracking: string; // 운송장번호 숫자만(하이픈 제거)
  recipientName: string; // 수하인명(원문)
  phone7: string; // 휴대폰 앞7자리(정규화), 무효면 ""
  orderNo: string; // 주문번호(보통 "")
};

const HEADER_BAND = 6; // 상위 6행 안에서 헤더 라벨 탐색

type ColMap = { tracking: number; name: number; phone: number; order: number; headerRow: number };

function findColumns(rows: string[][]): ColMap | null {
  const want = (cell: string, label: string) => cell.replace(/\s/g, "").includes(label);
  let map: Partial<ColMap> = {};
  let headerRow = -1;
  for (let ri = 0; ri < Math.min(HEADER_BAND, rows.length); ri++) {
    const row = rows[ri] ?? [];
    for (let ci = 0; ci < row.length; ci++) {
      const c = String(row[ci] ?? "");
      if (map.tracking == null && want(c, "운송장번호")) { map.tracking = ci; headerRow = Math.max(headerRow, ri); }
      else if (map.name == null && want(c, "수하인")) { map.name = ci; headerRow = Math.max(headerRow, ri); }
      else if (map.phone == null && want(c, "휴대폰")) { map.phone = ci; headerRow = Math.max(headerRow, ri); }
      else if (map.order == null && want(c, "주문번호")) { map.order = ci; headerRow = Math.max(headerRow, ri); }
    }
  }
  if (map.tracking == null) return null;
  return {
    tracking: map.tracking,
    name: map.name ?? -1,
    phone: map.phone ?? -1,
    order: map.order ?? -1,
    headerRow,
  };
}

export function parseLogenSheet(rows: string[][]): LogenRow[] {
  const col = findColumns(rows);
  if (!col) return [];
  const out: LogenRow[] = [];
  for (let ri = col.headerRow + 1; ri < rows.length; ri++) {
    const row = rows[ri] ?? [];
    const get = (ci: number) => (ci >= 0 ? String(row[ci] ?? "").trim() : "");
    const tracking = get(col.tracking).replace(/\D/g, "");
    if (!tracking) continue; // 합계행·빈행 스킵
    out.push({
      tracking,
      recipientName: get(col.name),
      phone7: phone7(get(col.phone)),
      orderNo: get(col.order),
    });
  }
  return out;
}
```

- [ ] **Step 4: 통과 확인** — `npx vitest run lib/logen-excel.test.ts` → PASS

- [ ] **Step 5: Commit**

```bash
git add lib/logen-excel.ts lib/logen-excel.test.ts
git commit -m "feat: 로젠 주문실적조회 엑셀 파서(헤더탐지·송장숫자화·휴대폰7)"
```

---

### Task 3: 매칭 로직 (`lib/logen-match.ts`)

**Files:**
- Create: `lib/logen-match.ts`
- Test: `lib/logen-match.test.ts`

**계약:** `matchLogen(rows: LogenRow[], orders: CandidateOrder[]): LogenMatchResult`.

```ts
export type CandidateOrder = { id: string; order_no: string; ship_name: string; ship_phone: string; tracking_no: string | null };
```

**규칙(spec §4):**
1. 행별 후보: orderNo 비어있지 않고 `order_no` 정확일치 → 그 주문(정확). 아니면 `phone7` 일치 주문들.
2. 휴대폰7 무효(`""`) → 후보 없음(이름만으로 매칭 안 함).
3. 한 행에 후보 2+ → ambiguous(candidateOrderIds).
4. 두 행이 같은 주문 점유 → 그 주문을 다툰 행 모두 ambiguous.
5. 단일 후보 확정 후: 주문에 `tracking_no` 존재 → alreadyFilled. 아니면 matched.
6. confidence: 이름(정규화 정확일치) → `high`, 불일치 → `review`. (정확매칭 orderNo 경로도 이름규칙 동일 적용)
- 이름 정규화: 공백제거 + 괄호 `(...)` 제거 + 직함 접미 화이트리스트 제거.

- [ ] **Step 1: 실패 테스트 작성** — `lib/logen-match.test.ts`

```ts
import { describe, it, expect } from "vitest";
import { matchLogen, normalizeName } from "./logen-match";
import type { LogenRow } from "./logen-excel";

const row = (p: Partial<LogenRow>): LogenRow =>
  ({ tracking: "T1", recipientName: "", phone7: "", orderNo: "", ...p });
const ord = (id: string, name: string, phone: string, tracking: string | null = null) =>
  ({ id, order_no: id, ship_name: name, ship_phone: phone, tracking_no: tracking });

describe("normalizeName", () => {
  it("직함·괄호·공백 제거", () => {
    expect(normalizeName("이일석대표")).toBe("이일석");
    expect(normalizeName("박미영(문성권)")).toBe("박미영");
    expect(normalizeName(" 김 태연 ")).toBe("김태연");
  });
});

describe("matchLogen", () => {
  const orders = [
    ord("A", "김태연", "010-7663-1234"),
    ord("B", "윤화영", "010-6408-9999"),
  ];

  it("휴대폰7+이름 일치 → high matched", () => {
    const r = matchLogen([row({ tracking: "44538341186", recipientName: "김태연", phone7: "0107663" })], orders);
    expect(r.matched).toEqual([{ rowIdx: 0, orderId: "A", tracking: "44538341186", confidence: "high" }]);
    expect(r.unmatched).toHaveLength(0);
  });

  it("휴대폰7 일치·이름 불일치 → review", () => {
    const r = matchLogen([row({ tracking: "T", recipientName: "다른이름", phone7: "0107663" })], orders);
    expect(r.matched[0].confidence).toBe("review");
  });

  it("+82 폰도 정규화로 매칭(주문 폰이 +82형)", () => {
    const o = [ord("A", "김태연", "+82 10-7663-1234")];
    const r = matchLogen([row({ recipientName: "김태연", phone7: "0107663" })], o);
    expect(r.matched[0].orderId).toBe("A");
  });

  it("휴대폰7 무효 → unmatched", () => {
    const r = matchLogen([row({ recipientName: "김태연", phone7: "" })], orders);
    expect(r.unmatched).toHaveLength(1);
    expect(r.matched).toHaveLength(0);
  });

  it("한 행이 2주문과 휴대폰7 일치 → ambiguous", () => {
    const o = [ord("A", "김태연", "010-7663-1111"), ord("C", "다른", "010-7663-2222")];
    const r = matchLogen([row({ recipientName: "김태연", phone7: "0107663" })], o);
    expect(r.ambiguous[0].candidateOrderIds.sort()).toEqual(["A", "C"]);
    expect(r.matched).toHaveLength(0);
  });

  it("두 행이 한 주문 점유 → 둘 다 ambiguous", () => {
    const rows = [
      row({ tracking: "T1", recipientName: "김태연", phone7: "0107663" }),
      row({ tracking: "T2", recipientName: "김태연", phone7: "0107663" }),
    ];
    const r = matchLogen(rows, [ord("A", "김태연", "010-7663-1234")]);
    expect(r.ambiguous).toHaveLength(2);
    expect(r.matched).toHaveLength(0);
  });

  it("주문에 송장 이미 있으면 alreadyFilled", () => {
    const o = [ord("A", "김태연", "010-7663-1234", "99999999999")];
    const r = matchLogen([row({ tracking: "T", recipientName: "김태연", phone7: "0107663" })], o);
    expect(r.alreadyFilled[0].orderId).toBe("A");
    expect(r.matched).toHaveLength(0);
  });

  it("col8 주문번호 정확매칭 우선", () => {
    const r = matchLogen([row({ tracking: "T", orderNo: "B", recipientName: "윤화영", phone7: "" })], orders);
    expect(r.matched[0].orderId).toBe("B");
  });

  it("order_no 중복이면 정확매칭도 ambiguous", () => {
    const o = [ord("A", "김태연", "010-1111-1111"), { id: "A2", order_no: "A", ship_name: "딴사람", ship_phone: "010-2222-2222", tracking_no: null }];
    const r = matchLogen([row({ tracking: "T", orderNo: "A", phone7: "" })], o);
    expect(r.ambiguous[0].candidateOrderIds.sort()).toEqual(["A", "A2"]);
    expect(r.matched).toHaveLength(0);
  });
});
```

- [ ] **Step 2: 실패 확인** — `npx vitest run lib/logen-match.test.ts` → FAIL

- [ ] **Step 3: 구현** — `lib/logen-match.ts`

```ts
// 로젠 행 × 우리 배송큐 주문 매칭(순수). 휴대폰 앞7자리(필수) + 이름(정규화) 으로 확신도를 가른다.
//   안전: high(이름정확) 외엔 자동삽입 금지. 행↔주문 다대일/일대다 충돌은 ambiguous 로 격리.
import type { LogenRow } from "./logen-excel";
import { phone7 } from "./phone";

export type CandidateOrder = {
  id: string;
  order_no: string;
  ship_name: string;
  ship_phone: string;
  tracking_no: string | null;
};

export type Matched = { rowIdx: number; orderId: string; tracking: string; confidence: "high" | "review" };
export type AlreadyFilled = { rowIdx: number; orderId: string; tracking: string };
export type Ambiguous = { rowIdx: number; tracking: string; candidateOrderIds: string[] };
export type Unmatched = { rowIdx: number; tracking: string; recipientName: string; phone7: string };

export type LogenMatchResult = {
  matched: Matched[];
  alreadyFilled: AlreadyFilled[];
  ambiguous: Ambiguous[];
  unmatched: Unmatched[];
};

const TITLE_SUFFIXES = ["대표", "사장", "원장", "점장", "님", "씨", "귀하"];

export function normalizeName(raw: string): string {
  let s = (raw ?? "").replace(/\(.*?\)/g, "").replace(/\s/g, "");
  for (const t of TITLE_SUFFIXES) {
    if (s.length > t.length && s.endsWith(t)) { s = s.slice(0, -t.length); break; }
  }
  return s;
}

export function matchLogen(rows: LogenRow[], orders: CandidateOrder[]): LogenMatchResult {
  const byOrderNo = new Map<string, CandidateOrder[]>();
  const byPhone7 = new Map<string, CandidateOrder[]>();
  for (const o of orders) {
    byOrderNo.set(o.order_no, [...(byOrderNo.get(o.order_no) ?? []), o]);
    const p = phone7(o.ship_phone);
    if (p) byPhone7.set(p, [...(byPhone7.get(p) ?? []), o]);
  }

  // 1차: 행별 후보 산출. 정확매칭이라도 order_no 중복이면 후보 다건 → ambiguous 로 흐른다.
  type Cand = { rowIdx: number; row: LogenRow; orders: CandidateOrder[] };
  const cands: Cand[] = rows.map((row, rowIdx) => {
    const exact = row.orderNo ? byOrderNo.get(row.orderNo) : undefined;
    if (exact && exact.length > 0) return { rowIdx, row, orders: exact };
    const list = row.phone7 ? byPhone7.get(row.phone7) ?? [] : [];
    return { rowIdx, row, orders: list };
  });

  const result: LogenMatchResult = { matched: [], alreadyFilled: [], ambiguous: [], unmatched: [] };

  // 2차: 단일후보 행이 같은 주문을 다투면(일대다) 그 주문 점유 행 전부 ambiguous.
  const singleClaims = new Map<string, number[]>(); // orderId → rowIdx[]
  for (const c of cands) {
    if (c.orders.length === 1) {
      const id = c.orders[0].id;
      singleClaims.set(id, [...(singleClaims.get(id) ?? []), c.rowIdx]);
    }
  }
  const contested = new Set<number>();
  for (const [, idxs] of singleClaims) {
    if (idxs.length > 1) idxs.forEach((i) => contested.add(i));
  }

  // 3차: 분류.
  for (const c of cands) {
    const { rowIdx, row } = c;
    if (c.orders.length === 0) {
      result.unmatched.push({ rowIdx, tracking: row.tracking, recipientName: row.recipientName, phone7: row.phone7 });
      continue;
    }
    if (c.orders.length > 1 || contested.has(rowIdx)) {
      result.ambiguous.push({ rowIdx, tracking: row.tracking, candidateOrderIds: c.orders.map((o) => o.id) });
      continue;
    }
    const o = c.orders[0];
    if (o.tracking_no && o.tracking_no.trim()) {
      result.alreadyFilled.push({ rowIdx, orderId: o.id, tracking: row.tracking });
      continue;
    }
    const confidence = normalizeName(row.recipientName) === normalizeName(o.ship_name) ? "high" : "review";
    result.matched.push({ rowIdx, orderId: o.id, tracking: row.tracking, confidence });
  }
  return result;
}
```

- [ ] **Step 4: 통과 확인** — `npx vitest run lib/logen-match.test.ts` → PASS

- [ ] **Step 5: 전체 회귀** — `npx vitest run lib/ && npx tsc --noEmit` → PASS / 0 errors

- [ ] **Step 6: Commit**

```bash
git add lib/logen-match.ts lib/logen-match.test.ts
git commit -m "feat: 로젠 행 매칭(휴대폰7+이름, ambiguous/alreadyFilled 격리)"
```

---

## Chunk 2: 컴포넌트 통합 (`DispatchPanel`)

### Task 4: SheetJS 의존성 추가

**Files:** Modify `package.json`

- [ ] **Step 1: 설치** — `npm install xlsx`
- [ ] **Step 2: 확인** — `package.json` dependencies 에 `xlsx` 존재, `npx tsc --noEmit` PASS
- [ ] **Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: 로젠 엑셀 파싱용 xlsx(SheetJS) 의존성 추가"
```

### Task 5: 업로드 + 미리보기 UI

**Files:** Modify `components/DispatchPanel.tsx` (기존 `applyTrackingPaste`/`tracking` state/붙여넣기 박스 패턴 재사용 — 참조: `components/DispatchPanel.tsx:156-161,344-376,757-790`)

> 컴포넌트엔 로직을 두지 않는다. 파싱·매칭은 lib 호출, state 갱신만 불변(스프레드). 단위테스트는 lib 가 커버하므로 컴포넌트 테스트는 생략하고 타입체크+수동검증으로 확인.

- [ ] **Step 1: state·핸들러 추가** (붙여넣기 state 옆)

```ts
import * as logenExcel from "@/lib/logen-excel";
import { matchLogen, type LogenMatchResult } from "@/lib/logen-match";

const [logenPreview, setLogenPreview] = useState<LogenMatchResult | null>(null);
const [logenChecked, setLogenChecked] = useState<Record<number, string>>({}); // rowIdx → 선택 orderId
const [logenNote, setLogenNote] = useState<string | null>(null);
```

- [ ] **Step 2: 파일 핸들러** — 동적 import 로 SheetJS 로드 → 2차원 배열 → 파싱·매칭

```ts
async function onLogenFile(file: File) {
  setLogenNote(null);
  const XLSX = await import("xlsx");
  const buf = await file.arrayBuffer();
  const wb = XLSX.read(buf, { type: "array" });
  const ws = wb.Sheets[wb.SheetNames[0]];
  const rows = XLSX.utils.sheet_to_json<string[]>(ws, { header: 1, raw: false, defval: "" });
  const parsed = logenExcel.parseLogenSheet(rows as string[][]);
  if (parsed.length === 0) { setLogenNote("로젠 엑셀에서 인식된 행이 없습니다(헤더/시트 확인)."); setLogenPreview(null); return; }
  const res = matchLogen(parsed, allRows.map((r) => r.o));
  setLogenPreview(res);
  // high 자동 체크.
  const init: Record<number, string> = {};
  for (const m of res.matched) if (m.confidence === "high") init[m.rowIdx] = m.orderId;
  setLogenChecked(init);
  setLogenNote(`매칭 ${res.matched.length} · 검토 ${res.matched.filter((m)=>m.confidence==="review").length} · 모호 ${res.ambiguous.length} · 이미채움 ${res.alreadyFilled.length} · 미일치 ${res.unmatched.length}`);
}
```

- [ ] **Step 3: 적용 핸들러** — 선택분만 `tracking[]`·`selected` 불변 갱신 + courier 가드

```ts
function applyLogen() {
  const picks = Object.entries(logenChecked).filter(([, id]) => id); // [rowIdxStr, orderId]
  if (picks.length === 0) return;
  // 충돌 가드: 한 주문을 2건 이상이 점유하면 송장 덮어쓰기 → 전체 중단(오발송 방지, spec §4-3b).
  const perOrder = new Map<string, number>();
  for (const [, id] of picks) perOrder.set(id, (perOrder.get(id) ?? 0) + 1);
  const dup = [...perOrder].filter(([, n]) => n > 1).map(([id]) => id);
  if (dup.length > 0) {
    setLogenNote(`같은 주문에 송장이 2건 이상 선택됨(${dup.join(", ")}). 행을 1건씩만 선택하세요.`);
    return;
  }
  if (courier !== "logen") setCourier("logen"); // 택배사 가드
  const trackByRow = new Map((logenPreview?.matched ?? []).map((m) => [m.rowIdx, m.tracking]));
  const ambByRow = new Map((logenPreview?.ambiguous ?? []).map((a) => [a.rowIdx, a.tracking]));
  setTracking((prev) => {
    const next = { ...prev };
    for (const [idxStr, id] of picks) {
      const t = trackByRow.get(Number(idxStr)) ?? ambByRow.get(Number(idxStr));
      if (t) next[id] = t;
    }
    return next;
  });
  setSelected((prev) => {
    const next = new Set(prev);
    for (const [, id] of picks) next.add(id);
    return next;
  });
  setLogenNote(`${picks.length}건 채움·선택됨. 상단에서 '선택 발송' 진행.`);
}
```

- [ ] **Step 4: 미리보기 렌더** — 붙여넣기 박스 아래에 접이식 업로드 영역. 파일 input + 결과 테이블:
  - matched: 로젠(수하인·휴대폰·송장) → 우리주문(order_no·ship_name) + 배지(high/review) + 체크박스(`logenChecked[rowIdx]` 토글).
  - ambiguous: 후보 `<select>` 로 orderId 선택. **기본값 "선택 안 함"**(빈값 → `logenChecked[rowIdx]` 미설정/삭제). 역경합(후보가 같은 주문 1개뿐)도 운영자가 행 하나만 고르도록 강제됨 + `applyLogen` 충돌 가드가 2차 방어.
  - alreadyFilled: "이미 송장 있음" 회색 표시(체크 불가).
  - unmatched: 회색 + "필터로 가려졌을 수 있음" 주석.
  - "선택분 송장 채우기" 버튼 → `applyLogen`. `logenNote` 표시.
  - 파일 input: `<input type="file" accept=".xlsx,.xls" onChange={e => { const f = e.target.files?.[0]; if (f) onLogenFile(f); }} />`

- [ ] **Step 5: 타입체크** — `npx tsc --noEmit` → 0 errors

- [ ] **Step 6: 빌드 확인** — `npm run build` (또는 프로젝트 빌드 명령) → 성공

- [ ] **Step 7: 수동 검증** — 로젠 샘플(`~/Downloads/주문실적조회 (2026-06-08).xlsx`) 업로드 시 미리보기·매칭·courier=logen 동작 확인(개발 서버).

- [ ] **Step 8: Commit**

```bash
git add components/DispatchPanel.tsx
git commit -m "feat: 배송 패널에 로젠 엑셀 업로드·매칭 미리보기·일괄 송장기재"
```

---

## 완료 기준 (Evidence-Based)

- [ ] `npx vitest run lib/` 전체 PASS (신규 phone/logen-excel/logen-match 포함)
- [ ] `npx tsc --noEmit` 0 errors
- [ ] `npm run build` 성공
- [ ] 실측 파일 업로드 수동검증: 21건 매칭 미리보기·courier 자동전환 확인
- [ ] PR: spec/plan 링크 + 테스트 결과 첨부

## 미적용/후속

- SQL 마이그레이션 **없음**(발송 로직·DB 불변).
- 로젠 접수 시 SY주문번호를 col8에 넣는 운영 프로세스가 도입되면 정확매칭이 자동 활성(코드 변경 불필요).

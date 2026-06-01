# 가입 이탈 복구 (미입금 리마인드 + 자동취소) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 가입 후 무통장입금을 완료하지 않은 회원에게 D+1·D+2 리마인드를 보내고 D+3에 주문을 자동취소·슬롯반환한다.

**Architecture:** Netlify Scheduled Function이 매일 1회 트리거되어, **시크릿-게이트 SECURITY DEFINER RPC 2개**(읽기 `payment_recovery_targets` / 쓰기 `apply_recovery_action`)로 데이터·권한 작업을 수행한다. 단계 판정·메시지 조립은 `lib/payment-recovery.ts` 순수 함수로 분리해 vitest로 단위테스트한다. `service_role` 키는 쓰지 않는다(anon 키 + Vault 보관 시크릿).

**Tech Stack:** TypeScript, Next.js 16(수정판), Supabase(Postgres RPC, Vault), Netlify Functions, Solapi(알림톡/LMS), vitest.

**Spec:** `docs/superpowers/specs/2026-06-02-signup-recovery-design.md`

## 표준 제약 (이 레포 — 반드시 준수)
- **공개 repo(hhj3150/shop):** 시크릿·계좌·신분증 등 절대 커밋 금지. `service_role` 사용 금지(anon + Vault 시크릿게이트 RPC).
- 스테이징은 **명시 파일만** (`git add <경로>`). `git add -A`/`.` 금지. untracked jpg 2개 제외.
- immutability(스프레드, 무mutation), 하드코딩 금지 — 금액은 RPC 반환값, 계좌는 `lib/site.ts DEPOSIT`에서 파생.
- 정답성 게이트는 `npx tsc --noEmit`(exit 0). 로컬 `build`는 한글 경로로 깨짐. 테스트는 `npx vitest run`.
- 커밋만, push는 사람이 지시할 때. committer 자동설정 경고는 양성 — 무시.

## File Structure

| 파일 | 신규/수정 | 책임 |
|------|-----------|------|
| `lib/payment-recovery.ts` | 신규 | 순수 함수: KST 경과일 → 단계 판정(`decideAction`), 단계별 메시지 조립(`buildRecoveryMessage`). I/O 없음. |
| `lib/payment-recovery.test.ts` | 신규 | vitest 단위테스트. |
| `supabase/migration-payment-recovery.sql` | 신규 | `order_reminders` 테이블 + RPC 2개. SQL Editor 수동 적용. |
| `netlify/functions/payment-recovery.mts` | 신규 | 스케줄 함수: anon 클라이언트로 RPC 호출 → 순수함수 판정 → `sendInfo` 발송. |
| `.env.example` | 수정 | `PAYMENT_RECOVERY_SECRET` 자리표시자 추가. |
| `package.json` | 수정 | `@netlify/functions` devDependency 추가(스케줄 함수 `Config` 타입). |
| `tsconfig.json` | 확인/수정 | `netlify/functions/**` 가 `tsc --noEmit` 범위에 들도록 include 확인. |

> `lib/payment-recovery.ts`는 Netlify 번들러(esbuild)가 `@` alias를 해석 못 할 수 있으므로 **상대경로 import**(`./site`, `./deposit-guidance`)를 쓴다. vitest도 상대경로를 정상 해석한다.

---

## Chunk 1: 순수 로직 (lib)

### Task 1: `decideAction` — KST 경과일로 단계 판정

**Files:**
- Create: `lib/payment-recovery.ts`
- Test: `lib/payment-recovery.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/payment-recovery.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { decideAction, type RecoveryTarget } from "./payment-recovery";

const base: RecoveryTarget = {
  orderId: "o1",
  createdAt: "2026-06-01T01:00:00.000Z", // 2026-06-01 10:00 KST
  shipName: "홍길동",
  shipPhone: "01012345678",
  orderNo: "20260601-0001",
  totalAmount: 39000,
  hasSubscription: true,
  sentStages: [],
};

describe("decideAction (KST 달력일 경과)", () => {
  it("D+0 당일은 none", () => {
    const now = new Date("2026-06-01T05:00:00.000Z"); // 같은 날 14:00 KST
    expect(decideAction(base, now)).toBe("none");
  });
  it("D+1은 D1", () => {
    const now = new Date("2026-06-02T00:30:00.000Z"); // 06-02 09:30 KST
    expect(decideAction(base, now)).toBe("D1");
  });
  it("D+1인데 이미 D1 보냈으면 none", () => {
    const now = new Date("2026-06-02T00:30:00.000Z");
    expect(decideAction({ ...base, sentStages: ["D1"] }, now)).toBe("none");
  });
  it("D+2는 D2", () => {
    const now = new Date("2026-06-03T00:30:00.000Z"); // 06-03 09:30 KST
    expect(decideAction(base, now)).toBe("D2");
  });
  it("D+2인데 이미 D2 보냈으면 none", () => {
    const now = new Date("2026-06-03T00:30:00.000Z");
    expect(decideAction({ ...base, sentStages: ["D2"] }, now)).toBe("none");
  });
  it("D+3 이상은 EXPIRE", () => {
    const now = new Date("2026-06-04T00:30:00.000Z"); // 06-04 09:30 KST
    expect(decideAction(base, now)).toBe("EXPIRE");
  });
  it("KST 자정 직후 경계: UTC로는 전날이어도 KST 달력일로 계산", () => {
    // created 06-01 10:00 KST. now = 06-02 00:10 KST (= 06-01T15:10Z)
    const now = new Date("2026-06-01T15:10:00.000Z");
    expect(decideAction(base, now)).toBe("D1");
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run lib/payment-recovery.test.ts`
Expected: FAIL — `decideAction`/`RecoveryTarget`가 없음.

- [ ] **Step 3: 최소 구현**

`lib/payment-recovery.ts`:
```ts
// 가입 이탈 복구 — 미입금 리마인드/자동취소 판정·메시지 조립 (순수 함수, I/O 없음).
// import는 Netlify 번들러(esbuild) 호환을 위해 상대경로만 사용.
import { DEPOSIT } from "./site";
import { depositAmountDigits } from "./deposit-guidance";

const SHOP = "송영신목장";

export type RecoveryTarget = {
  orderId: string;
  createdAt: string; // DB timestamptz ISO 문자열
  shipName: string;
  shipPhone: string;
  orderNo: string;
  totalAmount: number;
  hasSubscription: boolean;
  sentStages: string[]; // 이미 발송한 단계 (예: ["D1"])
};

export type RecoveryAction = "D1" | "D2" | "EXPIRE" | "none";

// 한 시각을 KST 달력일(UTC epoch로 정규화)로 변환. KST는 DST 없는 UTC+9.
function kstDayEpoch(d: Date): number {
  const k = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate());
}

export function kstDaysElapsed(createdAtIso: string, now: Date): number {
  const created = kstDayEpoch(new Date(createdAtIso));
  const today = kstDayEpoch(now);
  return Math.round((today - created) / 86_400_000);
}

export function decideAction(t: RecoveryTarget, now: Date): RecoveryAction {
  const days = kstDaysElapsed(t.createdAt, now);
  if (days >= 3) return "EXPIRE";
  if (days === 2) return t.sentStages.includes("D2") ? "none" : "D2";
  if (days === 1) return t.sentStages.includes("D1") ? "none" : "D1";
  return "none";
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run lib/payment-recovery.test.ts`
Expected: PASS (decideAction 7케이스).

- [ ] **Step 5: 커밋**

```bash
git add lib/payment-recovery.ts lib/payment-recovery.test.ts
git commit -m "feat: add decideAction for unpaid-order recovery staging"
```

---

### Task 2: `buildRecoveryMessage` — 단계별 메시지 조립

**Files:**
- Modify: `lib/payment-recovery.ts`
- Test: `lib/payment-recovery.test.ts`

- [ ] **Step 1: 실패하는 테스트 추가**

`lib/payment-recovery.test.ts` 하단에 추가:
```ts
import { buildRecoveryMessage } from "./payment-recovery";
import { DEPOSIT } from "./site";

describe("buildRecoveryMessage", () => {
  const account = `${DEPOSIT.bank} ${DEPOSIT.account} (예금주 ${DEPOSIT.holder})`;

  it("D1은 PAYMENT_GUIDE 템플릿 + 정확한 변수", () => {
    const m = buildRecoveryMessage(base, "D1");
    expect(m.templateKey).toBe("PAYMENT_GUIDE");
    expect(m.variables).toEqual({
      "#{고객명}": "홍길동",
      "#{주문번호}": "20260601-0001",
      "#{금액}": "39000",
      "#{입금계좌}": account,
    });
    expect(m.text).toContain("39000");
    expect(m.text).toContain(account);
  });

  it("D2는 PAYMENT_DEADLINE 템플릿 + 마감일(D+3, KST)", () => {
    const m = buildRecoveryMessage(base, "D2");
    expect(m.templateKey).toBe("PAYMENT_DEADLINE");
    expect(m.variables).toEqual({
      "#{고객명}": "홍길동",
      "#{주문번호}": "20260601-0001",
      "#{금액}": "39000",
      "#{마감일}": "6월 4일", // 06-01 + 3일 (KST)
    });
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run lib/payment-recovery.test.ts`
Expected: FAIL — `buildRecoveryMessage` 없음.

- [ ] **Step 3: 최소 구현 (`lib/payment-recovery.ts`에 추가)**

```ts
export type RecoveryMessage = {
  templateKey: "PAYMENT_GUIDE" | "PAYMENT_DEADLINE";
  variables: Record<string, string>;
  subject: string;
  text: string; // 알림톡 실패 시 LMS 폴백 본문
};

function accountLine(): string {
  return `${DEPOSIT.bank} ${DEPOSIT.account} (예금주 ${DEPOSIT.holder})`;
}

// created + 3일을 "M월 D일"(KST)로 포맷.
function deadlineLabel(createdAtIso: string): string {
  const k = new Date(
    new Date(createdAtIso).getTime() + 9 * 60 * 60 * 1000 + 3 * 86_400_000,
  );
  return `${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일`;
}

export function buildRecoveryMessage(
  t: RecoveryTarget,
  action: "D1" | "D2",
): RecoveryMessage {
  const amount = depositAmountDigits(t.totalAmount);
  const account = accountLine();
  if (action === "D1") {
    return {
      templateKey: "PAYMENT_GUIDE",
      variables: {
        "#{고객명}": t.shipName,
        "#{주문번호}": t.orderNo,
        "#{금액}": amount,
        "#{입금계좌}": account,
      },
      subject: `[${SHOP}] 입금 안내 다시 드립니다`,
      text:
        `[${SHOP}] ${t.shipName}님, 주문(${t.orderNo}) 입금을 다시 안내드립니다.\n` +
        `입금하실 금액 ${amount}원\n${account}\n` +
        `입금이 확인되면 바로 준비해 드리겠습니다.`,
    };
  }
  const deadline = deadlineLabel(t.createdAt);
  return {
    templateKey: "PAYMENT_DEADLINE",
    variables: {
      "#{고객명}": t.shipName,
      "#{주문번호}": t.orderNo,
      "#{금액}": amount,
      "#{마감일}": deadline,
    },
    subject: `[${SHOP}] 입금 마감 임박 안내`,
    text:
      `[${SHOP}] ${t.shipName}님, 주문(${t.orderNo}) 입금이 아직 확인되지 않았습니다.\n` +
      `${deadline}까지 입금이 없으면 자동 취소되어 자리가 반환됩니다.\n` +
      `입금하실 금액 ${amount}원\n${account}`,
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run lib/payment-recovery.test.ts`
Expected: PASS (전 케이스). 변수명이 `lib/notify-templates.ts:38-40`의 `TEMPLATE_VARS`와 정확히 일치해야 한다.

- [ ] **Step 5: 전체 테스트 + tsc 게이트**

Run: `npx vitest run && npx tsc --noEmit`
Expected: 전체 PASS, tsc exit 0.

- [ ] **Step 6: 커밋**

```bash
git add lib/payment-recovery.ts lib/payment-recovery.test.ts
git commit -m "feat: build stage-specific recovery messages (reuse existing templates)"
```

---

## Chunk 2: DB 마이그레이션 (RPC)

### Task 3: `order_reminders` 원장 + 시크릿게이트 RPC 2개

**Files:**
- Create: `supabase/migration-payment-recovery.sql`

> 이 파일은 vitest 대상이 아니다. 정확성은 `tsc`(영향 없음)와 **Supabase SQL Editor 수동 적용 + RPC 직접 호출**로 검증한다(Task 6). 기존 `migration-portone-payment.sql`의 `confirm_payment`(Vault 시크릿게이트)와 `migration-cancel-unpaid-order.sql`의 슬롯반환 패턴을 그대로 따른다.

- [ ] **Step 1: 마이그레이션 파일 작성**

`supabase/migration-payment-recovery.sql`:
```sql
-- 가입 이탈 복구: 미입금 리마인드 원장 + 시크릿게이트 RPC.
--
-- 적용: Supabase SQL Editor에 붙여넣고 실행.
-- 사전(시크릿 등록, 1회):
--   select vault.create_secret('<무작위-긴-문자열>', 'payment_recovery_secret');
--   → Netlify 환경변수 PAYMENT_RECOVERY_SECRET 에 동일 값 주입(공개 repo 커밋 금지).
-- 시크릿 교체 시:
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'payment_recovery_secret'),
--     '<새-무작위-긴-문자열>');
--   → Netlify env도 같은 값으로 교체.

-- 단계별 중복발송 방지 원장.
create table if not exists public.order_reminders (
  order_id uuid not null references public.orders(id) on delete cascade,
  stage    text not null check (stage in ('D1','D2')),
  sent_at  timestamptz not null default now(),
  primary key (order_id, stage)
);

alter table public.order_reminders enable row level security;
-- 클라이언트 직접 접근 없음. RPC(SECURITY DEFINER)로만 읽고 쓴다 → 정책 미부여(전면 차단).

-- 읽기: '입금대기' 주문 + 이미 보낸 단계. 시크릿게이트.
create or replace function public.payment_recovery_targets(p_secret text)
returns table (
  order_id         uuid,
  created_at       timestamptz,
  ship_name        text,
  ship_phone       text,
  order_no         text,
  total_amount     integer,
  has_subscription boolean,
  sent_stages      text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected text;
begin
  select decrypted_secret into v_expected
    from vault.decrypted_secrets
   where name = 'payment_recovery_secret';
  if v_expected is null or coalesce(p_secret, '') = '' or p_secret <> v_expected then
    raise exception 'forbidden';
  end if;

  return query
    select o.id, o.created_at, o.ship_name, o.ship_phone,
           o.order_no, o.total_amount, o.has_subscription,
           coalesce(
             array_agg(r.stage) filter (where r.stage is not null),
             '{}'::text[]
           ) as sent_stages
      from public.orders o
      left join public.order_reminders r on r.order_id = o.id
     where o.status = '입금대기'
     group by o.id;
end;
$$;

-- 쓰기: 단계 기록('D1'/'D2') 또는 마감 자동취소('expire'). 시크릿게이트.
create or replace function public.apply_recovery_action(
  p_secret   text,
  p_order_id uuid,
  p_action   text
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected text;
  v_status   text;
  v_today    date := (now() at time zone 'Asia/Seoul')::date;
begin
  select decrypted_secret into v_expected
    from vault.decrypted_secrets
   where name = 'payment_recovery_secret';
  if v_expected is null or coalesce(p_secret, '') = '' or p_secret <> v_expected then
    raise exception 'forbidden';
  end if;

  if p_action in ('D1', 'D2') then
    insert into public.order_reminders(order_id, stage)
      values (p_order_id, p_action)
      on conflict (order_id, stage) do nothing;
    return;
  end if;

  if p_action = 'expire' then
    select status into v_status
      from public.orders
     where id = p_order_id
     for update;
    if not found then raise exception 'order_not_found'; end if;
    -- 경합: 조회~실행 사이 입금되면 status가 바뀌므로 취소하지 않는다.
    if v_status <> '입금대기' then return; end if;

    update public.subscription_slots
       set status       = '해지',
           cancel_reason = '입금 마감 자동취소',
           cancelled_at  = v_today
     where order_id = p_order_id and status in ('신청', '대기');

    update public.orders set status = '취소' where id = p_order_id;
    return;
  end if;

  raise exception 'bad_action: %', p_action;
end;
$$;

-- anon이 시크릿을 들고 호출(시크릿게이트). 그 외 권한 회수.
revoke all on function public.payment_recovery_targets(text) from public;
revoke all on function public.apply_recovery_action(text, uuid, text) from public;
grant execute on function public.payment_recovery_targets(text) to anon;
grant execute on function public.apply_recovery_action(text, uuid, text) to anon;
```

- [ ] **Step 2: SQL 문법 자체 검토**

기존 `migration-portone-payment.sql`·`migration-cancel-unpaid-order.sql`와 대조해 시크릿 검증·`for update`·슬롯 상태값(`신청`/`대기`→`해지`)·컬럼명이 일치하는지 눈으로 확인. (실DB 적용은 Task 6.)

- [ ] **Step 3: 커밋**

```bash
git add supabase/migration-payment-recovery.sql
git commit -m "feat: add order_reminders ledger + secret-gated recovery RPCs"
```

---

## Chunk 3: Netlify 스케줄 함수 + 설정

### Task 4: `@netlify/functions` 추가 + tsconfig 확인

**Files:**
- Modify: `package.json`
- Modify/확인: `tsconfig.json`

- [ ] **Step 1: 의존성 추가**

Run: `npm install -D @netlify/functions`
Expected: `package.json` devDependencies에 `@netlify/functions` 추가, `package-lock.json` 갱신.

- [ ] **Step 2: tsconfig include 확인**

`tsconfig.json`의 `include`에 `netlify/functions/**/*.mts`가 포함되는지 확인. Next 기본 include(`**/*.ts`, `**/*.tsx`)가 `.mts`를 안 잡으면 `include` 배열에 `"netlify/**/*.mts"`를 추가한다. (목표: Task 5 작성 후 `tsc --noEmit`가 이 파일을 타입체크.)

- [ ] **Step 3: 커밋**

```bash
git add package.json package-lock.json tsconfig.json
git commit -m "chore: add @netlify/functions for scheduled function typing"
```

---

### Task 5: 스케줄 함수 배선

**Files:**
- Create: `netlify/functions/payment-recovery.mts`

> 통합 코드(외부 I/O)라 vitest 단위테스트 대상이 아니다. 판정·메시지 로직은 Task 1·2에서 이미 테스트됨. 이 함수는 그 순수함수를 호출만 한다(얇은 배선). 검증은 `tsc` + 수동(Task 6).

- [ ] **Step 1: 함수 작성**

`netlify/functions/payment-recovery.mts`:
```ts
import type { Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { isSolapiConfigured, sendInfo } from "../../lib/solapi";
import {
  decideAction,
  buildRecoveryMessage,
  type RecoveryTarget,
} from "../../lib/payment-recovery";

type TargetRow = {
  order_id: string;
  created_at: string;
  ship_name: string;
  ship_phone: string;
  order_no: string;
  total_amount: number;
  has_subscription: boolean;
  sent_stages: string[] | null;
};

export default async function handler(): Promise<Response> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secret = process.env.PAYMENT_RECOVERY_SECRET;
  if (!url || !anon || !secret || !isSolapiConfigured()) {
    console.warn("[payment-recovery] 미설정 — 건너뜀");
    return new Response("skip: not configured");
  }

  const sb = createClient(url, anon);
  const { data, error } = await sb.rpc("payment_recovery_targets", {
    p_secret: secret,
  });
  if (error) {
    console.error("[payment-recovery] targets 조회 실패:", error.message);
    return new Response("error", { status: 500 });
  }

  const now = new Date();
  let sent = 0;
  let expired = 0;

  for (const row of (data ?? []) as TargetRow[]) {
    const t: RecoveryTarget = {
      orderId: row.order_id,
      createdAt: row.created_at,
      shipName: row.ship_name,
      shipPhone: row.ship_phone,
      orderNo: row.order_no,
      totalAmount: row.total_amount,
      hasSubscription: row.has_subscription,
      sentStages: row.sent_stages ?? [],
    };
    const action = decideAction(t, now);
    if (action === "none") continue;

    if (action === "EXPIRE") {
      const { error: exErr } = await sb.rpc("apply_recovery_action", {
        p_secret: secret,
        p_order_id: t.orderId,
        p_action: "expire",
      });
      if (exErr) console.error(`[payment-recovery] expire 실패 ${t.orderNo}:`, exErr.message);
      else expired += 1;
      continue;
    }

    // D1/D2: 발송 전 원장 기록(확정 정책 — 누락 < 중복).
    const { error: recErr } = await sb.rpc("apply_recovery_action", {
      p_secret: secret,
      p_order_id: t.orderId,
      p_action: action,
    });
    if (recErr) {
      console.error(`[payment-recovery] 원장 기록 실패 ${t.orderNo}:`, recErr.message);
      continue;
    }
    if (!t.shipPhone) {
      console.warn(`[payment-recovery] 전화번호 없음 ${t.orderNo}`);
      continue;
    }
    const m = buildRecoveryMessage(t, action);
    await sendInfo(t.shipPhone, {
      text: m.text,
      subject: m.subject,
      alimtalk: { templateKey: m.templateKey, variables: m.variables },
    });
    sent += 1;
  }

  console.log(`[payment-recovery] sent=${sent} expired=${expired}`);
  return new Response(`ok sent=${sent} expired=${expired}`);
}

// 매일 00:00 UTC = 09:00 KST.
export const config: Config = { schedule: "0 0 * * *" };
```

- [ ] **Step 2: tsc 게이트**

Run: `npx tsc --noEmit`
Expected: exit 0. (`.mts`가 범위 밖이라 체크 안 되면 Task 4 Step 2로 돌아가 include 조정.)

- [ ] **Step 3: 커밋**

```bash
git add netlify/functions/payment-recovery.mts
git commit -m "feat: schedule daily unpaid-order recovery (reminders + auto-cancel)"
```

---

### Task 6: 환경변수 문서화 + 통합 검증

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: `.env.example`에 자리표시자 추가**

Solapi 블록 근처에 추가(실제 값은 Netlify env + Vault로만):
```
# 가입 이탈 복구 크론용 공유 시크릿. Supabase Vault의 payment_recovery_secret 과 동일 값.
# (Netlify 환경변수로만 주입. 공개 repo 커밋 금지.)
PAYMENT_RECOVERY_SECRET=your-long-random-secret
```

- [ ] **Step 2: 커밋**

```bash
git add .env.example
git commit -m "docs: document PAYMENT_RECOVERY_SECRET for recovery cron"
```

- [ ] **Step 3: 통합 검증 (배포 환경, 수동)**

> 로컬에서 재현 불가한 부분. 아래는 배포 후 사람이 1회 수행하는 체크리스트다.

1. Supabase SQL Editor에 `supabase/migration-payment-recovery.sql` 적용.
2. `select vault.create_secret('<긴 난수>', 'payment_recovery_secret');` 실행. 같은 값을 Netlify env `PAYMENT_RECOVERY_SECRET`에 등록.
3. RPC 시크릿게이트 확인:
   - `select * from payment_recovery_targets('틀린값');` → `forbidden` 예외.
   - `select * from payment_recovery_targets('<맞는값>');` → `입금대기` 주문 행 반환.
4. 테스트 주문 1건을 `created_at` 1일 전으로 만든 뒤(또는 시드), Netlify 함수 수동 트리거(Netlify UI의 "Run" 또는 배포 후 스케줄 대기) → 알림톡/LMS 수신 + `order_reminders`에 `D1` 행 확인.
5. `created_at` 3일 초과 테스트 주문 → 트리거 → 주문 `취소`, 연결 슬롯 `해지`, SMS 미발송 확인.

- [ ] **Step 4: 리스크 — Netlify Scheduled Function 가용성**

이 "수정판 Next.js 16 + `next build --webpack`" 구성에서 `netlify/functions/*.mts` 스케줄 함수가 실제 빌드·등록되는지 배포 로그로 확인. **등록 실패 시 폴백:** GitHub Actions 크론(`schedule:`)이 시크릿 헤더로 보호된 신규 라우트 `app/api/cron/payment-recovery/route.ts`를 호출하도록 전환 — 라우트 본문은 Task 5 함수 로직과 동일(같은 RPC·순수함수 재사용). 이 전환은 별도 작업으로 분리한다.

---

## 완료 기준 (Definition of Done)

- [ ] `npx vitest run` 전체 PASS (신규 `lib/payment-recovery.test.ts` 포함).
- [ ] `npx tsc --noEmit` exit 0 (`.mts` 포함).
- [ ] 마이그레이션 SQL이 기존 Vault/슬롯 패턴과 일치(코드리뷰).
- [ ] 통합 체크리스트(Task 6 Step 3) 사람이 1회 수행 — 배포 후.
- [ ] 시크릿·service_role이 코드/커밋 어디에도 없음.

# 재구독 리텐션 (만료 임박 알림) Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 매일 09:00 KST 크론이 활성 정기구독 슬롯 중 파생 만료일 D-7·D-3에 도달한 회원(광고 수신동의자)에게 EXPIRE_SOON 만료 임박 알림을 보내 재구독을 유도한다.

**Architecture:** payment-recovery에서 검증된 **시크릿게이트 SECURITY DEFINER RPC 2개**(읽기/쓰기) + 원장 테이블 + Vault 시크릿 + Netlify 스케줄 함수 패턴을 **별도 격리**해 재사용한다. SQL(`renewal_reminder_targets`)이 파생 만료일을 단일 권위로 계산·필터링하고, TS(`decideRenewalStage`)가 D-7/D-3 단계 분기를 담당한다(SQL=집합, TS=분기·메시지). `service_role` 미사용 — anon 키 + Vault 시크릿.

**Tech Stack:** TypeScript, Next.js 16(MODIFIED), Supabase(Postgres RPC/Vault), Netlify Scheduled Functions(`.mts`), Solapi(LMS/알림톡), vitest(node env).

---

## 배경 (구현자 필독)

- **파생 만료일 공식(SSOT):** `만료일 = started_at + (원주문.block_weeks + slot.extended_weeks)*7일 + slot.paused_days일`. Postgres에서 `date + integer` = date 이므로 `s.started_at + ((o.block_weeks + s.extended_weeks)*7 + s.paused_days)`로 바로 date가 나온다. `block_weeks`는 **원주문**(`slot.order_id → orders.block_weeks`)에서 가져온다(재구독 주문 아님).
- **단계 윈도우(상호배타):** 만료까지 남은 KST 일수 `d`에 대해 `d<=0`→none(만료 당일/경과), `1<=d<=3`→D3, `4<=d<=7`→D7. 임계값 기반이라 크론 하루 누락에도 복원된다.
- **제외 대상:** ① 이미 재구독 시작(`exists orders where renews_slot_id=slot.id and status='입금대기'`) ② 일시정지(`paused=true`) ③ 단계별 발송완료(원장 dedup) ④ 광고 미동의(`profiles.marketing_consent=false`).
- **record-before-send:** 광고성이므로 중복<누락. 원장 기록 먼저, 발송 실패해도 재시도 차단.
- **원장 PK `(slot_id, stage, expiry_date)`:** 재구독 입금확인 시 `extended_weeks` 증가 → 만료일 변경 → 새 키 → 다음 주기 자동 재개. 같은 만료일 내 재발송만 차단.
- **기존 미러 대상 파일(읽고 패턴 일치시킬 것):** `lib/payment-recovery.ts`, `lib/payment-recovery.test.ts`, `supabase/migration-payment-recovery.sql`, `netlify/functions/payment-recovery.mts`.
- **표준 제약:** 공개 레포(시크릿·계좌·신분증·사업자증 커밋 금지). 명시 파일만 `git add <path>`, `git add -A`/`.` 금지. untracked jpg 2개(`public/brand/최종제품4인방2.jpg`, `public/brand/최종제품_4인방.jpg`) 제외. 외과적 변경·immutability·하드코딩 금지. lib import는 esbuild 호환 위해 상대경로.

## 파일 구조

| 파일 | 책임 |
|------|------|
| `lib/renewal-retention.ts` (Create) | 순수 로직: `decideRenewalStage`, `buildRenewalMessage`, 타입 `RenewalTarget`/`RenewalStage`/`RenewalMessage`. I/O 없음. |
| `lib/renewal-retention.test.ts` (Create) | vitest 단위테스트(11+ 케이스). |
| `supabase/migration-renewal-retention.sql` (Create) | 원장 `renewal_reminders` + RPC 2개 + Vault 안내 주석. |
| `netlify/functions/renewal-retention.mts` (Create) | 스케줄 배선(09:00 KST). |
| `.env.example` (Modify) | `RENEWAL_REMINDER_SECRET` 플레이스홀더 추가. |

`package.json` 무변경(`@netlify/functions` 기존 devDep). 만료일 공식은 SQL 단일 권위 — TS에 `deriveExpiry` 두지 않음(이중화 방지).

---

## Chunk 1: 전체 구현 (5 tasks)

### Task 1: `decideRenewalStage` 단계 판정 (순수 함수)

**Files:**
- Create: `lib/renewal-retention.ts`
- Test: `lib/renewal-retention.test.ts`

- [ ] **Step 1: Write the failing test**

`lib/renewal-retention.test.ts`:

```typescript
import { describe, it, expect } from "vitest";
import { decideRenewalStage } from "./renewal-retention";

// 기준 현재시각: KST 2026-06-10 12:00 (UTC 03:00) → KST 오늘 = 2026-06-10.
const now = new Date("2026-06-10T03:00:00.000Z");

describe("decideRenewalStage (KST 만료 잔여일 윈도우)", () => {
  it("D-8 이상은 none", () => {
    expect(decideRenewalStage("2026-06-18", now, [])).toBe("none"); // d=8
  });
  it("D-7은 D7", () => {
    expect(decideRenewalStage("2026-06-17", now, [])).toBe("D7"); // d=7
  });
  it("D-4는 D7", () => {
    expect(decideRenewalStage("2026-06-14", now, [])).toBe("D7"); // d=4
  });
  it("D-3은 D3", () => {
    expect(decideRenewalStage("2026-06-13", now, [])).toBe("D3"); // d=3
  });
  it("D-1은 D3", () => {
    expect(decideRenewalStage("2026-06-11", now, [])).toBe("D3"); // d=1
  });
  it("D7 이미 발송했으면 none", () => {
    expect(decideRenewalStage("2026-06-17", now, ["D7"])).toBe("none");
  });
  it("D3 이미 발송했으면 none", () => {
    expect(decideRenewalStage("2026-06-13", now, ["D3"])).toBe("none");
  });
  it("D-3 윈도우(d<=3)에선 D7 단계가 미발송이어도 D7을 보내지 않는다", () => {
    // d=2, D3는 이미 보냈고 D7은 미발송 → 상호배타로 none (뒤늦은 D-7 방지)
    expect(decideRenewalStage("2026-06-12", now, ["D3"])).toBe("none"); // d=2
  });
  it("만료 당일(d=0)은 none", () => {
    expect(decideRenewalStage("2026-06-10", now, [])).toBe("none");
  });
  it("만료 경과(d<0)는 none", () => {
    expect(decideRenewalStage("2026-06-09", now, [])).toBe("none"); // d=-1
  });
});

describe("decideRenewalStage (KST 자정 경계)", () => {
  it("KST 자정 직후엔 오늘이 넘어가 d가 1 줄어든다", () => {
    const justAfterMidnightKst = new Date("2026-06-09T15:30:00.000Z"); // KST 06-10 00:30
    expect(decideRenewalStage("2026-06-17", justAfterMidnightKst, [])).toBe("D7"); // d=7
  });
  it("KST 자정 직전엔 어제 기준이라 d가 1 크다", () => {
    const justBeforeMidnightKst = new Date("2026-06-09T14:30:00.000Z"); // KST 06-09 23:30
    expect(decideRenewalStage("2026-06-17", justBeforeMidnightKst, [])).toBe("none"); // d=8
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/renewal-retention.test.ts`
Expected: FAIL — `decideRenewalStage`가 정의되지 않음(모듈 없음).

- [ ] **Step 3: Write minimal implementation**

`lib/renewal-retention.ts`:

```typescript
// 재구독 리텐션 — 만료 임박 단계 판정·메시지 조립 (순수 함수, I/O 없음).
// import는 Netlify 번들러(esbuild) 호환을 위해 상대경로만 사용.

const SHOP = "송영신목장";

export type RenewalTarget = {
  slotId: number;
  name: string;
  phone: string;
  expiryDate: string; // 'YYYY-MM-DD' (KST 달력일, RPC가 계산해 반환)
  sentStages: string[]; // 이미 발송한 단계 (예: ["D7"])
};

export type RenewalStage = "D7" | "D3" | "none";

// 'YYYY-MM-DD'(KST 만료일)와 현재시각으로 만료까지 남은 KST 달력일 수.
// KST는 DST 없는 UTC+9.
function kstDaysUntil(expiryDate: string, now: Date): number {
  const [y, m, d] = expiryDate.split("-").map(Number);
  const expiryEpoch = Date.UTC(y, m - 1, d);
  const k = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const todayEpoch = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate());
  return Math.round((expiryEpoch - todayEpoch) / 86_400_000);
}

// 상호배타 윈도우: d<=0 none, 1<=d<=3 D3, 4<=d<=7 D7. 단계별 dedup.
export function decideRenewalStage(
  expiryDate: string,
  now: Date,
  sentStages: string[],
): RenewalStage {
  const d = kstDaysUntil(expiryDate, now);
  if (d <= 0) return "none";
  if (d <= 3) return sentStages.includes("D3") ? "none" : "D3";
  if (d <= 7) return sentStages.includes("D7") ? "none" : "D7";
  return "none";
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/renewal-retention.test.ts`
Expected: PASS — decideRenewalStage 12케이스 통과.

- [ ] **Step 5: Commit**

```bash
git add lib/renewal-retention.ts lib/renewal-retention.test.ts
git commit -m "feat: renewal-retention decideRenewalStage (KST D-7/D-3 윈도우)"
```

---

### Task 2: `buildRenewalMessage` 메시지 조립 (순수 함수)

**Files:**
- Modify: `lib/renewal-retention.ts`
- Test: `lib/renewal-retention.test.ts`

- [ ] **Step 1: Write the failing test** (테스트 파일 하단에 append)

```typescript
import { buildRenewalMessage, type RenewalTarget } from "./renewal-retention";

describe("buildRenewalMessage (EXPIRE_SOON)", () => {
  const t: RenewalTarget = {
    slotId: 7,
    name: "홍길동",
    phone: "01012345678",
    expiryDate: "2026-06-17",
    sentStages: [],
  };

  it("EXPIRE_SOON 템플릿키와 변수 #{고객명}/#{만료일}을 매핑한다", () => {
    const m = buildRenewalMessage(t);
    expect(m.templateKey).toBe("EXPIRE_SOON");
    expect(m.variables["#{고객명}"]).toBe("홍길동");
    expect(m.variables["#{만료일}"]).toBe("6월 17일");
  });

  it("LMS 폴백 본문에 이름과 만료일(M월 D일)이 들어간다", () => {
    const m = buildRenewalMessage(t);
    expect(m.text).toContain("홍길동");
    expect(m.text).toContain("6월 17일");
    expect(m.subject).toContain(SHOP_FOR_TEST);
  });
});

const SHOP_FOR_TEST = "송영신목장";
```

> 참고: `import` 문은 파일 상단의 기존 import와 합쳐도 되고 중복 import해도 vitest는 허용한다. 구현자는 상단 import에 `buildRenewalMessage`, `type RenewalTarget`을 추가하는 방식으로 정리할 것.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run lib/renewal-retention.test.ts`
Expected: FAIL — `buildRenewalMessage`가 정의되지 않음.

- [ ] **Step 3: Write minimal implementation** (`lib/renewal-retention.ts`에 append)

```typescript
export type RenewalMessage = {
  templateKey: "EXPIRE_SOON";
  variables: Record<string, string>;
  subject: string;
  text: string; // 알림톡 실패 시 LMS 폴백 본문
};

// 'YYYY-MM-DD' → "M월 D일".
function expiryLabel(expiryDate: string): string {
  const [, m, d] = expiryDate.split("-").map(Number);
  return `${m}월 ${d}일`;
}

export function buildRenewalMessage(t: RenewalTarget): RenewalMessage {
  const label = expiryLabel(t.expiryDate);
  return {
    templateKey: "EXPIRE_SOON",
    variables: {
      "#{고객명}": t.name,
      "#{만료일}": label,
    },
    subject: `[${SHOP}] 구독 만료 안내`,
    text:
      `[${SHOP}] ${t.name}님, 정기구독이 ${label}에 만료됩니다.\n` +
      `계속 받아보시려면 마이페이지에서 재구독을 신청해 주세요.`,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run lib/renewal-retention.test.ts`
Expected: PASS — 전체(단계 12 + 메시지 2) 통과.

- [ ] **Step 5: Commit**

```bash
git add lib/renewal-retention.ts lib/renewal-retention.test.ts
git commit -m "feat: renewal-retention buildRenewalMessage (EXPIRE_SOON)"
```

---

### Task 3: 원장 테이블 + 시크릿게이트 RPC 2개 (마이그레이션)

> SQL은 vitest 대상 아님. 정답성은 적용 후 **프로덕션 스모크 검증**(Task 5 운영 절차)으로 확인한다. payment-recovery 마이그레이션과 시크릿게이트 구조를 1:1로 맞출 것.

**Files:**
- Create: `supabase/migration-renewal-retention.sql`

- [ ] **Step 1: Write the migration**

`supabase/migration-renewal-retention.sql`:

```sql
-- 재구독 리텐션: 만료 임박 알림 원장 + 시크릿게이트 RPC.
--
-- 적용: Supabase SQL Editor에 붙여넣고 실행.
-- 사전(시크릿 등록, 1회) — payment_recovery_secret 과 별개의 무작위 문자열을 쓴다:
--   select vault.create_secret('<무작위-긴-문자열>', 'renewal_reminder_secret');
--   → Netlify 환경변수 RENEWAL_REMINDER_SECRET 에 동일 값 주입(공개 repo 커밋 금지).
-- 시크릿 교체 시:
--   select vault.update_secret(
--     (select id from vault.secrets where name = 'renewal_reminder_secret'),
--     '<새-무작위-긴-문자열>');
--   → Netlify env도 같은 값으로 교체.

-- 단계별 중복발송 방지 원장. expiry_date를 PK에 포함해 '주기'를 구분한다
-- (재구독 입금확인 → extended_weeks 증가 → 만료일 변경 → 새 키 → 다음 주기 재개).
create table if not exists public.renewal_reminders (
  slot_id     bigint not null references public.subscription_slots(id) on delete cascade,
  stage       text   not null check (stage in ('D7','D3')),
  expiry_date date   not null,
  sent_at     timestamptz not null default now(),
  primary key (slot_id, stage, expiry_date)
);

alter table public.renewal_reminders enable row level security;
-- 클라이언트 직접 접근 없음. RPC(SECURITY DEFINER)로만 읽고 쓴다 → 정책 미부여(전면 차단).

-- 읽기: 발송 대상 활성 슬롯 + 파생 만료일 + 이미 보낸 단계. 시크릿게이트.
-- 만료일은 SQL이 단일 권위로 계산: started_at + (원주문.block_weeks + extended_weeks)*7 + paused_days.
create or replace function public.renewal_reminder_targets(p_secret text)
returns table (
  slot_id     bigint,
  name        text,
  phone       text,
  expiry_date date,
  sent_stages text[]
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected text;
  v_today    date := (now() at time zone 'Asia/Seoul')::date;
begin
  select decrypted_secret into v_expected
    from vault.decrypted_secrets
   where name = 'renewal_reminder_secret';
  if v_expected is null or coalesce(p_secret, '') = '' or p_secret <> v_expected then
    raise exception 'forbidden';
  end if;

  return query
  with computed as (
    select s.id as slot_id,
           p.name as name,
           p.phone as phone,
           (s.started_at + ((o.block_weeks + s.extended_weeks) * 7 + s.paused_days)) as expiry_date
      from public.subscription_slots s
      join public.profiles p on p.id = s.user_id
      join public.orders o on o.id = s.order_id
     where s.status = '활성'
       and s.paused = false
       and s.started_at is not null
       and p.marketing_consent = true
       and not exists (
         select 1 from public.orders r
          where r.renews_slot_id = s.id and r.status = '입금대기'
       )
  )
  select c.slot_id, c.name, c.phone, c.expiry_date,
         coalesce(
           array_agg(rr.stage) filter (where rr.stage is not null),
           '{}'::text[]
         ) as sent_stages
    from computed c
    left join public.renewal_reminders rr
      on rr.slot_id = c.slot_id and rr.expiry_date = c.expiry_date
   where c.expiry_date between v_today and (v_today + 7)
   group by c.slot_id, c.name, c.phone, c.expiry_date;
end;
$$;

-- 쓰기: 단계 기록('D7'/'D3'). 시크릿게이트. record-before-send.
create or replace function public.record_renewal_reminder(
  p_secret  text,
  p_slot_id bigint,
  p_stage   text,
  p_expiry  date
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expected text;
begin
  select decrypted_secret into v_expected
    from vault.decrypted_secrets
   where name = 'renewal_reminder_secret';
  if v_expected is null or coalesce(p_secret, '') = '' or p_secret <> v_expected then
    raise exception 'forbidden';
  end if;

  if p_stage not in ('D7', 'D3') then
    raise exception 'bad_stage: %', p_stage;
  end if;

  insert into public.renewal_reminders(slot_id, stage, expiry_date)
    values (p_slot_id, p_stage, p_expiry)
    on conflict (slot_id, stage, expiry_date) do nothing;
end;
$$;

-- anon이 시크릿을 들고 호출(시크릿게이트). 그 외 권한 회수.
revoke all on function public.renewal_reminder_targets(text) from public;
revoke all on function public.record_renewal_reminder(text, bigint, text, date) from public;
grant execute on function public.renewal_reminder_targets(text) to anon;
grant execute on function public.record_renewal_reminder(text, bigint, text, date) to anon;
```

- [ ] **Step 2: Static sanity check (적용 전 검토)**

확인 항목(코드 리뷰로):
- 시크릿게이트 블록이 두 함수 모두 동일(`renewal_reminder_secret` 조회 → 불일치 시 `forbidden`).
- `revoke from public` 후 `grant execute to anon`만.
- 원장 RLS enabled, 정책 없음.
- 만료일 식이 **원주문**(`o.id = s.order_id`)의 `block_weeks`를 사용.
- 제외 4종(활성·미정지·동의·미재구독) + `started_at is not null` 가드 포함.
- 윈도우 `between v_today and v_today + 7`.

> 실제 DB 적용은 사람이 수행(Task 5 운영 절차). 이 Task는 SQL 파일 작성까지.

- [ ] **Step 3: Commit**

```bash
git add supabase/migration-renewal-retention.sql
git commit -m "feat: renewal-retention ledger + secret-gated RPCs (migration)"
```

---

### Task 4: Netlify 스케줄 함수 배선

> `netlify/functions/payment-recovery.mts`를 거의 그대로 따른다. esbuild가 `../../lib/*`를 번들.

**Files:**
- Create: `netlify/functions/renewal-retention.mts`

- [ ] **Step 1: Write the function**

`netlify/functions/renewal-retention.mts`:

```typescript
import type { Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { isSolapiConfigured, sendInfo } from "../../lib/solapi";
import {
  decideRenewalStage,
  buildRenewalMessage,
  type RenewalTarget,
} from "../../lib/renewal-retention";

type TargetRow = {
  slot_id: number;
  name: string;
  phone: string;
  expiry_date: string; // 'YYYY-MM-DD'
  sent_stages: string[] | null;
};

export default async function handler(): Promise<Response> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secret = process.env.RENEWAL_REMINDER_SECRET;
  if (!url || !anon || !secret || !isSolapiConfigured()) {
    console.warn("[renewal-retention] 미설정 — 건너뜀");
    return new Response("skip: not configured");
  }

  const sb = createClient(url, anon);
  const { data, error } = await sb.rpc("renewal_reminder_targets", {
    p_secret: secret,
  });
  if (error) {
    console.error("[renewal-retention] targets 조회 실패:", error.message);
    return new Response("error", { status: 500 });
  }

  const now = new Date();
  let sent = 0;

  for (const row of (data ?? []) as TargetRow[]) {
    const t: RenewalTarget = {
      slotId: row.slot_id,
      name: row.name,
      phone: row.phone,
      expiryDate: row.expiry_date,
      sentStages: row.sent_stages ?? [],
    };
    const stage = decideRenewalStage(t.expiryDate, now, t.sentStages);
    if (stage === "none") continue;

    // 발송 전 원장 기록(확정 정책 — 중복 < 누락).
    const { error: recErr } = await sb.rpc("record_renewal_reminder", {
      p_secret: secret,
      p_slot_id: t.slotId,
      p_stage: stage,
      p_expiry: t.expiryDate,
    });
    if (recErr) {
      console.error(`[renewal-retention] 원장 기록 실패 slot=${t.slotId}:`, recErr.message);
      continue;
    }
    if (!t.phone) {
      console.warn(`[renewal-retention] 전화번호 없음 slot=${t.slotId}`);
      continue;
    }
    const m = buildRenewalMessage(t);
    const result = await sendInfo(t.phone, {
      text: m.text,
      subject: m.subject,
      alimtalk: { templateKey: m.templateKey, variables: m.variables },
    });
    if (!result.ok) {
      console.warn(`[renewal-retention] 발송 실패 slot=${t.slotId}:`, result);
    }
    sent += 1;
  }

  console.log(`[renewal-retention] sent=${sent}`);
  return new Response(`ok sent=${sent}`);
}

// 매일 00:00 UTC = 09:00 KST.
export const config: Config = { schedule: "0 0 * * *" };
```

- [ ] **Step 2: Type-check**

Run: `npx tsc --noEmit`
Expected: exit 0 (타입 오류 0). `sendInfo` 시그니처·`RenewalTarget` 일치 확인.

- [ ] **Step 3: Commit**

```bash
git add netlify/functions/renewal-retention.mts
git commit -m "feat: renewal-retention scheduled function (09:00 KST)"
```

---

### Task 5: `.env.example` 추가 + 최종 게이트 + 운영 절차

**Files:**
- Modify: `.env.example`

- [ ] **Step 1: `.env.example`에 시크릿 플레이스홀더 추가**

기존 `PAYMENT_RECOVERY_SECRET=your-long-random-secret` 블록 **바로 다음**에 추가:

```bash
# 재구독 만료 임박 알림 크론용 공유 시크릿. Supabase Vault의 renewal_reminder_secret 과 동일 값.
# (payment_recovery_secret 과 별개의 무작위 문자열. Netlify 환경변수로만 주입. 공개 repo 커밋 금지.)
RENEWAL_REMINDER_SECRET=your-long-random-secret
```

- [ ] **Step 2: 신선한 전체 게이트 실행 (완료 주장 전 필수)**

```bash
npx vitest run
npx tsc --noEmit
```
Expected: vitest 전체 통과(기존 65 + 신규 14 = 79), tsc exit 0.
> 로컬 `next build --webpack`는 한글 경로로 깨지므로 정답성 게이트는 vitest+tsc로 대체(payment-recovery와 동일).

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "docs: add RENEWAL_REMINDER_SECRET to .env.example"
```

- [ ] **Step 4: 운영 절차 (사람이 수행 — 프로덕션 검증)**

> 코드 머지와 별개로, 기능 활성화는 아래 수동 단계가 필요하다(서명 없이 자동화 안 함).
1. `supabase/migration-renewal-retention.sql`을 Supabase SQL Editor에 적용.
2. Vault 시크릿 등록: `select vault.create_secret('<무작위-긴-문자열>', 'renewal_reminder_secret');` (payment_recovery_secret과 다른 값).
3. 시크릿게이트 검증: 틀린 값 → `forbidden`, 맞는 값 → `renewal_reminder_targets`가 대상 슬롯 반환(없으면 빈 결과).
4. Netlify env `RENEWAL_REMINDER_SECRET`에 동일 값 동기화.
5. Netlify에 스케줄 함수 `renewal-retention` 등록 확인(`schedule: "0 0 * * *"`).
6. 수동 트리거 1회 → 발송·원장 기록·중복방지 동작 확인.
7. **광고 라벨링 점검(컴플라이언스):** EXPIRE_SOON은 광고성으로 발송하므로, Solapi에 등록하는 템플릿/LMS 본문에 `(광고)` 표기와 무료수신거부 안내가 정보통신망법 요건을 충족하는지 검수 단계에서 확인. (코드 범위 밖 — 운영 결정.)

---

## 완료 기준 (Definition of Done)

- vitest 신규 14케이스 + 기존 전체 통과, `npx tsc --noEmit` exit 0 (이번 실행 증거 제시).
- 4개 신규 파일 + `.env.example` 수정 커밋, untracked jpg 2개 미포함, 시크릿/계좌 미커밋.
- 만료일은 SQL 단일 권위, TS는 단계 분기만. 제외 4종 + `started_at` 가드 적용.
- 운영 절차(Step 4)는 사람이 수행할 체크리스트로 문서화(이 단계 자동 실행 금지).

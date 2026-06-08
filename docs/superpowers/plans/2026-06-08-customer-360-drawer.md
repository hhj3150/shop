# 고객 360 정보 드로어 Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 관리자가 회원/주문 표에서 고객명을 누르면 그 고객의 구독 회차·잔여, 주문 이력(입금·송장·영수증 인라인), 환불을 오른쪽 드로어 한 곳에 모아 본다(읽기 전용).

**Architecture:** 데이터는 이미 `AdminPage` 상태에 전부 로드돼 있다. 순수 집계 함수 `lib/customer-360.ts`(TDD)가 한 고객의 원자료를 표시용 뷰모델로 변환하고, 표현 전용 `components/Customer360Drawer.tsx`가 그린다. `AdminPage`는 두 진입점 배선과 드로어 렌더만 담당하고 기존 `MemberOrdersModal`을 대체한다. 회차 계산은 기존 `lib/dispatch-schedule.ts`를 재사용한다.

**Tech Stack:** Next.js(App Router, webpack), React 클라이언트 컴포넌트, TypeScript, Tailwind, Vitest. 빌드 게이트 = `next build`.

**Spec:** [docs/superpowers/specs/2026-06-08-customer-360-drawer-design.md](../specs/2026-06-08-customer-360-drawer-design.md)

**관련 스킬:** @superpowers:test-driven-development

---

## 파일 구조

- **Create** `lib/customer-360.ts` — 순수 집계 함수 `buildCustomer360(input) → Customer360`. React/Supabase 비의존. 의존: `lib/dispatch-schedule.ts`.
- **Create** `lib/customer-360.test.ts` — 집계 함수 단위 테스트.
- **Create** `components/Customer360Drawer.tsx` — 뷰모델을 받아 오른쪽 드로어로 렌더. 의존: 뷰모델 타입, `components/ProfileEditor`.
- **Modify** `app/admin/page.tsx` — import 교체, 뷰모델 useMemo, 드로어 렌더 교체, `주문·입금` 탭 고객명 클릭 핸들러 추가.
- **Delete** `components/MemberOrdersModal.tsx` — 대체됨.

---

## Chunk 1: 집계 함수 + 드로어 + 배선

### Task 1: 집계 함수 `lib/customer-360.ts` (TDD)

**Files:**
- Create: `lib/customer-360.ts`
- Test: `lib/customer-360.test.ts`

- [ ] **Step 1: 실패하는 테스트 작성**

`lib/customer-360.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { buildCustomer360, type C360Input, type C360Order, type C360Slot } from "./customer-360";

const TODAY = "2026-06-15";

function order(over: Partial<C360Order> = {}): C360Order {
  return {
    id: "o1", user_id: "u1", order_no: "ORD-1", status: "배송중",
    order_type: "구독", block_weeks: 8, total_amount: 100000,
    created_at: "2026-06-01T00:00:00Z",
    paid_at: null, pay_method: null,
    courier: null, tracking_no: null, shipped_at: null,
    cash_receipt_type: null, cash_receipt_issued: null,
    ...over,
  };
}

function slot(over: Partial<C360Slot> = {}): C360Slot {
  return {
    id: 1, user_id: "u1", order_id: "o1", delivery_day: "mon",
    status: "활성", started_at: "2026-06-08", paused: false,
    paused_at: null, paused_days: 0, extended_weeks: 0,
    refund_amount: null, cancelled_at: null,
    ...over,
  };
}

function input(over: Partial<C360Input> = {}): C360Input {
  return {
    userId: "u1", name: "이름폴백",
    orders: [], items: [], slots: [], returns: [],
    profile: null, summary: null, todayISO: TODAY,
    ...over,
  };
}

describe("buildCustomer360", () => {
  it("빈 데이터면 빈 배열과 폴백 이름을 돌려준다", () => {
    const c = buildCustomer360(input());
    expect(c.orders).toEqual([]);
    expect(c.subscriptions).toEqual([]);
    expect(c.refunds).toEqual([]);
    expect(c.header.name).toBe("이름폴백");
  });

  it("프로필이 있으면 프로필 이름을 우선한다", () => {
    const c = buildCustomer360(input({
      profile: { name: "송영신", phone: "010", postcode: null, address: null, address_detail: null },
    }));
    expect(c.header.name).toBe("송영신");
  });

  it("주문을 최신순으로 정렬하고 인라인 입금·송장·영수증을 구성한다", () => {
    const c = buildCustomer360(input({
      orders: [
        order({ id: "old", order_no: "ORD-OLD", created_at: "2026-05-01T00:00:00Z" }),
        order({
          id: "new", order_no: "ORD-NEW", created_at: "2026-06-10T00:00:00Z",
          paid_at: "2026-06-10", pay_method: "카드",
          courier: "CJ", tracking_no: "123", shipped_at: "2026-06-11",
          cash_receipt_type: "소득공제", cash_receipt_issued: true,
        }),
      ],
      items: [{ order_id: "new", product_name: "유정란", volume: "30구", qty: 2 }],
    }));
    expect(c.orders.map((o) => o.orderNo)).toEqual(["ORD-NEW", "ORD-OLD"]);
    const n = c.orders[0];
    expect(n.deposit).toEqual({ paidAt: "2026-06-10", payMethod: "카드" });
    expect(n.tracking).toEqual({ courier: "CJ", trackingNo: "123", shippedAt: "2026-06-11" });
    expect(n.receipt).toEqual({ type: "소득공제", issued: true });
    expect(n.items).toEqual([{ productName: "유정란", volume: "30구", qty: 2 }]);
  });

  it("입금·송장·영수증 정보가 없으면 해당 인라인을 null 로 둔다", () => {
    const c = buildCustomer360(input({ orders: [order()] }));
    expect(c.orders[0].deposit).toBeNull();
    expect(c.orders[0].tracking).toBeNull();
    expect(c.orders[0].receipt).toBeNull();
  });

  it("진행 중 구독: total=block+extended, 잔여>0, 상태 활성", () => {
    const c = buildCustomer360(input({
      orders: [order({ id: "o1", block_weeks: 8 })],
      slots: [slot({ extended_weeks: 0, started_at: "2026-06-08" })],
    }));
    const s = c.subscriptions[0];
    expect(s.total).toBe(8);
    expect(s.remaining).toBeGreaterThan(0);
    expect(s.state).toBe("활성");
    expect(s.weekdayLabel).toBe("월");
  });

  it("회차 소진(과거 시작·소량 회차)이면 잔여 0·상태 완료", () => {
    const c = buildCustomer360(input({
      orders: [order({ id: "o1", block_weeks: 4 })],
      slots: [slot({ started_at: "2026-01-01", extended_weeks: 0 })],
    }));
    const s = c.subscriptions[0];
    expect(s.remaining).toBe(0);
    expect(s.state).toBe("완료");
  });

  it("정지·해지 슬롯은 상태가 정지·해지로 매핑된다", () => {
    const c = buildCustomer360(input({
      orders: [order({ id: "o1" })],
      slots: [
        slot({ id: 1, paused: true, paused_at: "2026-06-10" }),
        slot({ id: 2, status: "해지", cancelled_at: "2026-06-09" }),
      ],
    }));
    const byId = new Map(c.subscriptions.map((s) => [s.slotId, s.state]));
    expect(byId.get(1)).toBe("정지");
    expect(byId.get(2)).toBe("해지");
  });

  it("환불을 구독해지 + 환불접수로 합본해 날짜 내림차순 정렬한다", () => {
    const c = buildCustomer360(input({
      orders: [order({ id: "o1", order_no: "ORD-1" })],
      slots: [slot({ status: "해지", refund_amount: 60000, cancelled_at: "2026-05-20" })],
      returns: [{ order_id: "o1", type: "환불", amount: 12000, created_at: "2026-06-01" }],
    }));
    expect(c.refunds.map((r) => r.source)).toEqual(["환불접수", "구독해지"]);
    expect(c.refunds[0].amount).toBe(12000);
    expect(c.refunds[1].label).toContain("구독 해지");
  });

  it("다른 user 의 주문·슬롯·환불은 섞이지 않는다", () => {
    const c = buildCustomer360(input({
      userId: "u1",
      orders: [order({ id: "o1", user_id: "u1" }), order({ id: "o2", user_id: "u2" })],
      slots: [slot({ id: 9, user_id: "u2" })],
      returns: [{ order_id: "o2", type: "환불", amount: 1, created_at: "2026-06-01" }],
    }));
    expect(c.orders.map((o) => o.id)).toEqual(["o1"]);
    expect(c.subscriptions).toEqual([]);
    expect(c.refunds).toEqual([]);
  });
});
```

- [ ] **Step 2: 테스트 실패 확인**

Run: `npx vitest run lib/customer-360.test.ts`
Expected: FAIL — `Cannot find module './customer-360'` (구현 없음).

- [ ] **Step 3: 최소 구현 작성**

`lib/customer-360.ts`:

```ts
// 고객 한 명의 흩어진 원자료(주문·품목·구독슬롯·환불·프로필)를 360 드로어 표시용
//   뷰모델로 집계하는 순수 함수. React/Supabase 비의존 — 단위 테스트 대상.
import { dispatchScheduleForSlot, type DispatchSlotInfo } from "./dispatch-schedule";

// ── 입력 타입(관리자 행 타입의 구조적 부분집합) ─────────────
export type C360Order = {
  id: string;
  user_id: string;
  order_no: string;
  status: string;
  order_type: string;
  block_weeks: number | null;
  total_amount: number;
  created_at: string;
  paid_at: string | null;
  pay_method: string | null;
  courier: string | null;
  tracking_no: string | null;
  shipped_at: string | null;
  cash_receipt_type: string | null;
  cash_receipt_issued: boolean | null;
};

export type C360Item = {
  order_id: string;
  product_name: string;
  volume: string;
  qty: number;
};

export type C360Slot = DispatchSlotInfo & {
  id: number;
  user_id: string;
  order_id: string | null;
  delivery_day: string;
  refund_amount: number | null;
  cancelled_at: string | null;
};

export type C360Return = {
  order_id: string;
  type: string;
  amount: number;
  created_at: string;
};

export type C360Profile = {
  name: string;
  phone: string;
  postcode: string | null;
  address: string | null;
  address_detail: string | null;
} | null;

export type C360Summary = {
  ltv: number;
  confirmedCount: number;
  aov: number;
  segment: string;
  recencyDays: number | null;
} | null;

export type C360Input = {
  userId: string;
  name: string; // 프로필 결손 시 폴백 이름
  orders: C360Order[];
  items: C360Item[];
  slots: C360Slot[];
  returns: C360Return[];
  profile: C360Profile;
  summary: C360Summary;
  todayISO: string;
};

// ── 출력 뷰모델 ───────────────────────────────
export type SubState = "활성" | "정지" | "완료" | "해지";

export type SubLine = {
  slotId: number;
  weekdayLabel: string;
  state: SubState;
  round: number;
  total: number;
  remaining: number;
  startedAt: string | null;
};

export type OrderCard = {
  id: string;
  orderNo: string;
  orderType: string;
  status: string;
  totalAmount: number;
  createdAt: string;
  blockWeeks: number | null;
  items: { productName: string; volume: string; qty: number }[];
  deposit: { paidAt: string | null; payMethod: string | null } | null;
  tracking: { courier: string | null; trackingNo: string | null; shippedAt: string | null } | null;
  receipt: { type: string; issued: boolean } | null;
};

export type RefundLine = {
  source: "구독해지" | "환불접수";
  label: string;
  date: string | null;
  amount: number;
};

export type Customer360 = {
  header: { name: string; profile: C360Profile; summary: C360Summary };
  subscriptions: SubLine[];
  orders: OrderCard[];
  refunds: RefundLine[];
};

const WEEKDAY_LABEL: Record<string, string> = {
  mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일",
};

function subState(slot: C360Slot, remaining: number): SubState {
  if (slot.status === "해지") return "해지";
  if (slot.paused) return "정지";
  if (remaining === 0) return "완료";
  return "활성";
}

export function buildCustomer360(input: C360Input): Customer360 {
  const { userId, name, orders, items, slots, returns, profile, summary, todayISO } = input;

  // 이 고객의 주문(최신순) + order_id 집합(품목·환불 소속 판정용).
  const myOrders = orders
    .filter((o) => o.user_id === userId)
    .slice()
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
  const myOrderIds = new Set(myOrders.map((o) => o.id));
  const blockWeeksByOrder = new Map(orders.map((o) => [o.id, o.block_weeks ?? 0]));
  const orderNoById = new Map(myOrders.map((o) => [o.id, o.order_no]));

  // 주문별 품목.
  const itemsByOrder = new Map<string, { productName: string; volume: string; qty: number }[]>();
  for (const it of items) {
    if (!myOrderIds.has(it.order_id)) continue;
    const arr = itemsByOrder.get(it.order_id) ?? [];
    arr.push({ productName: it.product_name, volume: it.volume, qty: it.qty });
    itemsByOrder.set(it.order_id, arr);
  }

  const orderCards: OrderCard[] = myOrders.map((o) => ({
    id: o.id,
    orderNo: o.order_no,
    orderType: o.order_type,
    status: o.status,
    totalAmount: o.total_amount,
    createdAt: o.created_at,
    blockWeeks: o.block_weeks,
    items: itemsByOrder.get(o.id) ?? [],
    deposit: o.paid_at || o.pay_method ? { paidAt: o.paid_at, payMethod: o.pay_method } : null,
    tracking:
      o.courier || o.tracking_no || o.shipped_at
        ? { courier: o.courier, trackingNo: o.tracking_no, shippedAt: o.shipped_at }
        : null,
    receipt: o.cash_receipt_type
      ? { type: o.cash_receipt_type, issued: o.cash_receipt_issued === true }
      : null,
  }));

  // 구독 슬롯 — 원주문 block_weeks 로 회차 계산(슬롯엔 block_weeks 컬럼이 없다).
  const subscriptions: SubLine[] = slots
    .filter((s) => s.user_id === userId)
    .map((s) => {
      const blockWeeks = s.order_id ? blockWeeksByOrder.get(s.order_id) ?? 0 : 0;
      const { round, total, remaining } = dispatchScheduleForSlot(s, blockWeeks, todayISO);
      return {
        slotId: s.id,
        weekdayLabel: WEEKDAY_LABEL[s.delivery_day] ?? s.delivery_day,
        state: subState(s, remaining),
        round,
        total,
        remaining,
        startedAt: s.started_at,
      };
    });

  // 환불 합본: 구독 해지(refund_amount>0) + 환불접수(내 주문 소속). 출처가 달라 중복되지 않는다.
  const cancelRefunds: RefundLine[] = slots
    .filter((s) => s.user_id === userId && s.status === "해지" && (s.refund_amount ?? 0) > 0)
    .map((s) => ({
      source: "구독해지" as const,
      label: `${WEEKDAY_LABEL[s.delivery_day] ?? s.delivery_day}요일 구독 해지`,
      date: s.cancelled_at,
      amount: s.refund_amount ?? 0,
    }));
  const returnRefunds: RefundLine[] = returns
    .filter((r) => myOrderIds.has(r.order_id))
    .map((r) => ({
      source: "환불접수" as const,
      label: `${orderNoById.get(r.order_id) ?? r.order_id} ${r.type}`,
      date: r.created_at,
      amount: r.amount,
    }));
  const refunds = [...cancelRefunds, ...returnRefunds].sort((a, b) =>
    (b.date ?? "").localeCompare(a.date ?? "")
  );

  return {
    header: { name: profile?.name || name, profile, summary },
    subscriptions,
    orders: orderCards,
    refunds,
  };
}
```

- [ ] **Step 4: 테스트 통과 확인**

Run: `npx vitest run lib/customer-360.test.ts`
Expected: PASS (9 passed).

- [ ] **Step 5: 커밋**

```bash
git add lib/customer-360.ts lib/customer-360.test.ts
git commit -m "feat: 고객 360 집계 함수 buildCustomer360 (TDD)"
```

---

### Task 2: 드로어 컴포넌트 `components/Customer360Drawer.tsx`

표현 전용. 단위 테스트 없음(빌드 타입체크로 검증). 기존 `MemberOrdersModal`의 닫기·정보수정 패턴을 계승하되, 중앙 모달 → 오른쪽 드로어로 바꾸고 구독·환불 섹션을 추가한다.

**Files:**
- Create: `components/Customer360Drawer.tsx`

- [ ] **Step 1: 컴포넌트 작성**

`components/Customer360Drawer.tsx`:

```tsx
"use client";

import { useEffect, useState } from "react";
import { formatKRW } from "@/lib/products";
import { ProfileEditor, type ProfileEditValues } from "@/components/ProfileEditor";
import type { Customer360, SubState } from "@/lib/customer-360";

// 관리자: 고객 한 명의 전체 맥락(구독 회차·주문·입금·송장·영수증·환불)을 오른쪽 드로어에 모아 본다.
//   읽기 전용. 단, 회원 기준 정보(연락처·주소)는 잘못 기재된 값을 정정할 수 있다.
const SUB_TONE: Record<SubState, string> = {
  활성: "bg-emerald-100 text-emerald-700",
  정지: "bg-amber-100 text-amber-700",
  완료: "bg-ink/10 text-mute",
  해지: "bg-rose-100 text-rose-700",
};

export function Customer360Drawer({
  data,
  onSaveMember,
  onClose,
}: {
  data: Customer360;
  // 회원 기준 정보 저장. 프로필이 없으면(주문만 있는 사용자) 호출 측에서 undefined.
  onSaveMember?: (values: ProfileEditValues) => Promise<void>;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [openOrder, setOpenOrder] = useState<string | null>(data.orders[0]?.id ?? null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const { header, subscriptions, orders, refunds } = data;
  const { summary, profile } = header;

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-ink/40 no-print"
      onClick={onClose}
    >
      <div
        className="flex h-full w-full max-w-md flex-col overflow-y-auto bg-cream shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* 헤더 */}
        <div className="sticky top-0 z-10 border-b border-line bg-cream/95 px-6 py-5 backdrop-blur">
          <div className="flex items-start justify-between">
            <div>
              <p className="eyebrow text-gold-deep">Customer 360</p>
              <h3 className="mt-1 font-serif-kr text-xl text-ink">{header.name}님</h3>
            </div>
            <button
              onClick={onClose}
              className="rounded-full border border-line px-3 py-1.5 text-[13px] text-ink-soft transition-colors hover:border-gold hover:text-gold"
            >
              닫기
            </button>
          </div>
          {summary && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              <span className="rounded-full bg-ink/5 px-2.5 py-1 text-[12px] text-ink-soft">
                등급 <span className="font-medium text-ink">{summary.segment}</span>
              </span>
              <span className="rounded-full bg-ink/5 px-2.5 py-1 text-[12px] text-ink-soft">
                누적구매 <span className="tabular-nums font-medium text-ink">{formatKRW(summary.ltv)}</span>
              </span>
              <span className="rounded-full bg-ink/5 px-2.5 py-1 text-[12px] text-ink-soft">
                확정 <span className="tabular-nums font-medium text-ink">{summary.confirmedCount}건</span>
              </span>
              <span className="rounded-full bg-ink/5 px-2.5 py-1 text-[12px] text-ink-soft">
                객단가 <span className="tabular-nums font-medium text-ink">{formatKRW(summary.aov)}</span>
              </span>
              {summary.recencyDays !== null && (
                <span className="rounded-full bg-ink/5 px-2.5 py-1 text-[12px] text-ink-soft">
                  최근주문 <span className="tabular-nums font-medium text-ink">{summary.recencyDays}일 전</span>
                </span>
              )}
            </div>
          )}
        </div>

        <div className="flex-1 px-6 py-5">
          {/* 회원 기준 정보 — 잘못된 연락처·주소를 관리자가 정정. */}
          {profile && onSaveMember && (
            <div className="rounded-2xl border border-line bg-paper p-4">
              {editing ? (
                <ProfileEditor
                  initial={{
                    name: profile.name,
                    phone: profile.phone,
                    postcode: profile.postcode ?? "",
                    address: profile.address ?? "",
                    address_detail: profile.address_detail ?? "",
                  }}
                  saveLabel="회원 정보 저장"
                  onSave={async (values) => {
                    await onSaveMember(values);
                    setEditing(false);
                  }}
                  onCancel={() => setEditing(false)}
                />
              ) : (
                <div className="flex items-start justify-between gap-3">
                  <div className="text-[13px] leading-relaxed text-ink-soft">
                    <p className="tabular-nums text-ink">{profile.phone || "연락처 없음"}</p>
                    <p className="mt-0.5 text-mute">
                      {profile.address
                        ? `${profile.postcode ? `(${profile.postcode}) ` : ""}${profile.address} ${profile.address_detail ?? ""}`
                        : "주소 없음"}
                    </p>
                  </div>
                  <button
                    onClick={() => setEditing(true)}
                    className="shrink-0 rounded-full border border-line px-3 py-1.5 text-[13px] text-ink-soft transition-colors hover:border-gold hover:text-gold"
                  >
                    정보 수정
                  </button>
                </div>
              )}
            </div>
          )}

          {/* 구독 현황 */}
          <section className="mt-5">
            <p className="eyebrow text-gold-deep">구독 현황 ({subscriptions.length})</p>
            {subscriptions.length === 0 ? (
              <p className="mt-2 text-[13px] text-mute">구독 내역이 없습니다.</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {subscriptions.map((s) => (
                  <li
                    key={s.slotId}
                    className="flex items-center justify-between rounded-xl border border-line bg-paper px-3.5 py-2.5 text-[13px]"
                  >
                    <span className="text-ink">
                      {s.weekdayLabel}요일 구독
                      <span className={`ml-2 rounded-full px-2 py-0.5 text-[11px] ${SUB_TONE[s.state]}`}>
                        {s.state}
                      </span>
                    </span>
                    <span className="tabular-nums text-ink-soft">
                      <span className="font-medium text-ink">
                        {s.round}/{s.total}회차
                      </span>
                      {s.state !== "해지" && <span className="ml-1.5 text-mute">잔여 {s.remaining}</span>}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          {/* 주문 이력 — 입금·송장·영수증 인라인 */}
          <section className="mt-6">
            <p className="eyebrow text-gold-deep">주문 이력 ({orders.length})</p>
            {orders.length === 0 ? (
              <p className="mt-2 text-[13px] text-mute">주문 내역이 없습니다.</p>
            ) : (
              <ul className="mt-2 space-y-2.5">
                {orders.map((o) => {
                  const open = openOrder === o.id;
                  return (
                    <li key={o.id} className="rounded-2xl border border-line bg-paper p-4">
                      <button
                        className="flex w-full items-start justify-between gap-3 text-left"
                        onClick={() => setOpenOrder(open ? null : o.id)}
                      >
                        <div>
                          <p className="text-[14px] tabular-nums text-ink">
                            {o.orderNo}
                            <span className="ml-2 rounded-full bg-ink/5 px-2 py-0.5 text-[12px] text-ink-soft">
                              {o.orderType}
                            </span>
                            {o.orderType === "구독" && o.blockWeeks ? (
                              <span className="ml-1.5 rounded-full bg-gold/15 px-2 py-0.5 text-[12px] font-medium text-gold-deep">
                                {o.blockWeeks}주 구독
                              </span>
                            ) : null}
                          </p>
                          <p className="mt-0.5 text-[12.5px] text-mute">
                            {new Date(o.createdAt).toLocaleDateString("ko-KR")}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-[13px] font-medium text-gold-deep">{o.status}</p>
                          <p className="mt-0.5 text-[14px] tabular-nums text-ink">{formatKRW(o.totalAmount)}</p>
                        </div>
                      </button>

                      {open && (
                        <div className="mt-3 space-y-2 border-t border-line pt-3 text-[12.5px]">
                          <div className="space-y-0.5 text-ink-soft">
                            {o.deposit && (
                              <p>
                                · 입금 {o.deposit.paidAt ? new Date(o.deposit.paidAt).toLocaleDateString("ko-KR") : "—"}
                                {o.deposit.payMethod ? ` (${o.deposit.payMethod})` : ""}
                              </p>
                            )}
                            {o.tracking && (
                              <p>
                                · 송장 {o.tracking.courier ?? ""} <span className="tabular-nums">{o.tracking.trackingNo ?? "—"}</span>
                                {o.tracking.shippedAt ? ` (${new Date(o.tracking.shippedAt).toLocaleDateString("ko-KR")} 발송)` : ""}
                              </p>
                            )}
                            {o.receipt && (
                              <p>
                                · 영수증 {o.receipt.type} {o.receipt.issued ? "✓발행" : "미발행"}
                              </p>
                            )}
                            {!o.deposit && !o.tracking && !o.receipt && (
                              <p className="text-mute">입금·송장·영수증 정보 없음</p>
                            )}
                          </div>
                          {o.items.length > 0 && (
                            <ul className="space-y-1 border-t border-line pt-2">
                              {o.items.map((it, idx) => (
                                <li key={idx} className="flex items-baseline justify-between">
                                  <span className="text-ink-soft">
                                    {it.productName} <span className="text-mute">{it.volume}</span>
                                  </span>
                                  <span className="tabular-nums text-ink">×{it.qty}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </section>

          {/* 환불·해지 */}
          {refunds.length > 0 && (
            <section className="mt-6">
              <p className="eyebrow text-gold-deep">환불·해지 ({refunds.length})</p>
              <ul className="mt-2 space-y-1.5">
                {refunds.map((r, idx) => (
                  <li
                    key={idx}
                    className="flex items-center justify-between rounded-xl border border-line bg-paper px-3.5 py-2.5 text-[13px]"
                  >
                    <span className="text-ink-soft">
                      {r.label}
                      {r.date && <span className="ml-1.5 text-mute">{new Date(r.date).toLocaleDateString("ko-KR")}</span>}
                    </span>
                    <span className="tabular-nums text-ink">환불 {formatKRW(r.amount)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: 타입체크/빌드로 검증**

Run: `npx tsc --noEmit`
Expected: 에러 0 (단, `app/admin/page.tsx`는 아직 새 컴포넌트를 안 쓰므로 영향 없음). 만약 `formatKRW`·`ProfileEditor` import 경로 에러가 나면 `components/MemberOrdersModal.tsx`의 동일 import와 대조해 맞춘다.

- [ ] **Step 3: 커밋**

```bash
git add components/Customer360Drawer.tsx
git commit -m "feat: 고객 360 드로어 컴포넌트(표현 전용)"
```

---

### Task 3: `app/admin/page.tsx` 배선 + `MemberOrdersModal` 제거

**Files:**
- Modify: `app/admin/page.tsx`
- Delete: `components/MemberOrdersModal.tsx`

- [ ] **Step 1: import 교체**

`app/admin/page.tsx` 상단에서 `MemberOrdersModal` import(라인 ~32)를 제거하고 다음을 추가:

```ts
import { Customer360Drawer } from "@/components/Customer360Drawer";
import { buildCustomer360 } from "@/lib/customer-360";
```

- [ ] **Step 2: 뷰모델 useMemo 추가**

`selectedMemberRow`(라인 ~728) 정의 근처, `selectedMember`/`selectedMemberRow`가 모두 보이는 위치 아래에 추가. `orders`·`items`·`slots`·`returns`·`profiles`·`nameByUser`·`todayISO()`는 이미 스코프에 있다.

```ts
const customer360 = useMemo(() => {
  if (!selectedMember) return null;
  return buildCustomer360({
    userId: selectedMember,
    name: nameByUser.get(selectedMember) ?? "회원",
    orders,
    items,
    slots,
    returns,
    profile: selectedMemberRow
      ? {
          name: selectedMemberRow.name ?? "",
          phone: selectedMemberRow.phone ?? "",
          postcode: selectedMemberRow.postcode ?? null,
          address: selectedMemberRow.address ?? null,
          address_detail: selectedMemberRow.address_detail ?? null,
        }
      : null,
    summary: selectedMemberRow
      ? {
          ltv: selectedMemberRow.ltv,
          confirmedCount: selectedMemberRow.confirmedCount,
          aov: selectedMemberRow.aov,
          segment: selectedMemberRow.segment,
          recencyDays: selectedMemberRow.recencyDays,
        }
      : null,
    todayISO: todayISO(),
  });
}, [selectedMember, selectedMemberRow, orders, items, slots, returns, nameByUser]);
```

> 참고: `items` 상태 변수명이 다르면(예: `itemRows`) 실제 이름으로 맞춘다. `lib/customer-360.ts`의 `C360Item`은 `{ order_id, product_name, volume, qty }` 구조만 필요하다 — 관리자 `ItemRow`가 이를 만족한다.

- [ ] **Step 3: 드로어 렌더 교체**

기존 `{selectedMember && (<MemberOrdersModal … />)}` 블록(라인 ~1975–2000)을 통째로 교체:

```tsx
{customer360 && (
  <Customer360Drawer
    data={customer360}
    onSaveMember={
      selectedMemberRow ? (values) => saveMember(selectedMember!, values) : undefined
    }
    onClose={() => setSelectedMember(null)}
  />
)}
```

- [ ] **Step 4: `주문·입금` 탭 고객명 클릭 핸들러 추가**

`주문·입금` 탭의 주문 표에서 고객명(입금자) 셀은 **라인 ~1786**의 `<td className="py-2.5 text-ink-soft">{o.depositor_name ?? o.ship_name}</td>` 이다. 이 셀의 **표시 표현식을 그대로 보존**한 채(입금자명 폴백 유지) 버튼으로만 감싼다. `회원·구독` 표의 기존 패턴과 동일한 amber underline 스타일을 쓴다:

```tsx
<td className="py-2.5 text-ink-soft">
  <button
    onClick={() => setSelectedMember(o.user_id)}
    className="text-amber-800 underline decoration-amber-300 underline-offset-2 hover:text-ink"
  >
    {o.depositor_name ?? o.ship_name}
  </button>
</td>
```

> 외과적 변경: 이 셀의 표시 내용(`o.depositor_name ?? o.ship_name`)을 바꾸지 말고 버튼으로만 감싼다. 다른 셀·로직은 건드리지 않는다. 라인 번호는 이전 작업으로 이동할 수 있으니 `depositor_name ?? o.ship_name` grep으로 정확한 셀을 먼저 확인한다.

- [ ] **Step 5: `MemberOrdersModal` 삭제**

```bash
git rm components/MemberOrdersModal.tsx
```

- [ ] **Step 6: 빌드 게이트 (타입체크 + 프로덕션 빌드)**

Run: `npx tsc --noEmit && npx next build --webpack`
Expected: 타입 에러 0, 빌드 exit 0. `MemberOrdersModal` 잔여 참조가 있으면 빌드가 실패하니 모두 제거됐는지 확인.

- [ ] **Step 7: 전체 테스트 재실행(회귀 확인)**

Run: `npx vitest run`
Expected: 기존 테스트 + `customer-360` 신규 테스트 모두 PASS.

- [ ] **Step 8: 커밋**

```bash
git add app/admin/page.tsx
git commit -m "feat: 관리자 360 드로어 배선(회원·주문 진입) + MemberOrdersModal 대체"
```

---

### Task 4: PR

- [ ] **Step 1: 푸시 & PR**

`feedback_git_workflow` 메모대로 증분 단위 PR → Netlify `next build` 통과 후 squash 머지.

```bash
git push -u origin HEAD
gh pr create --fill
```

PR 본문에 테스트 계획(집계 9개 단위테스트 통과, `next build` 통과, 두 진입점 수동 확인)을 적는다.

---

## 검증 체크리스트 (완료 전)

- [ ] `npx vitest run lib/customer-360.test.ts` — 9 passed
- [ ] `npx vitest run` — 기존 포함 전체 passed
- [ ] `npx tsc --noEmit` — 0 errors
- [ ] `npx next build --webpack` — exit 0
- [ ] `components/MemberOrdersModal.tsx` 참조 0건 (`grep -rn MemberOrdersModal app components` → 없음)
- [ ] 회원·구독 탭 회원명 클릭 → 드로어 열림
- [ ] 주문·입금 탭 고객명 클릭 → 같은 드로어 열림

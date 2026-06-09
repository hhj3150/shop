"use client";

// 관리자 전역 검색바 — 어느 탭에 있든 회원·주문을 한 입력칸에서 찾는다.
//   결과 클릭 시 회원/주문 소유자는 Customer360 드로어로 직행(통화 1건 = 1동작),
//   소유자 없는 게스트 주문은 주문 관리 탭으로 폴백한다.
//   검색 자체는 lib/admin-search 의 순수 함수(searchAdmin)에 위임한다.

import { useEffect, useMemo, useRef, useState } from "react";
import {
  searchAdmin,
  type AdminSearchMember,
  type AdminSearchOrder,
} from "@/lib/admin-search";

type Props = {
  members: AdminSearchMember[];
  orders: AdminSearchOrder[];
  // 회원(또는 주문 소유자)의 360 드로어 열기.
  onOpenMember: (userId: string) => void;
  // 소유자 없는 게스트 주문 → 주문 관리 탭에서 표시.
  onOpenGuestOrder: (orderNo: string) => void;
};

export function AdminGlobalSearch({ members, orders, onOpenMember, onOpenGuestOrder }: Props) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // 바깥 클릭 시 닫기.
  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const result = useMemo(
    () => searchAdmin(query, { members, orders }),
    [query, members, orders]
  );
  const hasHits = result.members.length > 0 || result.orders.length > 0;
  const showPanel = open && query.trim().length > 0;

  function reset() {
    setQuery("");
    setOpen(false);
  }

  function pickMember(userId: string) {
    onOpenMember(userId);
    reset();
  }

  function pickOrder(orderNo: string, userId: string | null) {
    if (userId) onOpenMember(userId);
    else onOpenGuestOrder(orderNo);
    reset();
  }

  return (
    <div ref={boxRef} className="relative w-full max-w-md no-print">
      <input
        type="search"
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={() => setOpen(true)}
        placeholder="회원·주문 통합 검색 (이름·전화·주문번호·입금자)"
        className="w-full rounded-full border border-line bg-paper px-4 py-2 text-[14px] text-ink placeholder:text-mute focus:border-gold focus:outline-none"
        aria-label="전역 검색"
      />

      {showPanel && (
        <div className="absolute z-30 mt-1.5 w-full overflow-hidden rounded-2xl border border-line bg-paper shadow-lg">
          {!hasHits && (
            <p className="px-4 py-3 text-[13px] text-mute">검색 결과가 없습니다.</p>
          )}

          {result.members.length > 0 && (
            <div className="border-b border-line/60 py-1.5">
              <p className="px-4 py-1 text-[11px] font-medium uppercase tracking-wide text-mute">
                회원 ({result.members.length})
              </p>
              {result.members.map((m) => (
                <button
                  key={`m-${m.userId}`}
                  onClick={() => pickMember(m.userId)}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-[14px] hover:bg-cream"
                >
                  <span className="font-medium text-ink">{m.name || "이름없음"}</span>
                  <span className="tabular-nums text-mute">{m.phone}</span>
                  {m.address && (
                    <span className="truncate text-[12px] text-mute">· {m.address}</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {result.orders.length > 0 && (
            <div className="py-1.5">
              <p className="px-4 py-1 text-[11px] font-medium uppercase tracking-wide text-mute">
                주문 ({result.orders.length})
              </p>
              {result.orders.map((o) => (
                <button
                  key={`o-${o.orderNo}`}
                  onClick={() => pickOrder(o.orderNo, o.userId)}
                  className="flex w-full items-center gap-2 px-4 py-2 text-left text-[14px] hover:bg-cream"
                >
                  <span className="tabular-nums font-medium text-ink">{o.orderNo}</span>
                  <span className="text-ink-soft">{o.name || "—"}</span>
                  <span className="rounded-full bg-cream px-2 py-0.5 text-[12px] text-ink-soft">
                    {o.status}
                  </span>
                  {!o.userId && (
                    <span className="text-[11px] text-mute">게스트</span>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

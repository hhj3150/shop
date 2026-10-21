// 단체문자 수신자 집합(순수 함수, SSOT 위임).
//
//   [왜 이 파일이 생겼나 — 2026-10-22 실사고]
//     단체문자의 '요일 배송' 필터는 `slot.status === '활성'` 만 봤다. 그런데 슬롯 상태는
//     결제 회차를 다 쓴 뒤에도 '활성'으로 남아 있다(종료로 내려 주는 자동 처리가 없다).
//     그래서 수·목·금 필터를 켜면 활성 슬롯 30개 중 16개 — 7월·8월·9월에 이미 끝난
//     구독자까지 — 수신자로 잡혔다. 사장님이 10/21~23 미배송 안내를 보내려다 발견했다.
//     구독이 끝난 손님에게 "이번 회차는 10/26 에 발송해 드립니다" 가 갈 뻔했다.
//
//   [고치는 방법 — 명단을 다시 만들지 않는다]
//     '그 요일에 실제로 우유를 받는 사람'은 이미 배송 명단(buildRosterForDate)이 안다.
//     해지·회차 소진·정지·미결제 블록 제외가 전부 거기 들어 있고, 배송 탭·배송 시트·
//     생산 계획·발송 예고가 모두 그 한 함수를 쓴다. 여기서 판정을 새로 짜면 또 갈라진다.
//     → 앞으로 7일치 명단을 그대로 읽어 요일별 수신자를 만든다. 정의상 배송 명단과
//       절대 어긋날 수 없다.
//
//   ※ 7일이면 월~금이 정확히 한 번씩 들어온다(주간 cadence). 공휴일·휴무로 발송일이
//     밀린 회차도 명단이 그 날짜에 내보내므로 요일 집합에 그대로 잡힌다.

import type { DeliveryDay } from "./cart";
import { DELIVERY_DAYS } from "./cart";
import { toISODate } from "./ship-date";

/** 로스터 한 건에서 수신자 판정에 쓰는 최소 필드. */
export type AudienceEntry = {
  kind: "정기" | "단품";
  day: DeliveryDay | null;
  order: { user_id?: string | null };
};

/** 슬롯에서 수신자 판정에 쓰는 최소 필드. */
export type AudienceSlotFields = {
  user_id: string;
  status: string;
  paused?: boolean | null;
};

export type BroadcastAudience = {
  /** 배송요일 → 그 요일에 실제로 받는 회원 id. */
  dayUserIds: Map<DeliveryDay, Set<string>>;
  /** 아직 받을 회차가 남은 구독 회원 id(정지 중도 포함 — 연락은 닿아야 한다). */
  activeUserIds: Set<string>;
};

/** 'YYYY-MM-DD' 에 n일을 더한다. */
function addDaysISO(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

export function buildBroadcastAudience(params: {
  todayISO: string;
  /** 날짜별 배송 명단 — 관리자 화면의 rosterForDate(buildRosterForDate) 를 그대로 넘긴다. */
  rosterForDate: (iso: string) => readonly AudienceEntry[];
  slots: readonly AudienceSlotFields[];
}): BroadcastAudience {
  const { todayISO, rosterForDate, slots } = params;

  const dayUserIds = new Map<DeliveryDay, Set<string>>();
  for (const d of DELIVERY_DAYS) dayUserIds.set(d, new Set());
  const activeUserIds = new Set<string>();

  for (let i = 0; i < 7; i++) {
    for (const e of rosterForDate(addDaysISO(todayISO, i))) {
      // 단품은 구독 요일이 없다 — 요일 필터의 대상이 아니다.
      if (e.kind !== "정기" || !e.day) continue;
      const uid = e.order.user_id;
      if (!uid) continue;
      dayUserIds.get(e.day)?.add(uid);
      activeUserIds.add(uid);
    }
  }

  // 정지 중인 구독은 명단에서 빠진다(그 주에 안 나간다). 하지만 구독은 살아 있으므로
  //   '활성 구독자' 로는 닿아야 한다 — 재개 안내를 보낼 수 없으면 곤란하다.
  //   ※ 요일 필터에는 넣지 않는다. 그 요일에 '실제로 받는 사람' 이 아니기 때문이다.
  for (const s of slots) {
    if (s.status === "활성" && s.paused) activeUserIds.add(s.user_id);
  }

  return { dayUserIds, activeUserIds };
}

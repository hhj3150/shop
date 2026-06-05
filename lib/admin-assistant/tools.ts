// 관리자 AI 비서가 호출할 수 있는 '도구' 정의(OpenAI function-calling 스키마) + 디스패처.
//   모든 도구는 읽기 전용이며, 실제 숫자는 queries.ts 순수 함수로만 계산한다(AI 환각 차단).
//   데이터(orders/items/slots)는 라우트가 관리자 권한으로 조회해 dispatchTool 에 넘긴다.

import {
  deliveryRoster,
  productionDemand,
  salesSummary,
  findOrders,
  recruitmentStatus,
  DAY_LABEL,
  type OrderLite,
  type ItemLite,
  type SlotLite,
} from "./queries";

export type AdminData = {
  orders: OrderLite[];
  items: ItemLite[];
  slots: SlotLite[];
};

// OpenAI tools 스키마(function calling). 날짜는 YYYY-MM-DD.
export const TOOLS = [
  {
    type: "function",
    function: {
      name: "get_delivery_roster",
      description: "특정 날짜 또는 기간의 배송 명단(받는 분·주소·제품·상태)을 날짜별로 반환. '오늘 배송지' 같은 질문에 사용.",
      parameters: {
        type: "object",
        properties: {
          date_from: { type: "string", description: "시작일 YYYY-MM-DD" },
          date_to: { type: "string", description: "종료일 YYYY-MM-DD (생략 시 시작일과 동일)" },
        },
        required: ["date_from"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_production_demand",
      description: "특정 날짜 또는 기간에 필요한 제품별 생산 수량을 반환. '오늘 생산량' 같은 질문에 사용.",
      parameters: {
        type: "object",
        properties: {
          date_from: { type: "string", description: "시작일 YYYY-MM-DD" },
          date_to: { type: "string", description: "종료일 YYYY-MM-DD (생략 시 시작일과 동일)" },
        },
        required: ["date_from"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_sales_summary",
      description: "기간 내 확정(입금확인 이후) 주문의 건수와 매출 합계를 반환.",
      parameters: {
        type: "object",
        properties: {
          date_from: { type: "string", description: "시작일 YYYY-MM-DD" },
          date_to: { type: "string", description: "종료일 YYYY-MM-DD (생략 시 시작일과 동일)" },
        },
        required: ["date_from"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "find_orders",
      description: "이름·입금자·주문번호·연락처로 주문을 검색하거나, 상태로 필터해 목록을 반환.",
      parameters: {
        type: "object",
        properties: {
          query: { type: "string", description: "이름·주문번호·연락처 등 검색어" },
          status: { type: "string", description: "상태 필터(예: 입금대기, 입금확인, 배송중)" },
          limit: { type: "number", description: "최대 건수(기본 20)" },
        },
      },
    },
  },
  {
    type: "function",
    function: {
      name: "get_recruitment_status",
      description: "요일별 정기구독 모집현황(정원 100명 대비 신청·활성 수)과 대기자 수를 반환.",
      parameters: { type: "object", properties: {} },
    },
  },
] as const;

export function buildSystemPrompt(todayISO: string, mondayISO: string, fridayISO: string): string {
  return [
    "당신은 송영신목장(A2 저지 헤이밀크) 관리자를 돕는 한국어 비서입니다.",
    "관리자의 질문에 제공된 도구로 실제 데이터를 조회해 간결하고 정확하게 답하세요.",
    `오늘은 ${todayISO} 입니다. 이번 주 배송 가능일(월~금)은 ${mondayISO} ~ ${fridayISO} 입니다.`,
    "‘오늘’은 오늘 날짜로, ‘이번 주’는 위 월~금 범위로 도구를 호출하세요.",
    "규칙:",
    "- 숫자·명단은 반드시 도구 결과만 사용하고, 추측하거나 지어내지 마세요.",
    "- 당신은 읽기 전용입니다. 주문 상태 변경·환불·발송 등 실행은 하지 말고, 필요하면 ‘관리자 화면에서 직접 처리하세요’라고 안내하세요.",
    "- 답은 핵심부터, 표·목록으로 보기 쉽게. 건수·합계를 먼저 말하세요.",
    "- 개인정보(주소·연락처)는 관리자에게만 보이므로 그대로 답해도 됩니다.",
  ].join("\n");
}

// 도구 실행 — 이름/인자에 맞는 순수 함수를 데이터 위에서 호출해 JSON 반환.
export function dispatchTool(name: string, args: Record<string, unknown>, data: AdminData): unknown {
  const from = typeof args.date_from === "string" ? args.date_from : "";
  const to = typeof args.date_to === "string" && args.date_to ? args.date_to : from;

  switch (name) {
    case "get_delivery_roster": {
      const days = deliveryRoster(data.orders, data.items, data.slots, from, to);
      const totalRows = days.reduce((n, d) => n + d.rows.length, 0);
      return { from, to, total_count: totalRows, days };
    }
    case "get_production_demand": {
      const r = productionDemand(data.orders, data.items, data.slots, from, to);
      return { from, to, total: r.total, by_date: r.byDate };
    }
    case "get_sales_summary":
      return { from, to, ...salesSummary(data.orders, from, to) };
    case "find_orders":
      return {
        orders: findOrders(data.orders, {
          query: typeof args.query === "string" ? args.query : undefined,
          status: typeof args.status === "string" ? args.status : undefined,
          limit: typeof args.limit === "number" ? args.limit : undefined,
        }),
      };
    case "get_recruitment_status": {
      const r = recruitmentStatus(data.slots);
      const byDay = Object.fromEntries(
        (Object.keys(r.byDay) as Array<keyof typeof r.byDay>).map((d) => [`${DAY_LABEL[d]}요일`, r.byDay[d]])
      );
      return { 정원: 100, 요일별_신청활성: byDay, 대기자: r.waitlist };
    }
    default:
      return { error: `unknown_tool:${name}` };
  }
}

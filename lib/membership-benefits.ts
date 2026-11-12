import { BASE_DISCOUNT, PERIOD_LABEL, SUB_PERIODS, SUB_TOTAL_CAP, discountRangeLabel } from "./products";

// 신청 결정 지점(가입 폼)에서 다시 보여줄 회원 혜택 카피.
// 숫자(할인율·정원)는 lib/products.ts SSOT에서만 파생해 표기 드리프트를 막는다.

export type MembershipBenefit = { title: string; desc: string };

export function memberDiscountPercent(rate: number = BASE_DISCOUNT): number {
  return Math.round(rate * 100);
}

export function buildMembershipBenefits(): readonly MembershipBenefit[] {
  return [
    {
      // 할인율은 기간에 따라 달라진다(4주 10% ~ 24주 20%). '상시 10%' 한 숫자로 적으면
      //   긴 기간을 고른 손님에게는 실제보다 적게 약속하는 셈이 된다 — 범위로 적는다.
      title: `회원 ${discountRangeLabel()}% 할인`,
      desc: "창립 회원께는 첫 병부터 회원가로 모십니다. 기간이 길수록 할인이 커집니다.",
    },
    {
      // 신선도 문구는 FAQ('우유가 얼마나 신선한가요?')·홈·/story 와 같은 사실만 쓴다 — 아침 착유,
      //   그날 가공, 다음 날 콜드체인 택배 발송. ('새벽'·'직배송'·'어디도 거치지 않고'는 사실과 달랐다.)
      title: "아침에 짜서, 다음 날 발송",
      desc: "아침에 짠 원유를 그날 가공해, 다음 날 콜드체인 냉장 택배로 보내 드립니다.",
    },
    {
      // 해지·환불은 이용약관 제7조와 같게 — 배송 시작 후에도 언제든 해지, 미배송 회차분 환불.
      title: `${PERIOD_LABEL[SUB_PERIODS[0]]}부터 가볍게`,
      desc: `${SUB_PERIODS.map((m) => PERIOD_LABEL[m]).join("·")} 중 고르시고, 언제든 해지할 수 있습니다. 아직 배송되지 않은 회차분은 환불해 드립니다.`,
    },
    {
      title: `선착순 ${SUB_TOTAL_CAP}인 한정`,
      desc: "자리가 차면 대기 순으로 모시고, 빈자리가 나면 가장 먼저 안내드립니다.",
    },
  ] as const;
}

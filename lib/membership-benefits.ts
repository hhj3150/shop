import { BASE_DISCOUNT, SUB_TOTAL_CAP } from "./products";

// 신청 결정 지점(가입 폼)에서 다시 보여줄 회원 혜택 카피.
// 숫자(할인율·정원)는 lib/products.ts SSOT에서만 파생해 표기 드리프트를 막는다.

export type MembershipBenefit = { title: string; desc: string };

export function memberDiscountPercent(rate: number = BASE_DISCOUNT): number {
  return Math.round(rate * 100);
}

export function buildMembershipBenefits(): readonly MembershipBenefit[] {
  return [
    {
      title: `회원 상시 ${memberDiscountPercent()}% 할인`,
      desc: "창립 회원께는 첫 병부터 늘 회원가로 모십니다.",
    },
    {
      title: "갓 짠 우유, 콜드체인 직배송",
      desc: "그날 새벽 짜낸 한 병이 어디도 거치지 않고 문 앞에 닿습니다.",
    },
    {
      title: "월 단위로 가볍게",
      desc: "한 달씩 부담 없이. 입금 전 취소는 전액 환불됩니다.",
    },
    {
      title: `선착순 ${SUB_TOTAL_CAP}인 한정`,
      desc: "자리가 차면 대기 순으로 모시고, 빈자리가 나면 가장 먼저 안내드립니다.",
    },
  ] as const;
}

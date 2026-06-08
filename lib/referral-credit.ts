// 추천 적립금(쿠폰) 순수 계산. 쿠폰 1장 = 5,000원. React/Supabase 비의존 — 단위 테스트 대상.
//   잔액·차감 규칙의 단일 출처. SQL(apply_referral_credit)과 동일 규칙을 유지한다.
export const COUPON_KRW = 5000;

// 잔액 계산에 필요한 적립건의 최소 형태(referral_rewards 부분집합).
export type RewardLite = {
  amount_krw: number;
  status: string; // 'earned' | 'applied' | 'void'
  expires_at: string | null;
};

// 유효 잔액 = status='earned' 이고 아직 만료되지 않은(만료일 > now) 적립건. 만료 경계(==)는 만료로 본다.
export function usableBalance(
  rewards: RewardLite[],
  nowISO: string
): { count: number; krw: number } {
  const now = new Date(nowISO).getTime();
  let count = 0;
  for (const r of rewards) {
    if (r.status !== "earned") continue;
    if (r.expires_at !== null && new Date(r.expires_at).getTime() <= now) continue;
    count += 1;
  }
  return { count, krw: count * COUPON_KRW };
}

// 입금액 한도 내에서 5,000원 단위로 차감할 쿠폰 수를 계산한다(쿠폰을 쪼개지 않음).
//   useCount = min(보유 유효 장수, floor(입금액 / 5000)). payable 은 항상 0 이상.
export function redeemableCoupons(input: {
  availableCount: number;
  orderTotal: number;
}): { useCount: number; creditKrw: number; payable: number } {
  const fit = Math.floor(Math.max(0, input.orderTotal) / COUPON_KRW);
  const useCount = Math.max(0, Math.min(input.availableCount, fit));
  const creditKrw = useCount * COUPON_KRW;
  return { useCount, creditKrw, payable: input.orderTotal - creditKrw };
}

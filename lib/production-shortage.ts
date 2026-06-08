// 생산 부족 판정 — 저장 직전 "실제생산 < 총 필요량"인 제품을 골라낸다.
//   관리자가 결품(부족)을 못 보고 저장하는 실수를 막기 위한 순수 함수(UI 확인용).
export type ProductionShortage = {
  key: string;
  required: number;
  produced: number;
  short: number; // 부족 수량(양수)
};

// 필요량이 있는 제품 중 실제생산이 모자란 것만 반환. 누락된 키는 0으로 본다.
export function productionShortages(
  keys: readonly string[],
  required: Readonly<Record<string, number>>,
  produced: Readonly<Record<string, number>>
): ProductionShortage[] {
  return keys
    .map((key) => {
      const req = required[key] ?? 0;
      const prod = produced[key] ?? 0;
      return { key, required: req, produced: prod, short: req - prod };
    })
    .filter((r) => r.required > 0 && r.short > 0);
}

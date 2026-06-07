// 발송명단 제품 칸 분류 — 우유180/우유750/요거트180/요거트500 4칸.
//   4칸에 매핑되지 않는 제품은 -1(미분류). 미분류 품목은 발송명단 수량·총합에서
//   빠지므로, findUnmappedKeys 로 감지해 화면에 경고를 띄운다(조용한 누락 방지).

// 4개 제품 칸의 용량(mL) — 총 L량 계산용. 순서: 우유180·우유750·요거트180·요거트500.
export const BUCKET_ML = [180, 750, 180, 500] as const;
export const BUCKET_LABEL = ["우유180", "우유750", "요거트180", "요거트500"] as const;

// 제품을 4개 칸으로 분리: 우유180(0)/우유750(1)/요거트180(2)/요거트500(3). 그 외 -1.
export function productBucket(name: string, volume: string): number {
  const yog = name.includes("요거트");
  const v = volume.replace(/[^0-9]/g, "");
  if (yog && v === "180") return 2;
  if (yog && v === "500") return 3;
  if (!yog && v === "180") return 0;
  if (!yog && v === "750") return 1;
  return -1;
}

// 4칸에 매핑되지 않아 발송명단 합계에서 빠지는 품목 키("제품명 용량") 목록.
//   qty>0 인 것만, 정렬·중복제거.
export function findUnmappedKeys(
  items: readonly { product_name: string; volume: string; qty: number }[]
): string[] {
  const keys = new Set<string>();
  for (const it of items) {
    if (it.qty <= 0) continue;
    if (productBucket(it.product_name, it.volume) < 0) {
      keys.add(`${it.product_name} ${it.volume}`);
    }
  }
  return Array.from(keys).sort((a, b) => a.localeCompare(b, "ko"));
}

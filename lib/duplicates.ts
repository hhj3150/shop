// 중복 탐지 — 같은 키를 가진 항목이 2개 이상이면 '중복'으로 본다.
//   관리자가 중복 가입·중복 주문을 못 보고 이중 발송/이중 정산하는 실수를 막기 위한
//   경고용 순수 함수(표시만, 데이터 변경 없음).

// 전화번호 정규화 — 숫자만 남긴다(하이픈/공백/표기 차이를 흡수). 9자리 미만은 null(판정 제외).
export function normalizePhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, "");
  return digits.length >= 9 ? digits : null;
}

// 키가 같은 항목이 2개 이상이면 그 항목들의 id를 모두 담은 Set 을 반환.
//   keyOf 가 null 을 주면 그 항목은 판정에서 제외한다(서로 묶지 않음).
export function duplicateIds<T>(
  items: readonly T[],
  idOf: (x: T) => string,
  keyOf: (x: T) => string | null
): Set<string> {
  const byKey = new Map<string, string[]>();
  for (const x of items) {
    const key = keyOf(x);
    if (!key) continue;
    const ids = byKey.get(key) ?? [];
    byKey.set(key, [...ids, idOf(x)]);
  }
  const dup = new Set<string>();
  for (const ids of byKey.values()) {
    if (ids.length >= 2) for (const id of ids) dup.add(id);
  }
  return dup;
}

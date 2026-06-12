// 전화번호 정규화 — 클라/서버 공용(서버전용 모듈 비의존).
//   payaction.ts 의 기존 로직과 동일: 비숫자 제거 후 '82' 국가코드는 '0' 으로 치환.
export function normalizePhone(raw: string | null | undefined): string {
  if (!raw) return "";
  const digits = raw.replace(/\D/g, "");
  return digits.startsWith("82") ? "0" + digits.slice(2) : digits;
}

// 정규화 후 앞 7자리(010+중간4). 마스킹 매칭 키. 7자리 미만이면 무효(빈문자).
export function phone7(raw: string | null | undefined): string {
  const d = normalizePhone(raw);
  return d.length >= 7 ? d.slice(0, 7) : "";
}

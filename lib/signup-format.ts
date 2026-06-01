// 입력 보조용 순수 포맷터. 휴대폰 번호를 010-XXXX-XXXX 형태로 점진 하이픈 처리한다.
// 숫자만 남기고 최대 11자리로 자른 뒤 3-4-4로 끊는다(입력 중 부분 문자열도 안전).
export function formatPhoneKR(raw: string): string {
  const digits = raw.replace(/\D/g, "").slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

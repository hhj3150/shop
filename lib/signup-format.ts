import { normalizePhone } from "./phone";

// 입력 보조용 순수 포맷터. 휴대폰 번호를 010-XXXX-XXXX 형태로 점진 하이픈 처리한다.
// 숫자만 남기고 최대 11자리로 자른 뒤 3-4-4로 끊는다(입력 중 부분 문자열도 안전).
//
// ★ 국가번호(+82)를 먼저 0으로 정규화한다(normalizePhone). 이 정규화 없이 숫자만
//   뽑아 11자리로 자르면 '+82 10-6205-3150'(82106205315 0 — 12자리)이 앞에서부터
//   잘려 끝자리가 사라진다(82106205315 → 821-0620-5315, 마지막 0 유실). 82를 0으로
//   바꾼 뒤 자르면 01062053150 → 010-6205-3150 으로 온전히 표시된다.
export function formatPhoneKR(raw: string): string {
  const digits = normalizePhone(raw).slice(0, 11);
  if (digits.length <= 3) return digits;
  if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
  return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
}

// 리퍼럴(친구 추천) — 순수 유틸: 코드 정규화·검증·공유 링크·URL 추출.
//   코드 발급(고유성)·보상 기록은 서버(SQL RPC/트리거)가 담당한다.

// 추천 보상(추천인·피추천인 각각). 단일 출처 — 조정 시 SQL referral_reward_amount() 와 동기화.
export const REFERRAL_REWARD_KRW = 5000;

// 코드 형식: 8자리, 대문자 A-Z + 숫자 2-9 중 혼동 문자(0,O,1,I,L) 제외.
const CODE_LEN = 8;
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // 0·O·1·I·L 제외
const CODE_RE = new RegExp(`^[${CODE_ALPHABET}]{${CODE_LEN}}$`);

// 입력에서 코드만 정규화: 영숫자 외 제거 + 대문자화. 형식 위반이면 null.
export function normalizeReferralCode(
  input: string | null | undefined
): string | null {
  if (!input) return null;
  const c = String(input).toUpperCase().replace(/[^A-Z0-9]/g, "");
  return CODE_RE.test(c) ? c : null;
}

export function isValidReferralCode(input: string | null | undefined): boolean {
  return normalizeReferralCode(input) !== null;
}

// 공유 링크(origin 끝 슬래시 정리). 코드가 유효하지 않으면 null.
export function referralLink(
  code: string | null | undefined,
  origin: string | null | undefined
): string | null {
  const c = normalizeReferralCode(code);
  if (!c) return null;
  const base = String(origin ?? "").replace(/\/+$/, "");
  return `${base}/?ref=${c}`;
}

// URL/쿼리스트링에서 ref 코드를 추출해 정규화. 없거나 형식 위반이면 null.
export function extractRefCode(
  urlOrSearch: string | null | undefined
): string | null {
  if (!urlOrSearch) return null;
  const m = String(urlOrSearch).match(/[?&]ref=([^&#\s]+)/i);
  if (!m) return null;
  let raw = m[1];
  try {
    raw = decodeURIComponent(raw);
  } catch {
    // 잘못된 인코딩은 원문 그대로 검증
  }
  return normalizeReferralCode(raw);
}

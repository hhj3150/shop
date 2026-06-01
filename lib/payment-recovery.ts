// 가입 이탈 복구 — 미입금 리마인드/자동취소 판정·메시지 조립 (순수 함수, I/O 없음).
// import는 Netlify 번들러(esbuild) 호환을 위해 상대경로만 사용.
import { DEPOSIT } from "./site";
import { depositAmountDigits } from "./deposit-guidance";

const SHOP = "송영신목장";

export type RecoveryTarget = {
  orderId: string;
  createdAt: string; // DB timestamptz ISO 문자열
  shipName: string;
  shipPhone: string;
  orderNo: string;
  totalAmount: number;
  hasSubscription: boolean;
  sentStages: string[]; // 이미 발송한 단계 (예: ["D1"])
};

export type RecoveryAction = "D1" | "D2" | "EXPIRE" | "none";

// 한 시각을 KST 달력일(UTC epoch로 정규화)로 변환. KST는 DST 없는 UTC+9.
function kstDayEpoch(d: Date): number {
  const k = new Date(d.getTime() + 9 * 60 * 60 * 1000);
  return Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate());
}

export function kstDaysElapsed(createdAtIso: string, now: Date): number {
  const created = kstDayEpoch(new Date(createdAtIso));
  const today = kstDayEpoch(now);
  return Math.round((today - created) / 86_400_000);
}

export function decideAction(t: RecoveryTarget, now: Date): RecoveryAction {
  const days = kstDaysElapsed(t.createdAt, now);
  if (days >= 3) return "EXPIRE";
  if (days === 2) return t.sentStages.includes("D2") ? "none" : "D2";
  if (days === 1) return t.sentStages.includes("D1") ? "none" : "D1";
  return "none";
}

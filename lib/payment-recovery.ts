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

export type RecoveryMessage = {
  templateKey: "PAYMENT_GUIDE" | "PAYMENT_DEADLINE";
  variables: Record<string, string>;
  subject: string;
  text: string; // 알림톡 실패 시 LMS 폴백 본문
};

function accountLine(): string {
  return `${DEPOSIT.bank} ${DEPOSIT.account} (예금주 ${DEPOSIT.holder})`;
}

// created + 3일을 "M월 D일"(KST)로 포맷.
function deadlineLabel(createdAtIso: string): string {
  const k = new Date(
    new Date(createdAtIso).getTime() + 9 * 60 * 60 * 1000 + 3 * 86_400_000,
  );
  return `${k.getUTCMonth() + 1}월 ${k.getUTCDate()}일`;
}

export function buildRecoveryMessage(
  t: RecoveryTarget,
  action: "D1" | "D2",
): RecoveryMessage {
  const amount = depositAmountDigits(t.totalAmount);
  const account = accountLine();
  if (action === "D1") {
    return {
      templateKey: "PAYMENT_GUIDE",
      variables: {
        "#{고객명}": t.shipName,
        "#{주문번호}": t.orderNo,
        "#{금액}": amount,
        "#{입금계좌}": account,
      },
      subject: `[${SHOP}] 입금 안내 다시 드립니다`,
      text:
        `[${SHOP}] ${t.shipName}님, 주문(${t.orderNo}) 입금을 다시 안내드립니다.\n` +
        `입금하실 금액 ${amount}원\n${account}\n` +
        `입금이 확인되면 바로 준비해 드리겠습니다.`,
    };
  }
  const deadline = deadlineLabel(t.createdAt);
  return {
    templateKey: "PAYMENT_DEADLINE",
    variables: {
      "#{고객명}": t.shipName,
      "#{주문번호}": t.orderNo,
      "#{금액}": amount,
      "#{마감일}": deadline,
    },
    subject: `[${SHOP}] 입금 마감 임박 안내`,
    text:
      `[${SHOP}] ${t.shipName}님, 주문(${t.orderNo}) 입금이 아직 확인되지 않았습니다.\n` +
      `${deadline}까지 입금이 없으면 자동 취소되어 자리가 반환됩니다.\n` +
      `입금하실 금액 ${amount}원\n${account}`,
  };
}

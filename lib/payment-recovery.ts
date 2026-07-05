// 가입 이탈 복구 — 미입금 리마인드 판정·메시지 조립 (순수 함수, I/O 없음).
// import는 Netlify 번들러(esbuild) 호환을 위해 상대경로만 사용.
//
// ⚠ 자동취소 없음(2026-07 클레임 후 정책): 입금자명이 달라 자동매칭이 안 된 주문이
//   D+3 자동취소되며 고객에게 취소 문자가 바로 나가 항의를 받았다. 이후로 시스템은
//   주문을 임의로 취소하지 않는다. D+3부터는 관리자에게 '확인 필요' 문자만 보내고,
//   취소(+고객 취소 안내 문자)는 관리자가 관리자 페이지에서 직접 처리할 때만 나간다.
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

export type RecoveryAction = "D1" | "D2" | "OVERDUE_NOTICE" | "none";

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
  // D+3 이상: 매일 관리자에게 '확인 필요'로 올린다(해결될 때까지 — 원장 기록 없음).
  //   자동취소는 하지 않는다. 관리자가 입금확인 또는 취소 처리하면 '입금대기'를
  //   벗어나 대상에서 빠지므로 알림도 자연히 멈춘다.
  if (days >= 3) return "OVERDUE_NOTICE";
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
      `${deadline}까지 입금이 확인되지 않으면 주문이 취소될 수 있습니다.\n` +
      `이미 입금하셨다면(입금자명이 다른 경우 등) 문의 주세요. 바로 확인해 드리겠습니다.\n` +
      `입금하실 금액 ${amount}원\n${account}`,
  };
}

// D+3 경과 미입금 주문을 관리자에게 '확인 필요'로 보고(매일, 해결될 때까지).
//   시스템은 여기서 멈춘다 — 취소 여부 판단과 취소 문자 발송은 관리자의 몫.
//   입금자명이 주문자와 달라 자동매칭이 안 된 '실제 입금' 건을 사람이 걸러내는 관문.
export function buildOverdueNoticeMessage(
  targets: RecoveryTarget[],
): { subject: string; text: string } {
  const lines = targets.map((t) => {
    const amount = t.totalAmount.toLocaleString("ko-KR");
    const phone = t.shipPhone || "연락처없음";
    return `- ${t.shipName} ${t.orderNo} ${amount}원 (${phone})`;
  });
  return {
    subject: `[${SHOP}] 미입금 확인 필요 ${targets.length}건`,
    text:
      `[${SHOP}] 미입금 3일 경과 주문 ${targets.length}건 — 확인이 필요합니다.\n` +
      `${lines.join("\n")}\n` +
      `입금자명이 달라 자동확인이 안 됐을 수 있습니다. 통장 입금내역을 확인해 주세요.\n` +
      `입금됐으면 관리자 페이지에서 '입금확인', 미입금이 맞으면 '취소' 처리해 주세요.\n` +
      `(취소 처리 시에만 고객에게 취소 안내 문자가 발송됩니다. 시스템이 임의로 취소하지 않습니다.)`,
  };
}

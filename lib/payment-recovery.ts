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

// ★ 자동취소 폐지(2026-07-05 실사고): 입금자명이 회원명과 달라 자동매칭이 안 된 주문이
//   D+3 자동취소되며 '자동 취소되었습니다' 문자가 나가 클레임 발생 — 고객은 이미 입금한
//   상태였다. 시스템이 모르는 입금(입금자명 불일치 등)이 있는 한 취소·취소 문자를 기계가
//   결정하면 안 된다. D+3 은 관리자 알림(EXPIRE_NOTIFY)만 보내고, 취소는 관리자가
//   사실확인 후 수동으로 한다(그때만 취소 문자 발송 — updateStatus → order_cancelled).
export type RecoveryAction = "D1" | "D2" | "EXPIRE_NOTIFY" | "none";

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

// 주문 후 실제 경과 시간(시간 단위).
function hoursElapsed(createdAtIso: string, now: Date): number {
  return (now.getTime() - new Date(createdAtIso).getTime()) / 3_600_000;
}

// ★ 독촉 시점을 '달력일'이 아니라 '경과 시간'으로 잰다.
//   달력일 기준이면 밤늦게 들어온 주문이 다음 날 아침 크론에 걸려 9시간 만에 독촉을 받았다
//   (실사례: 21:04 주문 → 다음날 09:08 D1). 최소 12시간은 기다린다.
//   단계 간격은 종전과 같은 하루(24시간)를 유지한다 — 12h 이후 D1, 36h 이후 D2, 60h 이후 관리자 알림.
//   크론이 하루 한 번(09:00 KST) 도므로, 밤 9시 이후 주문만 하루씩 밀리고 나머지는 종전과 같다.
export const RECOVERY_MIN_HOURS = 12;
const STAGE_GAP_HOURS = 24;

export function decideAction(t: RecoveryTarget, now: Date): RecoveryAction {
  const h = hoursElapsed(t.createdAt, now);
  if (h >= RECOVERY_MIN_HOURS + STAGE_GAP_HOURS * 2) {
    return t.sentStages.includes("EXPIRE_NOTIFY") ? "none" : "EXPIRE_NOTIFY";
  }
  if (h >= RECOVERY_MIN_HOURS + STAGE_GAP_HOURS) {
    return t.sentStages.includes("D2") ? "none" : "D2";
  }
  if (h >= RECOVERY_MIN_HOURS) {
    return t.sentStages.includes("D1") ? "none" : "D1";
  }
  return "none";
}

export type RecoveryMessage = {
  // 알림톡 템플릿. 없으면 LMS 로만 발송한다 — D2 는 구 템플릿(PAYMENT_DEADLINE)에
  //   '자동취소' 문구가 들어 있어 쓰지 않는다(자동취소 폐지).
  templateKey?: "PAYMENT_GUIDE";
  variables?: Record<string, string>;
  subject: string;
  text: string; // 알림톡 실패(또는 미지정) 시 LMS 본문
};

function accountLine(): string {
  return `${DEPOSIT.bank} ${DEPOSIT.account} (예금주 ${DEPOSIT.holder})`;
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
  // D2: 자동취소 예고 대신 '입금자명 불일치' 케이스를 능동적으로 회수한다 —
  //   가족 명의 입금 등으로 매칭이 안 된 고객이 스스로 알려올 수 있게.
  return {
    subject: `[${SHOP}] 입금 확인이 되지 않았습니다`,
    text:
      `[${SHOP}] ${t.shipName}님, 주문(${t.orderNo}) 입금이 아직 확인되지 않았습니다.\n` +
      `입금하실 금액 ${amount}원\n${account}\n` +
      `혹시 이미 입금하셨거나 주문자와 다른 이름으로 입금하셨다면, 입금자명을 회신해 주세요. 확인 후 바로 처리해 드리겠습니다. (고객센터 031-674-3150)`,
  };
}

// D+3 도달 시 '관리자에게만' 보내는 알림 본문. 고객에게는 아무 문자도 보내지 않는다.
//   취소 여부는 관리자가 통장·입금자명 사실확인 후 관리자 화면에서 직접 결정한다
//   (취소 확정 시에만 기존 경로로 취소 문자가 나간다).
export function buildExpireAdminAlertText(t: RecoveryTarget, daysElapsed: number): string {
  const amount = depositAmountDigits(t.totalAmount);
  return (
    `[${SHOP}] ⏰ 미입금 D+${daysElapsed} 확인 필요\n` +
    `주문 ${t.orderNo} · ${t.shipName} (${t.shipPhone || "연락처없음"})\n` +
    `금액 ${amount}원 · ${t.hasSubscription ? "정기구독" : "단품"}\n` +
    `입금자명이 다를 수 있으니 통장 확인 후, 관리자 화면에서 [입금확인] 또는 [취소]로 처리해 주세요. 자동취소·자동문자는 나가지 않습니다.`
  );
}

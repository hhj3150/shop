// 미입금 주문 확인 — 단계 판정 + 관리자 요약 문자 조립 (순수 함수, I/O 없음).
// import는 Netlify 번들러(esbuild) 호환을 위해 상대경로만 사용.
//
// ★ 고객 독촉 문자 폐지(2026-08-30, 사장님 결정)
//   미입금 안내를 손님에게 자동으로 보내지 않는다. 대신 관리자에게 '확인 필요' 목록을
//   보내고, 통장을 눈으로 확인한 뒤 사람이 처리한다.
//   이유: 입금자명이 다르거나(가족 명의) 이미 입금한 손님에게 기계가 독촉을 보내면
//   그 자체가 클레임이 된다. 실제로 안내 문자를 한 통도 못 받은 비회원이 독촉부터
//   받은 사례가 있었다(SY20260829-9912).

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
//   결정하면 안 된다. 취소는 관리자가 사실확인 후 수동으로 한다(그때만 취소 문자 발송 —
//   updateStatus → order_cancelled).
//
//   단계 이름(D1·D2·EXPIRE_NOTIFY)은 원장 호환을 위해 그대로 두지만, 이제 셋 다
//   '관리자에게 알릴 시점'일 뿐이다(12h·36h·60h). 손님에게는 어느 단계에서도 문자가
//   나가지 않는다. 한 주문은 최대 세 번 관리자 목록에 오른다.
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

// 관리자에게 보내는 '미입금 확인 필요' 요약 한 통.
//   여러 건이 같은 날 걸려도 문자는 한 통이다(줄 단위 목록).
export type UnpaidDigest = {
  subject: string;
  text: string;
};

// 한 줄에 담기는 미입금 건.
export type UnpaidItem = {
  target: RecoveryTarget;
  hoursElapsed: number;
};

const MAX_LINES = 15; // LMS 길이 보호. 넘치면 '외 N건'으로 접는다.

// 금액을 천 단위 쉼표로. 관리자가 통장 금액과 눈으로 맞추기 쉬운 표기.
function won(amount: number): string {
  return amount.toLocaleString("ko-KR");
}

// 경과 시간을 사람이 읽는 말로. 48시간 미만은 시간, 그 뒤는 일 단위.
function elapsedLabel(hours: number): string {
  if (hours < 48) return `${Math.floor(hours)}시간 경과`;
  return `${Math.floor(hours / 24)}일 경과`;
}

// 미입금 확인 요약. items 가 비면 null — 보낼 게 없으면 문자도 없다.
//   totalPending = 지금 입금대기인 주문 전체 건수(이번에 새로 걸린 것 외 포함).
export function buildUnpaidDigest(items: UnpaidItem[], totalPending: number): UnpaidDigest | null {
  if (items.length === 0) return null;
  const shown = items.slice(0, MAX_LINES);
  const rest = items.length - shown.length;
  const lines = shown.map((it) => {
    const t = it.target;
    return (
      `· ${t.orderNo} ${t.shipName || "이름없음"} ${won(t.totalAmount)}원 · ` +
      `${elapsedLabel(it.hoursElapsed)}${t.hasSubscription ? " (정기)" : ""}`
    );
  });
  if (rest > 0) lines.push(`· 외 ${rest}건`);
  const tail =
    totalPending > items.length ? `\n현재 입금대기 전체 ${totalPending}건.` : "";
  return {
    subject: `[${SHOP}] 미입금 확인 필요`,
    text:
      `[${SHOP}] 미입금 확인 필요 ${items.length}건\n` +
      `${lines.join("\n")}${tail}\n` +
      `통장·입금자명 확인 후 관리자 화면에서 [입금확인] 또는 [취소]로 처리해 주세요. ` +
      `손님에게는 독촉 문자가 나가지 않습니다.`,
  };
}

// 주문 후 경과 시간(시간). 요약 줄에 쓰려고 밖에서도 쓴다.
export function elapsedHours(createdAtIso: string, now: Date): number {
  return hoursElapsed(createdAtIso, now);
}

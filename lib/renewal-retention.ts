// 재구독 리텐션 — 만료 임박 단계 판정·메시지 조립 (순수 함수, I/O 없음).
// import는 Netlify 번들러(esbuild) 호환을 위해 상대경로만 사용.

const SHOP = "송영신목장";

export type RenewalTarget = {
  slotId: number;
  name: string;
  phone: string;
  expiryDate: string; // 'YYYY-MM-DD' (KST 달력일, RPC가 계산해 반환)
  sentStages: string[]; // 이미 발송한 단계 (예: ["D7"])
};

export type RenewalStage = "D7" | "D3" | "none";

// 'YYYY-MM-DD'(KST 만료일)와 현재시각으로 만료까지 남은 KST 달력일 수.
// KST는 DST 없는 UTC+9.
function kstDaysUntil(expiryDate: string, now: Date): number {
  const [y, m, d] = expiryDate.split("-").map(Number);
  const expiryEpoch = Date.UTC(y, m - 1, d);
  const k = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const todayEpoch = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate());
  return Math.round((expiryEpoch - todayEpoch) / 86_400_000);
}

// 상호배타 윈도우: d<=0 none, 1<=d<=3 D3, 4<=d<=7 D7. 단계별 dedup.
export function decideRenewalStage(
  expiryDate: string,
  now: Date,
  sentStages: string[],
): RenewalStage {
  const d = kstDaysUntil(expiryDate, now);
  if (d <= 0) return "none";
  if (d <= 3) return sentStages.includes("D3") ? "none" : "D3";
  if (d <= 7) return sentStages.includes("D7") ? "none" : "D7";
  return "none";
}

export type RenewalMessage = {
  templateKey: "EXPIRE_SOON";
  variables: Record<string, string>;
  subject: string;
  text: string; // 알림톡 실패 시 LMS 폴백 본문
};

// 'YYYY-MM-DD' → "M월 D일".
function expiryLabel(expiryDate: string): string {
  const [, m, d] = expiryDate.split("-").map(Number);
  return `${m}월 ${d}일`;
}

export function buildRenewalMessage(t: RenewalTarget): RenewalMessage {
  const label = expiryLabel(t.expiryDate);
  return {
    templateKey: "EXPIRE_SOON",
    variables: {
      "#{고객명}": t.name,
      "#{만료일}": label,
    },
    subject: `[${SHOP}] 구독 만료 안내`,
    text:
      `[${SHOP}] ${t.name}님, 정기구독이 ${label}에 만료됩니다.\n` +
      `계속 받아보시려면 마이페이지에서 재구독을 신청해 주세요.`,
  };
}

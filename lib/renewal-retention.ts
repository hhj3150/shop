// 재구독 리텐션 — 만료 임박 단계 판정·메시지 조립 (순수 함수, I/O 없음).
// import는 Netlify 번들러(esbuild) 호환을 위해 상대경로만 사용.
import { SITE_URL } from "./site";

const SHOP = "송영신목장";
// 재구독 신청 화면(마이페이지). 문자에서 바로 눌러 들어가도록 절대 URL 로 안내한다.
const RENEW_URL = `${SITE_URL}/account`;

export type RenewalTarget = {
  slotId: number;
  name: string;
  phone: string;
  expiryDate: string; // 'YYYY-MM-DD' (KST 달력일, RPC가 계산해 반환)
  sentStages: string[]; // 이미 발송한 단계 (예: ["D7"])
};

// END = 구독이 끝난 뒤(만료 다음날) 보내는 '종료 안내'. 예고(D7·D3)와 별개 단계다.
export type RenewalStage = "D7" | "D3" | "END" | "none";

// 'YYYY-MM-DD'(KST 만료일)와 현재시각으로 만료까지 남은 KST 달력일 수.
// KST는 DST 없는 UTC+9.
function kstDaysUntil(expiryDate: string, now: Date): number {
  const [y, m, d] = expiryDate.split("-").map(Number);
  const expiryEpoch = Date.UTC(y, m - 1, d);
  const k = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  const todayEpoch = Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate());
  return Math.round((expiryEpoch - todayEpoch) / 86_400_000);
}

// 상호배타 윈도우: -3<=d<=-1 END(종료 안내), d==0 none(마지막 배송 당일), 1<=d<=3 D3,
//   4<=d<=7 D7. 단계별 dedup.
//   · 만료 '당일'은 마지막 회차를 실제로 배송하는 날이라 종료 안내를 보내지 않는다
//     (그날 발송 문자가 "N회 중 마지막 N번째"로 알린다). 다음날 한 번만 종료를 알린다.
//   · 크론이 하루라도 걸렀을 때를 대비해 만료 후 3일까지는 뒤늦게라도 보낸다.
export function decideRenewalStage(
  expiryDate: string,
  now: Date,
  sentStages: string[],
): RenewalStage {
  const d = kstDaysUntil(expiryDate, now);
  if (d < 0) {
    if (d < -3) return "none"; // 너무 지난 건은 새삼 알리지 않는다(지난 문자 금지 원칙).
    return sentStages.includes("END") ? "none" : "END";
  }
  if (d === 0) return "none";
  if (d <= 3) return sentStages.includes("D3") ? "none" : "D3";
  if (d <= 7) return sentStages.includes("D7") ? "none" : "D7";
  return "none";
}

export type RenewalMessage = {
  templateKey: "EXPIRE_SOON" | "SUBSCRIPTION_ENDED";
  variables: Record<string, string>;
  subject: string;
  text: string; // 알림톡 실패 시 LMS 폴백 본문
};

// 'YYYY-MM-DD' → "M월 D일".
function expiryLabel(expiryDate: string): string {
  const [, m, d] = expiryDate.split("-").map(Number);
  return `${m}월 ${d}일`;
}

export function buildRenewalMessage(t: RenewalTarget, stage: RenewalStage = "D7"): RenewalMessage {
  const label = expiryLabel(t.expiryDate);
  if (stage === "END") {
    return {
      templateKey: "SUBSCRIPTION_ENDED",
      variables: {
        "#{고객명}": t.name,
        "#{만료일}": label,
      },
      subject: `[${SHOP}] 구독이 종료되었습니다`,
      text:
        `[${SHOP}] ${t.name}님, ${label} 배송을 끝으로 정기구독이 종료되었습니다.\n` +
        `그동안 저희 우유를 드셔주셔서 감사합니다.\n` +
        `다시 받아보시려면 아래에서 재구독을 신청해 주세요.\n` +
        `${RENEW_URL}`,
    };
  }
  return {
    templateKey: "EXPIRE_SOON",
    variables: {
      "#{고객명}": t.name,
      "#{만료일}": label,
    },
    subject: `[${SHOP}] 구독 만료 안내`,
    text:
      `[${SHOP}] ${t.name}님, 정기구독이 ${label}에 만료됩니다.\n` +
      `계속 받아보시려면 아래에서 재구독을 신청해 주세요.\n` +
      `${RENEW_URL}`,
  };
}

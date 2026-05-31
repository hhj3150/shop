// Solapi(국내) 정보성 SMS/LMS 단건 발송. 서버 전용(Route Handler에서만 import).
// 인증: API secret 키로 `${date}${salt}` 를 HMAC-SHA256.
// 키는 Netlify 환경변수로만 주입한다(공개 repo에 절대 커밋 금지).
import { createHmac, randomBytes } from "node:crypto";

const ENDPOINT = "https://api.solapi.com/messages/v4/send-many/detail";

export type SmsResult = {
  ok: boolean;
  reason?: string;
};

function config() {
  return {
    apiKey: process.env.SOLAPI_API_KEY,
    apiSecret: process.env.SOLAPI_API_SECRET,
    from: process.env.SOLAPI_FROM_NUMBER,
  };
}

export const isSolapiConfigured = (): boolean => {
  const c = config();
  return Boolean(c.apiKey && c.apiSecret && c.from);
};

function authHeader(apiKey: string, apiSecret: string): string {
  const date = new Date().toISOString();
  const salt = randomBytes(32).toString("hex");
  const signature = createHmac("sha256", apiSecret).update(`${date}${salt}`).digest("hex");
  return `HMAC-SHA256 ApiKey=${apiKey}, Date=${date}, salt=${salt}, signature=${signature}`;
}

// EUC-KR 기준 바이트(한글 2바이트). 90바이트 초과 시 LMS.
function eucKrBytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) n += s.charCodeAt(i) <= 0x7f ? 1 : 2;
  return n;
}

const messageType = (text: string): "SMS" | "LMS" => (eucKrBytes(text) > 90 ? "LMS" : "SMS");

// 단건 정보성 문자 발송. 실패해도 throw 하지 않고 결과만 반환(주문 흐름을 막지 않음).
export async function sendSms(to: string, text: string, subject?: string): Promise<SmsResult> {
  const c = config();
  if (!c.apiKey || !c.apiSecret || !c.from) {
    return { ok: false, reason: "Solapi 환경변수 미설정" };
  }
  const recipient = to.replace(/[^0-9]/g, "");
  if (!recipient) return { ok: false, reason: "수신번호 없음" };

  const type = messageType(text);
  const message: Record<string, unknown> = {
    to: recipient,
    from: c.from,
    text,
    type,
  };
  if (type === "LMS" && subject) message.subject = subject;

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader(c.apiKey, c.apiSecret),
      },
      body: JSON.stringify({ messages: [message] }),
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      const msg =
        (typeof data?.errorMessage === "string" && data.errorMessage) ||
        (typeof data?.message === "string" && data.message) ||
        `HTTP ${res.status}`;
      return { ok: false, reason: msg };
    }
    const groupInfo = data?.groupInfo as Record<string, unknown> | undefined;
    const count = (groupInfo?.count as Record<string, number> | undefined) ?? {};
    if (Number(count.registeredFailed ?? 0) > 0) {
      return { ok: false, reason: "발송 등록 실패" };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : "네트워크 오류" };
  }
}

export type BulkResult = {
  ok: boolean;
  total: number; // 발송 시도한 수신자 수(중복 제거 후)
  failed: number; // 등록 실패 수
  reason?: string;
};

// 단체 발송. 동일 본문을 여러 수신자에게 한 번에 보낸다. 실패해도 throw 하지 않는다.
export async function sendBulk(
  recipients: string[],
  text: string,
  subject?: string
): Promise<BulkResult> {
  const c = config();
  if (!c.apiKey || !c.apiSecret || !c.from) {
    return { ok: false, total: 0, failed: 0, reason: "Solapi 환경변수 미설정" };
  }
  const nums = Array.from(
    new Set(recipients.map((r) => r.replace(/[^0-9]/g, "")).filter(Boolean))
  );
  if (nums.length === 0) return { ok: false, total: 0, failed: 0, reason: "수신번호 없음" };

  const type = messageType(text);
  const messages = nums.map((to) => {
    const m: Record<string, unknown> = { to, from: c.from, text, type };
    if (type === "LMS" && subject) m.subject = subject;
    return m;
  });

  try {
    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: authHeader(c.apiKey, c.apiSecret),
      },
      body: JSON.stringify({ messages }),
    });
    const data = (await res.json()) as Record<string, unknown>;
    if (!res.ok) {
      const msg =
        (typeof data?.errorMessage === "string" && data.errorMessage) ||
        (typeof data?.message === "string" && data.message) ||
        `HTTP ${res.status}`;
      return { ok: false, total: nums.length, failed: nums.length, reason: msg };
    }
    const groupInfo = data?.groupInfo as Record<string, unknown> | undefined;
    const count = (groupInfo?.count as Record<string, number> | undefined) ?? {};
    const failed = Number(count.registeredFailed ?? 0);
    return { ok: failed === 0, total: nums.length, failed };
  } catch (err) {
    return {
      ok: false,
      total: nums.length,
      failed: nums.length,
      reason: err instanceof Error ? err.message : "네트워크 오류",
    };
  }
}

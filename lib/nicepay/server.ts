// 나이스페이 API 호출(서버 전용). 시크릿 키는 여기서만 읽는다 — 로그·응답에 절대 싣지 않는다.
//
//   환경변수: NICEPAY_CLIENT_ID, NICEPAY_SECRET_KEY, NICEPAY_API_BASE
//     (테스트 https://sandbox-api.nicepay.co.kr / 운영 https://api.nicepay.co.kr)
//   타임아웃: 매뉴얼 권장 connect 5s · read 30s. Netlify 함수 제한 안에 망취소까지 끝내야 해서
//     승인은 20s 로 줄이고, 시간이 넘으면 거래조회 → 그래도 모르면 망취소한다(매뉴얼: read-timeout 시 반드시 망취소).
import { basicAuthHeader, type NicepayPayment } from "./core";

export type NicepayConfig = { clientId: string; secretKey: string; apiBase: string; sandbox: boolean };

// 카드결제 스위치. NICEPAY_ENABLED=true 일 때만 손님에게 카드결제를 연다(결제수단 화면·결제창·승인).
//   운영 오픈 전에는 키가 있어도 꺼 둔다. 끄면 손님 화면은 무통장입금만 보인다.
export function nicepaySwitchOn(): boolean {
  return (process.env.NICEPAY_ENABLED ?? "").trim().toLowerCase() === "true";
}

// 간편결제 스위치. NICEPAY_EASYPAY=true 일 때만 결제창에 간편결제(카카오페이·네이버페이 등)를 함께 띄운다.
//   상점에서 간편결제가 승인되지 않았는데 띄우면 손님이 고를 수 없는 수단이 보인다(2026-11 기준 운영 상점 간편결제 전부 꺼짐).
//   기본은 카드만(method=card).
export function nicepayEasyPayOn(): boolean {
  return (process.env.NICEPAY_EASYPAY ?? "").trim().toLowerCase() === "true";
}

// 결제창 method — 매뉴얼 허용값 중 card / cardAndEasyPay.
export function nicepayWindowMethod(): "card" | "cardAndEasyPay" {
  return nicepayEasyPayOn() ? "cardAndEasyPay" : "card";
}

// 손님 결제용 설정 — 스위치가 켜지고 키가 모두 있을 때만.
export function nicepayCheckoutConfig(): NicepayConfig | null {
  return nicepaySwitchOn() ? nicepayConfig() : null;
}

// 키 설정만 본다(스위치 무관). 관리자 취소·웹훅용 — 스위치를 끈 뒤에도 이미 결제된 건은 환불·통보 처리해야 한다.
export function nicepayConfig(): NicepayConfig | null {
  const clientId = process.env.NICEPAY_CLIENT_ID?.trim();
  const secretKey = process.env.NICEPAY_SECRET_KEY?.trim();
  const apiBase = (process.env.NICEPAY_API_BASE?.trim() || "").replace(/\/+$/, "");
  if (!clientId || !secretKey || !apiBase) return null;
  // 허용된 두 주소만 쓴다(오타로 엉뚱한 곳에 키를 보내지 않게).
  if (apiBase !== "https://sandbox-api.nicepay.co.kr" && apiBase !== "https://api.nicepay.co.kr") return null;
  return { clientId, secretKey, apiBase, sandbox: apiBase.includes("sandbox") };
}

export type CallResult =
  | { kind: "ok"; data: NicepayPayment; http: number }
  | { kind: "timeout" } // 응답을 못 받음 — 결과 불명. 조회·망취소 대상
  | { kind: "network"; message: string }; // 연결 실패 등

async function call(
  cfg: NicepayConfig,
  method: "GET" | "POST",
  path: string,
  body: Record<string, unknown> | null,
  timeoutMs: number
): Promise<CallResult> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(cfg.apiBase + path, {
      method,
      headers: {
        Authorization: basicAuthHeader(cfg.clientId, cfg.secretKey),
        "Content-Type": "application/json;charset=utf-8",
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: ac.signal,
      cache: "no-store",
    });
    const text = await res.text();
    let data: NicepayPayment;
    try {
      data = JSON.parse(text) as NicepayPayment;
    } catch {
      data = { resultCode: `HTTP${res.status}`, resultMsg: text.slice(0, 200) };
    }
    return { kind: "ok", data, http: res.status };
  } catch (e) {
    if (ac.signal.aborted) return { kind: "timeout" };
    return { kind: "network", message: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(timer);
  }
}

// 승인. 이걸 부르지 않으면 결제가 일어나지 않는다.
export function approve(cfg: NicepayConfig, tid: string, amount: number) {
  return call(cfg, "POST", `/v1/payments/${encodeURIComponent(tid)}`, { amount }, 20_000);
}

// 거래조회(tid). 승인 결과를 모를 때 망취소 전에 먼저 확인한다.
export function getPayment(cfg: NicepayConfig, tid: string) {
  return call(cfg, "GET", `/v1/payments/${encodeURIComponent(tid)}`, null, 8_000);
}

// 망취소 — 승인 결과 불명일 때. 유효 1시간, orderId 가 고유할 때만 처리된다.
export function netCancel(cfg: NicepayConfig, orderId: string) {
  return call(cfg, "POST", `/v1/payments/netcancel`, { orderId }, 8_000);
}

// 취소·부분취소. cancelAmt 를 빼면 전액취소. taxFreeAmt = 취소금액 중 면세.
export function cancel(
  cfg: NicepayConfig,
  tid: string,
  p: { orderId: string; reason: string; cancelAmt?: number; taxFreeAmt?: number }
) {
  const body: Record<string, unknown> = { reason: p.reason.slice(0, 100), orderId: p.orderId };
  if (p.cancelAmt != null) body.cancelAmt = p.cancelAmt;
  if (p.taxFreeAmt != null) body.taxFreeAmt = p.taxFreeAmt;
  return call(cfg, "POST", `/v1/payments/${encodeURIComponent(tid)}/cancel`, body, 20_000);
}

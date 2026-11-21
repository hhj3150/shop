"use client";

// 나이스페이 결제창(JS SDK) 호출 — 브라우저 전용. 시크릿 키는 여기 없다.
//   금액·면세금액·상품명은 서버(/api/payments/nicepay/prepare)가 DB 기준으로 정한 값만 쓴다.
//   결과는 returnUrl(서버)로 POST 되고, 서버가 승인·검증 후 완료 페이지로 보낸다.
//   SDK 주소: 매뉴얼 샘플(운영·샌드박스 공통) https://pay.nicepay.co.kr/v1/js/

import { useEffect, useState } from "react";

const SDK_URL = "https://pay.nicepay.co.kr/v1/js/";

type AuthNice = { requestPay: (opts: Record<string, unknown>) => void };
declare global {
  interface Window {
    AUTHNICE?: AuthNice;
  }
}

let loading: Promise<AuthNice> | null = null;

function loadSdk(): Promise<AuthNice> {
  if (typeof window === "undefined") return Promise.reject(new Error("브라우저에서만 결제할 수 있습니다."));
  if (window.AUTHNICE) return Promise.resolve(window.AUTHNICE);
  loading ??= new Promise<AuthNice>((resolve, reject) => {
    const s = document.createElement("script");
    s.src = SDK_URL;
    s.async = true;
    s.onload = () => (window.AUTHNICE ? resolve(window.AUTHNICE) : reject(new Error("결제 모듈을 불러오지 못했습니다.")));
    s.onerror = () => {
      loading = null;
      reject(new Error("결제 모듈을 불러오지 못했습니다. 네트워크를 확인해 주세요."));
    };
    document.head.appendChild(s);
  });
  return loading;
}

export type CardPayContext = {
  orderNo: string;
  phone: string; // 받는 분 연락처 — 서버가 주문과 대조한다
  display: Record<string, string>; // 완료 페이지 표시용 값(type·ship·day 등). mallReserved 로 왕복
};

// 결제창을 띄운다. 성공·실패 결과는 서버가 완료 페이지로 이동시키므로, 이 함수는
//   '결제창을 띄우지 못함/결제창 오류'만 throw 로 알린다.
export async function startCardPayment(ctx: CardPayContext, onWindowError: (msg: string) => void): Promise<void> {
  const res = await fetch("/api/payments/nicepay/prepare", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderNo: ctx.orderNo, phone: ctx.phone }),
  });
  const p = (await res.json().catch(() => ({}))) as {
    ok?: boolean;
    reason?: string;
    clientId?: string;
    orderId?: string;
    amount?: number;
    taxFreeAmt?: number;
    goodsName?: string;
    buyerName?: string;
    buyerTel?: string;
  };
  if (!res.ok || !p.ok) {
    throw new Error(
      p.reason === "not_configured"
        ? "카드결제를 잠시 이용할 수 없습니다. 무통장입금을 이용해 주세요."
        : p.reason === "not_payable"
          ? "이미 결제되었거나 결제할 수 없는 주문입니다."
          : "결제 준비에 실패했습니다. 잠시 후 다시 시도해 주세요."
    );
  }

  const sdk = await loadSdk();
  // mallReserved: 매뉴얼상 큰따옴표 불가·500자 — 쿼리스트링으로 싣는다.
  const mallReserved = new URLSearchParams(ctx.display).toString().slice(0, 500);
  sdk.requestPay({
    clientId: p.clientId,
    method: "cardAndEasyPay",
    orderId: p.orderId,
    amount: p.amount,
    taxFreeAmt: p.taxFreeAmt,
    goodsName: p.goodsName,
    returnUrl: `${window.location.origin}/api/payments/nicepay/return`,
    buyerName: p.buyerName,
    buyerTel: p.buyerTel,
    mallReserved,
    fnError: (result: { errorMsg?: string; msg?: string }) => {
      onWindowError(result?.errorMsg || result?.msg || "결제가 취소되었습니다.");
    },
  });
}

// 카드결제 사용 가능 여부 — 서버에 나이스페이 키가 설정돼 있을 때만 결제수단에 '카드/간편결제'를 보인다.
//   키가 없는 환경(운영 전환 전 등)에서는 지금처럼 무통장입금만 보인다(라이브 무중단).

let enabledCache: Promise<boolean> | null = null;
export function useCardPayEnabled(): boolean {
  const [enabled, setEnabled] = useState(false);
  useEffect(() => {
    let alive = true;
    enabledCache ??= fetch("/api/payments/nicepay/prepare", { cache: "no-store" })
      .then((r) => r.json())
      .then((j: { enabled?: boolean }) => Boolean(j?.enabled))
      .catch(() => false);
    enabledCache.then((v) => alive && setEnabled(v));
    return () => {
      alive = false;
    };
  }, []);
  return enabled;
}

"use client";

// PortOne(포트원) v2 결제창 호출 래퍼 (클라이언트 전용).
//
// 보안: storeId/channelKey 는 공개키라 브라우저 노출이 안전하다(NEXT_PUBLIC_).
//   서버 비밀값(API/웹훅 시크릿)은 여기서 절대 다루지 않는다.
// 금액 권위: 여기서 넘기는 totalAmount 는 항상 서버(DB orders.total_amount)에서
//   다시 읽어온 값이어야 한다(브라우저 계산값 금지). 웹훅도 PG 권위값과 재대조한다.

import PortOne from "@portone/browser-sdk/v2";

const storeId = process.env.NEXT_PUBLIC_PORTONE_STORE_ID;
const channelKey = process.env.NEXT_PUBLIC_PORTONE_CHANNEL_KEY;

// 환경변수가 모두 설정되어야 PortOne 결제를 시도한다.
// 미설정 시 호출부는 기존 무통장입금 안내 흐름으로 폴백한다(라이브 무중단).
export const isPortOneConfigured = Boolean(storeId && channelKey);

// 결제수단: 가상계좌 / 카드 / 간편결제. (UI에서 사용자가 고른다)
export type PayMethod = "VIRTUAL_ACCOUNT" | "CARD" | "EASY_PAY";

export type StartPaymentParams = {
  // 주문번호(= orders.order_no). PortOne paymentId 로 그대로 사용한다.
  paymentId: string;
  // 결제창에 표시할 주문명.
  orderName: string;
  // 서버 권위 결제금액(orders.total_amount). 반드시 DB에서 재조회한 값.
  totalAmount: number;
  payMethod: PayMethod;
  customerName?: string;
  customerPhone?: string;
  // 모바일 리디렉션 결제 완료 후 돌아올 URL (보통 /orders/complete 절대 URL).
  redirectUrl: string;
};

export type StartPaymentResult =
  | { ok: true; paymentId: string; txId: string }
  | { ok: false; code: string; message: string };

// 결제창을 띄우고 결과를 표준 형태로 반환한다.
//   - PC/리디렉션 없는 환경: Promise 로 PaymentResponse 가 resolve 된다.
//     code 가 있으면 실패다.
//   - 모바일 리디렉션 환경: 결제 후 redirectUrl 로 이동하므로 여기서 resolve 되지 않고,
//     완료 페이지의 쿼리파라미터(code/message)로 결과를 판별한다.
export async function startPayment(
  params: StartPaymentParams
): Promise<StartPaymentResult> {
  if (!isPortOneConfigured) {
    return { ok: false, code: "NOT_CONFIGURED", message: "결제 모듈이 설정되지 않았습니다." };
  }

  // 가상계좌는 입금 만료 기한이 필요한 PG가 있어 72시간으로 지정한다(정보성·안전값).
  const virtualAccount =
    params.payMethod === "VIRTUAL_ACCOUNT"
      ? { accountExpiry: { validHours: 72 } }
      : undefined;

  try {
    const res = await PortOne.requestPayment({
      storeId: storeId as string,
      channelKey: channelKey as string,
      paymentId: params.paymentId,
      orderName: params.orderName,
      totalAmount: params.totalAmount,
      currency: "KRW",
      payMethod: params.payMethod,
      customer: {
        fullName: params.customerName,
        phoneNumber: params.customerPhone,
      },
      redirectUrl: params.redirectUrl,
      ...(virtualAccount ? { virtualAccount } : {}),
    });

    // 리디렉션 환경에서는 res 가 undefined 일 수 있다(이동 중).
    if (!res) {
      return { ok: false, code: "REDIRECTING", message: "결제창으로 이동 중입니다." };
    }

    // code 가 있으면 실패.
    if (res.code) {
      return { ok: false, code: res.code, message: res.message ?? "결제에 실패했습니다." };
    }

    return { ok: true, paymentId: res.paymentId, txId: res.txId };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "결제 처리 중 오류가 발생했습니다.";
    return { ok: false, code: "EXCEPTION", message };
  }
}

"use client";

// PortOne(포트원) v2 빌링키 발급창 호출 래퍼 (클라이언트 전용).
//
// 용도: 카드 "빌링키"를 발급받아 정기결제(주 1회 자동청구)에 사용한다.
//   1회 결제(가상계좌/카드 단건)는 lib/portone.ts 의 startPayment 가 담당한다.
//
// 보안: storeId/billingChannelKey 는 공개키라 브라우저 노출이 안전(NEXT_PUBLIC_).
//   발급된 billingKey 토큰은 서버가 getBillingKeyInfo 로 검증한 뒤에만 신뢰·저장한다.
//   (브라우저가 넘긴 billingKey 를 그대로 믿지 않는다.)

import PortOne from "@portone/browser-sdk/v2";

const storeId = process.env.NEXT_PUBLIC_PORTONE_STORE_ID;
// 정기결제(빌링) 전용 채널. 보통 일반 결제 채널과 분리해 발급받는다(카드 빌링 채널).
const billingChannelKey = process.env.NEXT_PUBLIC_PORTONE_BILLING_CHANNEL_KEY;

// 빌링 채널까지 설정되어야 정기결제를 시도한다.
// 미설정 시 호출부는 기존 1회 결제/무통장 흐름으로 폴백한다(라이브 무중단).
export const isBillingConfigured = Boolean(storeId && billingChannelKey);

export type IssueBillingKeyParams = {
  // 빌링키 발급 주문 고유 번호(추적용). 보통 `bk_${userId}_${timestamp}`.
  issueId: string;
  // 발급창에 표시할 이름(예: "헤이밀크 정기구독 카드 등록").
  issueName: string;
  customerName?: string;
  customerPhone?: string;
  // 모바일 리디렉션 발급 완료 후 돌아올 URL (절대 URL).
  redirectUrl: string;
};

export type IssueBillingKeyResult =
  | { ok: true; billingKey: string }
  | { ok: false; code: string; message: string };

// 빌링키 발급창을 띄우고 결과를 표준 형태로 반환한다.
//   - PC/리디렉션 없는 환경: Promise 로 응답이 resolve 된다(code 있으면 실패).
//   - 모바일 리디렉션 환경: 발급 후 redirectUrl 로 이동하므로 여기서 resolve 되지 않고,
//     완료 페이지의 쿼리파라미터(code/message/billingKey)로 결과를 판별한다.
export async function requestBillingKey(
  params: IssueBillingKeyParams
): Promise<IssueBillingKeyResult> {
  if (!isBillingConfigured) {
    return { ok: false, code: "NOT_CONFIGURED", message: "정기결제 모듈이 설정되지 않았습니다." };
  }

  try {
    const res = await PortOne.requestIssueBillingKey({
      storeId: storeId as string,
      channelKey: billingChannelKey as string,
      billingKeyMethod: "CARD", // 정기 자동청구는 카드 빌링키만 사용
      issueId: params.issueId,
      issueName: params.issueName,
      customer: {
        fullName: params.customerName,
        phoneNumber: params.customerPhone,
      },
      redirectUrl: params.redirectUrl,
    });

    // 리디렉션 환경에서는 res 가 undefined 일 수 있다(이동 중).
    if (!res) {
      return { ok: false, code: "REDIRECTING", message: "발급창으로 이동 중입니다." };
    }

    // code 가 있으면 실패.
    if (res.code) {
      return { ok: false, code: res.code, message: res.message ?? "빌링키 발급에 실패했습니다." };
    }

    return { ok: true, billingKey: res.billingKey };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "빌링키 발급 중 오류가 발생했습니다.";
    return { ok: false, code: "EXCEPTION", message };
  }
}

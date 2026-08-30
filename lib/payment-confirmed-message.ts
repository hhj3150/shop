// 입금 확인 안내 문구 조립(순수 함수, I/O 없음).
//
//   같은 문구를 두 경로가 쓴다:
//     1) 관리자가 화면에서 '입금확인'을 누른 경우 — /api/notify
//     2) PayAction 웹훅이 입금을 자동 매칭한 경우 — /api/payaction/webhook
//   2)에 문자가 없어서 2026-07~08 두 달 동안 입금 완료 69건 중 4건만 안내를 받았다.
//   문구가 한 곳에 있어야 두 경로가 같은 말을 한다.

const SHOP = "송영신목장";

export type PaymentConfirmedInput = {
  shipName: string | null;
  orderNo: string;
  shipDate: string | null; // 'YYYY-MM-DD' (서버 산출 KST). 없으면 날짜 없이 안내.
  deliveryMethod: string | null; // '택배' | '방문수령' (미정의/널 = 택배)
};

export type PaymentConfirmedMessage = {
  text: string;
  subject: string;
  variables: Record<string, string>;
};

export function buildPaymentConfirmedMessage(o: PaymentConfirmedInput): PaymentConfirmedMessage {
  const name = (o.shipName ?? "").trim() || "고객";
  const [, mo, da] = (o.shipDate ?? "").split("-");
  const dispatchLine =
    mo && da
      ? o.deliveryMethod === "방문수령"
        ? `${Number(mo)}월 ${Number(da)}일부터 목장에서 수령하실 수 있습니다.`
        : `${Number(mo)}월 ${Number(da)}일에 발송해 드립니다.`
      : `신선하게 준비하여 순차 발송해 드리겠습니다.`;
  return {
    text:
      `[${SHOP}] ${name}님, 입금이 확인되었습니다.\n` +
      `주문번호 ${o.orderNo}\n` +
      dispatchLine,
    subject: `[${SHOP}] 입금 확인`,
    variables: {
      "#{고객명}": name,
      "#{주문번호}": o.orderNo,
    },
  };
}

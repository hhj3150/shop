// 주문 접수 + 입금 안내 문구 조립(순수 함수, I/O 없음).
//
//   회원 주문(/api/notify)과 비회원 주문(/api/notify/guest)이 같은 문구를 쓰도록 한곳에 둔다.
//   비회원은 세션 토큰이 없어 /api/notify 를 호출하지 못했고, 그래서 2026-07-01~08-29
//   비회원 주문 20건 전부가 주문접수·입금 안내 문자를 한 통도 받지 못했다.

const SHOP = "송영신목장";

export type OrderReceivedInput = {
  shipName: string | null;
  orderNo: string;
  amountLabel: string; // 이미 포맷된 금액 문자열(예: "38,000원")
  account: string; // "농협 000-0000-0000 (예금주 …)"
  shipDate: string | null; // 'YYYY-MM-DD' (서버 산출 KST)
  deliveryMethod: string | null; // '택배' | '방문수령' (미정의/널 = 택배)
};

export type OrderReceivedMessage = {
  text: string;
  subject: string;
  variables: Record<string, string>;
};

export function buildOrderReceivedMessage(o: OrderReceivedInput): OrderReceivedMessage {
  const name = (o.shipName ?? "").trim() || "고객";
  const [, mo, da] = (o.shipDate ?? "").split("-");
  const dispatchLine =
    mo && da
      ? o.deliveryMethod === "방문수령"
        ? `입금이 확인되면 ${Number(mo)}월 ${Number(da)}일부터 목장에서 수령하실 수 있습니다.`
        : `입금이 확인되면 ${Number(mo)}월 ${Number(da)}일에 발송해 드립니다.`
      : `입금이 확인되면 다시 안내드리겠습니다.`;
  return {
    text:
      `[${SHOP}] ${name}님, 주문이 접수되었습니다.\n` +
      `주문번호 ${o.orderNo}\n` +
      `입금하실 금액 ${o.amountLabel}\n` +
      `${o.account}\n` +
      dispatchLine,
    subject: `[${SHOP}] 주문 접수`,
    variables: {
      "#{고객명}": name,
      "#{주문번호}": o.orderNo,
      "#{금액}": o.amountLabel,
      "#{입금계좌}": o.account,
    },
  };
}

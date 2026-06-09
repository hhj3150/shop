// 선물 주문 표시 헬퍼(순수 함수). 운영 화면(배송·주문·360·CSV)에서 받는 사람 옆에
//   "누가 보냈는지"를 일관되게 노출해, 운영자가 보낸이/받는이를 헷갈리지 않게 한다.

// 선물이면 "선물 · 보낸이 OOO"(이름 없으면 "선물"), 일반 주문이면 null.
export function giftSenderLabel(
  isGift: boolean | null | undefined,
  gifterName: string | null | undefined
): string | null {
  if (!isGift) return null;
  const who = (gifterName ?? "").trim();
  return who ? `선물 · 보낸이 ${who}` : "선물";
}

// CSV용 짧은 표기: 선물이면 보낸이 이름(없으면 "선물"), 일반이면 빈 문자열.
export function giftSenderCsv(
  isGift: boolean | null | undefined,
  gifterName: string | null | undefined
): string {
  if (!isGift) return "";
  return (gifterName ?? "").trim() || "선물";
}

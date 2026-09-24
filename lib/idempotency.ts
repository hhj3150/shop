// 주문 멱등키 — '같은 주문의 재시도'와 '내용을 바꾼 재제출'을 구분한다.
//
//   [왜 필요한가]
//   결제창에서 취소하거나 결제가 실패하면 주문은 '입금대기'로 남고, 손님은 같은 화면에서
//   다시 결제할 수 있다. 이때 키를 그대로 두면 서버(_create_once_order_core 등)가
//   '같은 키 = 같은 주문'으로 보고 **옛 주문을 그대로 돌려준다**. 손님이 그 사이에 수량·기간·
//   배송지·쿠폰을 바꿨어도 옛 금액·옛 품목으로 결제된다.
//   반대로 매번 새 키를 쓰면 더블클릭·네트워크 재시도가 주문을 두 건 만든다.
//
//   [해법] 키를 주문 내용에서 파생시킨다.
//     키 = `${세션 nonce}-${주문 내용 지문}`
//   내용이 그대로면 키도 그대로라 중복 생성이 막히고, 한 글자라도 바뀌면 키가 달라져
//   새 주문이 만들어진다. '바뀌었는지 감시'하는 코드가 따로 없으니 어긋날 여지도 없다.
//   nonce 는 주문이 실제로 접수된 뒤 회전시킨다 — 같은 손님이 똑같은 구성으로 한 번 더
//   주문할 수 있어야 하기 때문이다.

/** 키 순서에 흔들리지 않는 직렬화. { a, b } 와 { b, a } 가 같은 문자열이 된다. */
function stableStringify(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(",")}}`;
}

/**
 * 주문 내용 지문(cyrb53, 53비트). 암호용이 아니라 '달라졌는가'만 본다.
 * 충돌해도 옛 동작(같은 주문 재사용)으로 되돌아갈 뿐이라 안전 측 실패다.
 */
export function orderFingerprint(payload: unknown): string {
  const s = stableStringify(payload);
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < s.length; i++) {
    const ch = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

/** 이 주문 내용에 대한 멱등키. 내용이 바뀌면 키도 바뀐다. */
export function idempotencyKeyFor(nonce: string, payload: unknown): string {
  return `${nonce}-${orderFingerprint(payload)}`;
}

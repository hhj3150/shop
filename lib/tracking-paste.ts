// 배송 송장 일괄 붙여넣기 파서(순수 함수).
//   엑셀/CSV/공백정렬 등에서 '주문번호 + 송장번호' 행을 붙여넣으면, 각 행을 파싱해
//   주문번호 → 송장번호로 매핑한다. 택배사는 일괄 선택(패널 상단)이라 여기서 다루지 않는다.
//
//   견고성: 구분자는 탭/콤마/2칸+공백을 우선 인식하고, 없으면 단일 공백으로 분리한다.
//   송장번호는 "숫자 6자리 이상"을 포함한 토큰을 뒤에서부터 고른다(헤더·택배사명 열 회피).

export type ParsedTracking = { orderNo: string; tracking: string };

// 토큰들 중 송장번호로 볼 만한 것(숫자 6+자리)을 뒤에서부터 찾는다. 첫 토큰(주문번호)은 제외.
function pickTracking(tokens: string[]): string | null {
  for (let i = tokens.length - 1; i >= 1; i--) {
    const digits = tokens[i].replace(/[^0-9]/g, "");
    if (digits.length >= 6) return tokens[i].replace(/\s/g, "");
  }
  return null;
}

export function parseTrackingPaste(text: string): ParsedTracking[] {
  const rows: ParsedTracking[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line) continue;
    // 탭/콤마/2칸+공백 우선 분리 → 결과가 1개면 단일 공백으로 재분리.
    let tokens = line.split(/[\t,]|\s{2,}/).map((s) => s.trim()).filter(Boolean);
    if (tokens.length < 2) tokens = line.split(/\s+/).map((s) => s.trim()).filter(Boolean);
    if (tokens.length < 2) continue;
    const orderNo = tokens[0];
    const tracking = pickTracking(tokens);
    if (!tracking) continue; // 송장번호 없는 행(헤더 등) 스킵
    rows.push({ orderNo, tracking });
  }
  // 같은 주문번호가 여러 번이면 마지막 값을 채택(중복 붙여넣기 방어).
  const last = new Map<string, string>();
  for (const r of rows) last.set(r.orderNo, r.tracking);
  return [...last].map(([orderNo, tracking]) => ({ orderNo, tracking }));
}

export type TrackingMatch = {
  matched: ParsedTracking[];
  unmatched: string[]; // 큐에 없는 주문번호
};

// 파싱 결과를 알려진 주문번호 집합과 대조해 매칭/미매칭으로 가른다.
export function matchTracking(
  parsed: ParsedTracking[],
  knownOrderNos: Set<string>
): TrackingMatch {
  const matched: ParsedTracking[] = [];
  const unmatched: string[] = [];
  for (const p of parsed) {
    if (knownOrderNos.has(p.orderNo)) matched.push(p);
    else unmatched.push(p.orderNo);
  }
  return { matched, unmatched };
}

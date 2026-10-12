// 로젠 '주문실적조회.xlsx' 시트(행×열 문자열 배열) → 송장 매칭용 행 추출(순수).
//   헤더는 2줄 병합 구조라 라벨이 어느 헤더행에 있든 '열 인덱스'만 확정하면 된다.
import { phone7 } from "./phone";

export type LogenRow = {
  tracking: string; // 운송장번호 숫자만(하이픈 제거)
  recipientName: string; // 수하인명(원문)
  phone7: string; // 휴대폰 앞7자리(정규화), 무효면 ""
  orderNo: string; // 주문번호(보통 "")
  // 접수일자 'YYYY-MM-DD'. 못 읽으면 "".
  //   ★ 소급 입력(과거 회차 복구)에는 이 값이 반드시 필요하다 — '어느 회차였나'를 날짜로만
  //     정할 수 있기 때문이다. 오늘치 송장 채우기만 할 때는 쓰지 않는다.
  shipDate: string;
};

const HEADER_BAND = 6; // 상위 6행 안에서 헤더 라벨 탐색

type ColMap = {
  tracking: number; name: number; phone: number; order: number; date: number; headerRow: number;
};

// 엑셀 셀의 날짜 표현을 'YYYY-MM-DD' 로 — 로젠은 보통 '2026-06-29' 문자열이지만
//   설정에 따라 '2026/06/29' · '2026.06.29' 로도 나온다. 그 외는 빈값(판단 보류).
export function toISODate(raw: string): string {
  const m = String(raw ?? "").trim().match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (!m) return "";
  const [, y, mo, d] = m;
  return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
}

function findColumns(rows: string[][]): ColMap | null {
  const want = (cell: string, label: string) => cell.replace(/\s/g, "").includes(label);
  const map: Partial<ColMap> = {};
  let headerRow = -1;
  for (let ri = 0; ri < Math.min(HEADER_BAND, rows.length); ri++) {
    const row = rows[ri] ?? [];
    for (let ci = 0; ci < row.length; ci++) {
      const c = String(row[ci] ?? "");
      if (map.tracking == null && want(c, "운송장번호")) { map.tracking = ci; headerRow = Math.max(headerRow, ri); }
      else if (map.name == null && want(c, "수하인")) { map.name = ci; headerRow = Math.max(headerRow, ri); }
      else if (map.phone == null && want(c, "휴대폰")) { map.phone = ci; headerRow = Math.max(headerRow, ri); }
      else if (map.order == null && want(c, "주문번호")) { map.order = ci; headerRow = Math.max(headerRow, ri); }
      // '접수일자' 를 쓴다 — '집하일자·배송일자' 가 아니라 목장이 로젠에 넘긴 날이라야
      //   우리 배송 회차 날짜와 맞는다(배송일자는 하루 뒤라 회차가 밀려 보인다).
      else if (map.date == null && want(c, "접수일자")) { map.date = ci; headerRow = Math.max(headerRow, ri); }
    }
  }
  if (map.tracking == null) return null;
  return {
    tracking: map.tracking, name: map.name ?? -1, phone: map.phone ?? -1,
    order: map.order ?? -1, date: map.date ?? -1, headerRow,
  };
}

export function parseLogenSheet(rows: string[][]): LogenRow[] {
  const col = findColumns(rows);
  if (!col) return [];
  const out: LogenRow[] = [];
  for (let ri = col.headerRow + 1; ri < rows.length; ri++) {
    const row = rows[ri] ?? [];
    const get = (ci: number) => (ci >= 0 ? String(row[ci] ?? "").trim() : "");
    const tracking = get(col.tracking).replace(/\D/g, "");
    if (!tracking) continue;
    out.push({
      tracking,
      recipientName: get(col.name),
      phone7: phone7(get(col.phone)),
      orderNo: get(col.order),
      shipDate: toISODate(get(col.date)),
    });
  }
  return out;
}

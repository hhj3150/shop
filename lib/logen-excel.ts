// 로젠 '주문실적조회.xlsx' 시트(행×열 문자열 배열) → 송장 매칭용 행 추출(순수).
//   헤더는 2줄 병합 구조라 라벨이 어느 헤더행에 있든 '열 인덱스'만 확정하면 된다.
import { phone7 } from "./phone";

export type LogenRow = {
  tracking: string; // 운송장번호 숫자만(하이픈 제거)
  recipientName: string; // 수하인명(원문)
  phone7: string; // 휴대폰 앞7자리(정규화), 무효면 ""
  orderNo: string; // 주문번호(보통 "")
};

const HEADER_BAND = 6; // 상위 6행 안에서 헤더 라벨 탐색

type ColMap = { tracking: number; name: number; phone: number; order: number; headerRow: number };

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
    }
  }
  if (map.tracking == null) return null;
  return { tracking: map.tracking, name: map.name ?? -1, phone: map.phone ?? -1, order: map.order ?? -1, headerRow };
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
    out.push({ tracking, recipientName: get(col.name), phone7: phone7(get(col.phone)), orderNo: get(col.order) });
  }
  return out;
}

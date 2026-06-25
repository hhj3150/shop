// 진짜 엑셀(.xlsx) 내보내기. CSV 의 고질병(엑셀이 "2/8회"를 날짜로, 전화번호를
//   지수로 자동 변환 / 한글 인코딩 깨짐 / 구분자 때문에 칸 밀림)을 원천 차단한다.
//   - 모든 셀을 '문자열(t:"s")' 로 고정 → 자동 형변환 없음.
//   - xlsx 내부는 UTF-8 → 한글 안 깨짐.
//   - 셀 단위 저장 → 칸 밀림 없음.
//   xlsx 라이브러리는 용량이 커서, 내보내기를 실행하는 순간에만 동적 import 한다
//   (메인 번들 비대화 방지).
export async function downloadXlsx(
  filename: string,
  rows: (string | number)[][],
  sheetName = "Sheet1"
): Promise<void> {
  const XLSX = await import("xlsx");
  // 모든 값을 문자열로 정규화한 뒤 시트를 만든다(자동 형변환 차단).
  const stringRows = rows.map((row) =>
    row.map((cell) => (cell == null ? "" : String(cell)))
  );
  const ws = XLSX.utils.aoa_to_sheet(stringRows);

  // 셀 타입을 모두 문자열로 못박는다(aoa_to_sheet 가 숫자처럼 보이는 값을 추론하지 않도록).
  const ref = ws["!ref"];
  if (ref) {
    const range = XLSX.utils.decode_range(ref);
    for (let r = range.s.r; r <= range.e.r; r++) {
      for (let c = range.s.c; c <= range.e.c; c++) {
        const cell = ws[XLSX.utils.encode_cell({ r, c })];
        if (cell && cell.v != null) {
          cell.t = "s";
          cell.v = String(cell.v);
        }
      }
    }
  }

  // 열 너비 자동(헤더·값 최대 길이 기준, 한글 2배 가중). 6~40 사이로 제한.
  const cellWidth = (s: string) => {
    let w = 0;
    for (let i = 0; i < s.length; i++) w += s.charCodeAt(i) > 0x7f ? 2 : 1;
    return w;
  };
  const colCount = stringRows.reduce((m, row) => Math.max(m, row.length), 0);
  ws["!cols"] = Array.from({ length: colCount }, (_, c) => {
    let max = 6;
    for (const row of stringRows) max = Math.max(max, cellWidth(row[c] ?? ""));
    return { wch: Math.min(40, max + 1) };
  });

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, sheetName);
  XLSX.writeFile(wb, filename);
}

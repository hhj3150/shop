// 발송명단 CSV 의 합계 행(총 개수·총 L량) 빌더.
//   헤더 위치에서 패딩을 도출해 항상 헤더와 동일 너비로 정렬한다 — 빈칸을 손으로 세다가
//   한 칸 밀리는 버그(제품 수량이 발송일 칸부터 박히던 문제)를 구조적으로 막는다.

// 합계 행 1줄을 만든다.
//   - label: 0번 칸(예: "총 개수")
//   - buckets: 제품 4칸 값. firstBucketIndex 부터 차례로 배치.
//   - grandTotal: 마지막 칸(width-1)에 배치.
//   - 그 외 모든 칸은 빈 문자열.
export function buildTotalsRow(params: {
  label: string;
  width: number;
  firstBucketIndex: number;
  buckets: string[];
  grandTotal: string;
}): string[] {
  const { label, width, firstBucketIndex, buckets, grandTotal } = params;
  const row = Array<string>(width).fill("");
  row[0] = label;
  buckets.forEach((v, i) => {
    row[firstBucketIndex + i] = v;
  });
  row[width - 1] = grandTotal;
  return row;
}

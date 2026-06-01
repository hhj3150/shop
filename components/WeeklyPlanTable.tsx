"use client";

import { useMemo } from "react";

// 이번 주(월~금) 실제 날짜 기준 생산·배송 통합 계획표.
//   각 날짜의 수요는 부모가 넘긴 onlineDemandForDate(정기 요일분 + 단품 발송분)를 그대로 재사용한다
//   → 관리자 화면의 "날짜별 배송 명단"과 동일한 집계 규칙(확정·미정지)을 따른다.
const WD_LABEL = ["일", "월", "화", "수", "목", "금", "토"] as const;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function isoDate(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// 기준일이 속한 주의 월요일부터 금요일까지 5일.
function weekdayDates(base: Date): Date[] {
  const monday = new Date(base);
  monday.setHours(0, 0, 0, 0);
  const dow = (monday.getDay() + 6) % 7; // 월=0
  monday.setDate(monday.getDate() - dow);
  return Array.from({ length: 5 }, (_, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return d;
  });
}

export function WeeklyPlanTable({
  productKeys,
  onlineDemandForDate,
}: {
  productKeys: string[];
  onlineDemandForDate: (date: string) => Record<string, number>;
}) {
  const days = useMemo(() => weekdayDates(new Date()), []);
  const demandByDay = useMemo(
    () => days.map((d) => onlineDemandForDate(isoDate(d))),
    [days, onlineDemandForDate]
  );

  const rowTotal = (key: string) =>
    demandByDay.reduce((s, dem) => s + (dem[key] ?? 0), 0);
  const colTotal = (idx: number) =>
    productKeys.reduce((s, k) => s + (demandByDay[idx][k] ?? 0), 0);
  const grandTotal = productKeys.reduce((s, k) => s + rowTotal(k), 0);

  return (
    <>
      <h2 className="mt-12 font-serif-kr text-lg text-ink">이번 주 생산·배송 계획</h2>
      <p className="mt-1 text-[13px] text-mute">
        {isoDate(days[0])} ~ {isoDate(days[4])} · 확정 주문(입금확인) 기준, 정기 요일분과 단품
        발송분을 날짜별로 합산했습니다. 일시정지 구독은 제외됩니다.
      </p>
      <div className="mt-4 overflow-x-auto">
        <table className="w-full min-w-[640px] border-collapse text-[14px]">
          <thead>
            <tr className="border-b border-line text-left text-mute">
              <th className="py-2 font-normal">제품</th>
              {days.map((d) => (
                <th key={isoDate(d)} className="py-2 text-right font-normal">
                  {d.getMonth() + 1}/{d.getDate()}
                  <span className="ml-0.5 text-[12px]">({WD_LABEL[d.getDay()]})</span>
                </th>
              ))}
              <th className="py-2 text-right font-normal">주간 합계</th>
            </tr>
          </thead>
          <tbody>
            {productKeys.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-4 text-center text-mute">
                  확정 주문이 아직 없습니다.
                </td>
              </tr>
            ) : (
              productKeys.map((key) => (
                <tr key={key} className="border-b border-line/60">
                  <td className="py-2.5 text-ink">{key}</td>
                  {demandByDay.map((dem, idx) => (
                    <td
                      key={idx}
                      className="py-2.5 text-right tabular-nums text-ink-soft"
                    >
                      {dem[key] || "·"}
                    </td>
                  ))}
                  <td className="py-2.5 text-right font-medium tabular-nums text-ink">
                    {rowTotal(key) || "·"}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {productKeys.length > 0 && (
            <tfoot>
              <tr className="border-t-2 border-line">
                <td className="py-2.5 font-medium text-ink">일자 합계</td>
                {days.map((_, idx) => (
                  <td
                    key={idx}
                    className="py-2.5 text-right font-medium tabular-nums text-gold-deep"
                  >
                    {colTotal(idx) || "·"}
                  </td>
                ))}
                <td className="py-2.5 text-right font-semibold tabular-nums text-ink">
                  {grandTotal || "·"}
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </>
  );
}

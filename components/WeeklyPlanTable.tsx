"use client";

import { useMemo, useState } from "react";

// 이번 주(월~금) 실제 날짜 기준 생산·배송 계획표. 정기/단품을 별도 표로 분리해 보여준다.
//   각 날짜의 수요는 부모가 넘긴 demandForDate(roster 기반: 해지·회차소진·정지 제외)를
//   그대로 재사용한다 → 관리자 "날짜별 배송 명단"과 동일한 집계 규칙을 따른다.
const WD_LABEL = ["일", "월", "화", "수", "목", "금", "토"] as const;

type DemandMap = Record<string, number>;
type SplitDemand = { 정기: DemandMap; 단품: DemandMap };

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
  demandForDate,
}: {
  productKeys: string[];
  demandForDate: (date: string) => SplitDemand;
}) {
  // 주 단위 앞/뒤 이동(0=이번 주)으로 생산예측 기간을 선택한다.
  const [weekOffset, setWeekOffset] = useState(0);
  const days = useMemo(() => {
    const base = new Date();
    base.setDate(base.getDate() + weekOffset * 7);
    return weekdayDates(base);
  }, [weekOffset]);
  const splitByDay = useMemo(
    () => days.map((d) => demandForDate(isoDate(d))),
    [days, demandForDate]
  );
  const 정기ByDay = useMemo(() => splitByDay.map((s) => s.정기), [splitByDay]);
  const 단품ByDay = useMemo(() => splitByDay.map((s) => s.단품), [splitByDay]);

  const weekLabel =
    weekOffset === 0
      ? "이번 주"
      : weekOffset === 1
      ? "다음 주"
      : weekOffset === -1
      ? "지난 주"
      : weekOffset > 0
      ? `${weekOffset}주 후`
      : `${-weekOffset}주 전`;

  return (
    <>
      <h2 className="mt-12 font-serif-kr text-lg text-ink">{weekLabel} 생산·배송 계획</h2>
      <div className="mt-2 flex flex-wrap items-center gap-2 no-print">
        <button
          type="button"
          onClick={() => setWeekOffset(weekOffset - 1)}
          aria-label="이전 주"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-ink-soft transition-colors hover:border-gold hover:text-gold-deep"
        >
          ◀
        </button>
        <span className="min-w-[180px] text-center text-[14px] tabular-nums text-ink-soft">
          {isoDate(days[0])} ~ {isoDate(days[4])}
        </span>
        <button
          type="button"
          onClick={() => setWeekOffset(weekOffset + 1)}
          aria-label="다음 주"
          className="flex h-9 w-9 items-center justify-center rounded-full border border-line text-ink-soft transition-colors hover:border-gold hover:text-gold-deep"
        >
          ▶
        </button>
        {weekOffset !== 0 && (
          <button
            type="button"
            onClick={() => setWeekOffset(0)}
            className="rounded-full border border-line px-3 py-1.5 text-[13px] text-ink-soft transition-colors hover:border-gold hover:text-gold-deep"
          >
            이번 주
          </button>
        )}
      </div>

      <DemandTable
        title="정기 배송"
        caption="확정 정기구독의 요일분. 해지·회차소진·일시정지 구독은 제외됩니다(배송 명단과 동일 기준)."
        days={days}
        demandByDay={정기ByDay}
        productKeys={productKeys}
      />
      <DemandTable
        title="단품 배송"
        caption="확정 단품 주문의 발송일(ship_date) 기준 수량입니다."
        days={days}
        demandByDay={단품ByDay}
        productKeys={productKeys}
      />
    </>
  );
}

// 정기/단품 공용 날짜별 수요 표. 그 주 합계가 0인 제품 행은 노이즈라 숨긴다.
function DemandTable({
  title,
  caption,
  days,
  demandByDay,
  productKeys,
}: {
  title: string;
  caption: string;
  days: Date[];
  demandByDay: DemandMap[];
  productKeys: string[];
}) {
  const rowTotal = (key: string) =>
    demandByDay.reduce((s, dem) => s + (dem[key] ?? 0), 0);
  const colTotal = (idx: number) =>
    productKeys.reduce((s, k) => s + (demandByDay[idx][k] ?? 0), 0);
  // 이번 주 합계가 0인 제품은 표에서 제외(정기/단품 각각 등장 제품만 보이도록).
  const rows = productKeys.filter((k) => rowTotal(k) > 0);
  const grandTotal = rows.reduce((s, k) => s + rowTotal(k), 0);

  return (
    <div className="mt-6">
      <h3 className="font-serif-kr text-[15px] text-ink">{title}</h3>
      <p className="mt-1 text-[13px] text-mute">{caption}</p>
      <div className="mt-3 overflow-x-auto">
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
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-4 text-center text-mute">
                  이번 주 {title}이 없습니다.
                </td>
              </tr>
            ) : (
              rows.map((key) => (
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
          {rows.length > 0 && (
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
    </div>
  );
}

"use client";

// 관리자: 구독 회차 확정 — '지금까지 몇 회 나갔는지'를 고객별로 한 번 못박는 화면.
//
//   [왜 사람이 확인해야 하나]
//     출고 버튼이 송장번호를 요구하던 시절(#199 이전), 담당자가 로젠 프로그램으로만
//     보내고 송장 입력을 건너뛰면 shipment_log 에 행이 아예 남지 않았다. 그래서
//     '우리 기록'이 실제보다 적다. 반대로 지금 시스템은 달력으로 세기 때문에
//     결제가 늦어 배송이 비었던 주도 '나간 것'으로 친다 — 실제보다 많다.
//     둘 다 틀린 숫자라서, 진실을 아는 사람(보낸 사람)이 한 번 선언해야 한다.
//
//   [확정 전까지는 아무것도 바뀌지 않는다]
//     미확정 구독은 지금까지와 똑같이 달력으로 돈다. 한 명 확정할 때마다 그 구독만
//     기록 기준으로 정확해진다. 92명을 하루에 다 처리하지 않아도 된다.
import { useCallback, useEffect, useMemo, useState } from "react";
import { loadBaselineRows, confirmSlotRounds } from "@/lib/round-baseline-data";
import { suggestBaseline, type BaselineRow } from "@/lib/round-baseline";

const WEEKDAY_LABEL: Record<string, string> = {
  mon: "월", tue: "화", wed: "수", thu: "목", fri: "금", sat: "토", sun: "일",
};

function dayLabel(d: string): string {
  return WEEKDAY_LABEL[d] ? `${WEEKDAY_LABEL[d]}요일` : d || "—";
}

export function RoundConfirmPanel() {
  const [rows, setRows] = useState<BaselineRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // 입력 중인 확정값(슬롯별). 비어 있으면 추천값을 쓴다.
  const [draft, setDraft] = useState<Record<number, string>>({});
  const [note, setNote] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<number | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [showConfirmed, setShowConfirmed] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await loadBaselineRows());
    } catch (e) {
      setError(e instanceof Error ? e.message : "조회 실패");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  const pending = useMemo(() => rows.filter((r) => r.confirmedAt == null), [rows]);
  const gapped = useMemo(
    () => pending.filter((r) => r.calendarRounds !== r.recordedCount).length,
    [pending]
  );
  const visible = showConfirmed ? rows : pending;

  async function submit(r: BaselineRow) {
    const raw = draft[r.slotId];
    const value =
      raw != null && raw.trim() !== ""
        ? Number(raw)
        : suggestBaseline({
            paidRounds: r.paidRounds,
            recordedCount: r.recordedCount,
            courierCount: null,
          });
    if (!Number.isInteger(value) || value < 0) {
      setError(`${r.name}: 확정 회차는 0 이상의 정수여야 합니다.`);
      return;
    }
    if (value > r.paidRounds) {
      setError(`${r.name}: 결제 회차(${r.paidRounds}회)보다 많이 확정할 수 없습니다.`);
      return;
    }
    // 되돌릴 수 없는 숫자다 — 남은 회차를 말로 보여주고 한 번 더 묻는다.
    const remain = r.paidRounds - value;
    if (
      !window.confirm(
        `${r.name} 님 — 지금까지 ${value}회 나간 것으로 확정합니다.\n` +
          `앞으로 ${remain}회 더 보냅니다. (결제 ${r.paidRounds}회)\n\n진행할까요?`
      )
    ) {
      return;
    }
    setBusy(r.slotId);
    setError(null);
    setDone(null);
    try {
      await confirmSlotRounds(r.slotId, value, note[r.slotId]);
      setDone(`${r.name} 님 ${value}회로 확정했습니다. 남은 회차 ${remain}회.`);
      setDraft((p) => ({ ...p, [r.slotId]: "" }));
      setNote((p) => ({ ...p, [r.slotId]: "" }));
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "확정 실패");
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="rounded-2xl border border-line bg-paper p-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h3 className="text-[15px] font-semibold text-ink">구독 회차 확정</h3>
          <p className="mt-0.5 text-[12.5px] text-mute">
            고객별로 <b>지금까지 실제로 몇 회 나갔는지</b>를 한 번 확정합니다. 확정한 뒤로는
            출고 기록으로 정확히 세고, 남은 회차를 다 보낸 뒤에 재구독 안내가 나갑니다.
          </p>
        </div>
        <div className="flex items-center gap-2 text-[13px] no-print">
          <label className="flex items-center gap-1.5 text-mute">
            <input
              type="checkbox"
              checked={showConfirmed}
              onChange={(e) => setShowConfirmed(e.target.checked)}
            />
            확정된 구독도 보기
          </label>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-lg border border-line px-3 py-1.5 text-ink-soft hover:border-gold hover:text-gold-deep disabled:opacity-40"
          >
            새로고침
          </button>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2 text-[13px]">
        <span className="rounded-full bg-amber-100 px-3 py-1 font-medium text-amber-800 tabular-nums">
          미확정 {pending.length}명
        </span>
        <span className="rounded-full border border-line px-3 py-1 text-mute tabular-nums">
          확정 {rows.length - pending.length}명
        </span>
        <span className="rounded-full border border-line px-3 py-1 text-mute tabular-nums">
          기록·달력 불일치 {gapped}명
        </span>
      </div>

      {error && (
        <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p>
      )}
      {done && (
        <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-[13px] text-emerald-800">
          {done}
        </p>
      )}

      {loading ? (
        <p className="mt-4 text-[13px] text-mute">불러오는 중…</p>
      ) : visible.length === 0 ? (
        <p className="mt-4 text-[13px] text-mute">
          {rows.length === 0 ? "활성 구독이 없습니다." : "미확정 구독이 없습니다. 모두 확정됐습니다."}
        </p>
      ) : (
        <div className="mt-4 overflow-x-auto">
          <table className="admin-cards-sm w-full border-collapse text-[14px] md:min-w-[940px]">
            <thead>
              <tr className="border-b border-line text-left text-mute">
                <th className="py-2 font-normal">이름</th>
                <th className="py-2 font-normal">요일 · 시작</th>
                <th className="py-2 text-right font-normal">결제</th>
                <th className="py-2 text-right font-normal">우리 기록</th>
                <th className="py-2 text-right font-normal">달력 기준</th>
                <th className="py-2 font-normal">마지막 발송</th>
                <th className="py-2 font-normal">확정</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((r) => {
                const suggested = suggestBaseline({
                  paidRounds: r.paidRounds,
                  recordedCount: r.recordedCount,
                  courierCount: null,
                });
                const gap = r.calendarRounds - r.recordedCount;
                return (
                  <tr key={r.slotId} className="border-b border-line/60 align-top">
                    <td data-label="이름" className="py-2.5">
                      <span className="font-medium text-ink">{r.name || "—"}</span>
                      {r.paused && (
                        <span className="ml-1.5 rounded-full bg-slate-100 px-2 py-0.5 text-[11.5px] text-slate-600">
                          정지
                        </span>
                      )}
                      <span className="block text-[12.5px] tabular-nums text-mute">{r.phone}</span>
                    </td>
                    <td data-label="요일 · 시작" className="py-2.5 text-[13px] text-ink-soft">
                      {dayLabel(r.deliveryDay)}
                      <span className="block tabular-nums text-mute">{r.startedAt ?? "—"}</span>
                    </td>
                    <td data-label="결제" className="py-2.5 text-right tabular-nums text-ink">
                      {r.paidRounds}회
                    </td>
                    <td data-label="우리 기록" className="py-2.5 text-right tabular-nums text-ink">
                      {r.recordedCount}회
                    </td>
                    <td
                      data-label="달력 기준"
                      className={`py-2.5 text-right tabular-nums ${gap !== 0 ? "text-amber-700" : "text-mute"}`}
                    >
                      {r.calendarRounds}회
                      {gap !== 0 && (
                        <span className="block text-[12px]">
                          {gap > 0 ? `+${gap}` : gap} 차이
                        </span>
                      )}
                    </td>
                    <td data-label="마지막 발송" className="py-2.5 tabular-nums text-ink-soft">
                      {r.lastShipDate ?? "—"}
                    </td>
                    <td data-label="확정" className="py-2.5">
                      {r.confirmedAt != null ? (
                        <div className="text-[13px]">
                          <span className="rounded-full bg-emerald-50 px-2 py-0.5 font-medium text-emerald-800 tabular-nums">
                            {r.confirmedCount}회 확정
                          </span>
                          <span className="block tabular-nums text-mute">
                            {r.confirmedAt} 기준 · 남은 {Math.max(0, r.paidRounds - (r.confirmedCount ?? 0))}회
                          </span>
                          {r.confirmedNote && (
                            <span className="block text-[12.5px] text-mute">{r.confirmedNote}</span>
                          )}
                        </div>
                      ) : (
                        <div className="flex flex-wrap items-center gap-1.5">
                          <input
                            type="number"
                            min={0}
                            max={r.paidRounds}
                            inputMode="numeric"
                            value={draft[r.slotId] ?? ""}
                            placeholder={String(suggested)}
                            onChange={(e) =>
                              setDraft((p) => ({ ...p, [r.slotId]: e.target.value }))
                            }
                            className="w-16 rounded-lg border border-line bg-cream px-2 py-1.5 text-right tabular-nums text-ink"
                          />
                          <input
                            type="text"
                            value={note[r.slotId] ?? ""}
                            placeholder="메모(선택)"
                            onChange={(e) =>
                              setNote((p) => ({ ...p, [r.slotId]: e.target.value }))
                            }
                            className="w-28 rounded-lg border border-line bg-cream px-2 py-1.5 text-[13px] text-ink"
                          />
                          <button
                            type="button"
                            onClick={() => void submit(r)}
                            disabled={busy === r.slotId}
                            className="rounded-lg bg-ink px-3 py-1.5 text-[13px] font-medium text-cream hover:bg-gold-deep disabled:opacity-40"
                          >
                            {busy === r.slotId ? "확정 중…" : "확정"}
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          <p className="mt-3 text-[12.5px] text-mute">
            빈칸으로 두고 확정하면 추천값(회색 숫자)이 들어갑니다. 추천값은 <b>우리 기록</b>이며,
            애매하면 적은 쪽을 택합니다 — 덜 세면 회차가 남지만, 더 세면 손님이 결제한 회차를
            잃습니다. 로젠 송장 수는 올리지 않습니다. 홍보 발송·전화주문이 섞여 있어
            &lsquo;송장 N건 = 구독 N회&rsquo;가 아니기 때문입니다.
          </p>
        </div>
      )}
    </section>
  );
}

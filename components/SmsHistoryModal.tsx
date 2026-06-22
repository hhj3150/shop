"use client";

// 배송 탭: 한 주문의 문자 발송 이력 조회 + 발송/배송완료 안내 재발송.
//   조회는 sms_log(관리자 SELECT), 재발송은 notify(서버 라우트 → 발송 + sms_log 적재).
//   재발송 후 이력을 다시 불러와 성공/실패가 바로 반영된다.
import { useCallback, useEffect, useState } from "react";
import { loadOrderSmsLog, smsKindLabel, type SmsLogRow } from "@/lib/sms-history";
import { notify } from "@/lib/notify";

type SmsOrder = { id: string; ship_name: string; order_no: string; ship_phone?: string | null };

export function SmsHistoryModal({ order, onClose }: { order: SmsOrder; onClose: () => void }) {
  const [rows, setRows] = useState<SmsLogRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [resending, setResending] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setRows(await loadOrderSmsLog(order.id));
    } catch (e) {
      setError(e instanceof Error ? e.message : "이력 조회 실패");
    } finally {
      setLoading(false);
    }
  }, [order.id]);

  // 모달 열릴 때 이력 조회. 데이터 패칭이라 effect 내 setState(로딩)는 의도된 동작.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
  }, [load]);

  async function resend(kind: "shipped" | "delivered") {
    setResending(kind);
    try {
      await notify({ kind, orderId: order.id });
      await load(); // 새 발송 결과(성공/실패)가 sms_log 에 적재됨 → 갱신
    } finally {
      setResending(null);
    }
  }

  const fmt = (iso: string) =>
    new Date(iso).toLocaleString("ko-KR", {
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        className="max-h-[85vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-line bg-paper p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-[15px] font-semibold text-ink">문자 이력 · 재발송</h3>
            <p className="mt-0.5 text-[12.5px] text-mute">
              {order.ship_name} · {order.order_no}
              {order.ship_phone ? ` · ${order.ship_phone}` : ""}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-[18px] leading-none text-mute hover:text-ink"
            aria-label="닫기"
          >
            ×
          </button>
        </div>

        {/* 재발송 */}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => resend("shipped")}
            disabled={resending !== null}
            className="rounded-lg border border-gold/50 bg-gold/10 px-3 py-1.5 text-[13px] font-medium text-gold-deep transition-colors enabled:hover:bg-gold/20 disabled:opacity-40"
          >
            {resending === "shipped" ? "발송 중…" : "발송 안내 재발송"}
          </button>
          <button
            type="button"
            onClick={() => resend("delivered")}
            disabled={resending !== null}
            className="rounded-lg border border-sky-400/60 bg-sky-50 px-3 py-1.5 text-[13px] font-medium text-sky-700 transition-colors enabled:hover:bg-sky-100 disabled:opacity-40"
          >
            {resending === "delivered" ? "발송 중…" : "배송완료 안내 재발송"}
          </button>
        </div>

        {error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-[13px] text-red-700">{error}</p>
        )}

        {/* 이력 */}
        <div className="mt-4">
          {loading ? (
            <p className="text-[13px] text-mute">불러오는 중…</p>
          ) : rows.length === 0 ? (
            <p className="text-[13px] text-mute">이 주문의 문자 발송 기록이 없습니다.</p>
          ) : (
            <ul className="space-y-2">
              {rows.map((r) => (
                <li key={r.id} className="rounded-xl border border-line bg-cream px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[13px] font-medium text-ink">{smsKindLabel(r.kind)}</span>
                    <span className="flex items-center gap-2">
                      {r.ok === true ? (
                        <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] font-semibold text-emerald-700">
                          성공
                        </span>
                      ) : r.ok === false ? (
                        <span className="rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-semibold text-red-700">
                          실패
                        </span>
                      ) : null}
                      <span className="text-[11.5px] tabular-nums text-mute">{fmt(r.sent_at)}</span>
                    </span>
                  </div>
                  {r.body && (
                    <p className="mt-1 whitespace-pre-line text-[12px] text-ink-soft">{r.body}</p>
                  )}
                  {r.ok === false && r.fail_reason && (
                    <p className="mt-1 text-[11.5px] text-red-600">사유: {r.fail_reason}</p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}

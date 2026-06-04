"use client";

// 관리자용 PayAction '재등록' 버튼. 입금대기 주문이 PayAction 에 등록되지 않아
//   자동매칭이 안 될 때, 관리자가 수동으로 등록을 재시도하고 그 결과(성공/사유)를 확인한다.
//   진단 용도: 실패 사유를 화면에 바로 보여줘 환경변수/키 문제를 즉시 파악하게 한다.
import { useState } from "react";
import { payActionReasonLabel } from "@/lib/payaction-reason";

export type ReRegisterResult = { ok: boolean; reason?: string };

// 등록 라우트 호출(주문번호만 전달 — 연락처·금액은 라우트가 DB 권위값으로 재조회).
//   네트워크 오류도 결과 객체로 흡수해 호출측 흐름을 막지 않는다.
export async function postPayActionRegister(orderNo: string): Promise<ReRegisterResult> {
  try {
    const res = await fetch("/api/payaction/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ orderNo }),
    });
    const data = (await res.json().catch(() => null)) as ReRegisterResult | null;
    return data ?? { ok: false, reason: "no_response" };
  } catch (error) {
    return { ok: false, reason: error instanceof Error ? error.message : "request_failed" };
  }
}

export function PayActionReRegister({
  orderNo,
  onDone,
}: {
  orderNo: string;
  onDone?: (result: ReRegisterResult) => void;
}) {
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<ReRegisterResult | null>(null);

  async function run() {
    setLoading(true);
    const r = await postPayActionRegister(orderNo);
    setResult(r);
    setLoading(false);
    onDone?.(r);
  }

  return (
    <div className="flex flex-col items-start gap-1 no-print">
      <button
        type="button"
        onClick={run}
        disabled={loading}
        className="rounded-full border border-line px-2.5 py-0.5 text-[12px] font-medium text-mute transition-colors hover:border-gold hover:text-gold-deep disabled:opacity-50"
      >
        {loading ? "등록 중…" : "PayAction 재등록"}
      </button>
      {result && (
        <span className={`text-[12px] leading-snug ${result.ok ? "text-emerald-600" : "text-red-600"}`}>
          {result.ok ? "등록 성공 — 입금 매칭 감시 시작" : payActionReasonLabel(result.reason)}
        </span>
      )}
    </div>
  );
}

"use client";

// 비회원 주문조회 — 주문번호 + 주문 시 입력한 전화번호로 주문 상태를 확인한다.
//   게스트 단품 주문은 로그인 없이는 상태를 볼 길이 없었음(전화 문의뿐) → 기본 기능 보강.
//   서버는 lookup_order_by_no_phone RPC(SECURITY DEFINER)가 두 값이 모두 일치할 때만
//   최소 필드(주소·연락처 미포함, 이름 마스킹)를 돌려준다.
import { useState, type FormEvent } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { getSupabase, isSupabaseConfigured } from "@/lib/supabase";
import { formatKRW } from "@/lib/products";
import { courierLabel, trackingUrl } from "@/lib/couriers";
import { Field } from "@/components/Field";

type LookupResult = {
  orderNo: string;
  status: string;
  orderType: string | null;
  createdAt: string;
  shipDate: string | null;
  totalAmount: number;
  shippingFee: number;
  deliveryMethod: string | null;
  shipName: string | null;
  items: { name: string; volume: string | null; qty: number; unitPrice: number }[];
  shipments: {
    shipDate: string;
    courier: string | null;
    trackingNo: string | null;
    shippedAt: string | null;
    deliveredAt: string | null;
  }[];
};

// 상태별 안내 문구 — 다음에 무슨 일이 일어나는지 함께 알려준다.
const STATUS_HINT: Record<string, string> = {
  입금대기: "입금이 확인되면 문자로 안내드리고 발송을 준비합니다.",
  입금확인: "입금이 확인되었습니다. 신선하게 준비하여 발송해 드릴게요.",
  배송준비: "상품을 포장하고 있어요. 발송되면 송장번호가 표시됩니다.",
  배송중: "상품이 이동 중입니다. 아래 송장번호로 배송 조회가 가능해요.",
  배송완료: "배송이 완료되었습니다. 맛있게 드세요!",
  취소: "취소된 주문입니다. 궁금한 점은 고객센터(031-674-3150)로 문의해 주세요.",
};

function LookupForm() {
  const sp = useSearchParams();
  const [orderNo, setOrderNo] = useState(sp.get("no") ?? "");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<LookupResult | null>(null);
  const [searched, setSearched] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const no = orderNo.trim();
    const digits = phone.replace(/[^0-9]/g, "");
    if (no.length < 8) {
      setError("주문번호를 정확히 입력해 주세요. (예: SY20260705-1234)");
      return;
    }
    if (digits.length < 10) {
      setError("주문하실 때 입력한 휴대폰 번호를 입력해 주세요.");
      return;
    }
    if (!isSupabaseConfigured) {
      setError("현재 조회 시스템 연결이 설정되지 않았습니다. 고객센터(031-674-3150)로 문의해 주세요.");
      return;
    }
    setBusy(true);
    setResult(null);
    try {
      const { data, error: rpcErr } = await getSupabase().rpc("lookup_order_by_no_phone", {
        p_order_no: no,
        p_phone: digits,
      });
      if (rpcErr) throw rpcErr;
      setResult((data as LookupResult) ?? null);
      setSearched(true);
    } catch {
      setError("조회 중 오류가 발생했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <form onSubmit={onSubmit} className="mt-8 space-y-5">
        <Field
          id="orderNo"
          label="주문번호"
          placeholder="SY20260705-1234"
          required
          value={orderNo}
          onChange={(e) => setOrderNo(e.target.value)}
        />
        <Field
          id="phone"
          label="휴대폰 번호 (주문 시 입력)"
          type="tel"
          autoComplete="tel"
          placeholder="010-0000-0000"
          required
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />

        {error && (
          <p className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-[14px] text-red-700">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-full bg-ink py-4 text-sm font-medium tracking-wide text-cream transition-colors hover:bg-gold-deep disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "조회 중…" : "주문 조회"}
        </button>
      </form>

      {searched && !result && !error && (
        <p className="mt-6 rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 text-[14px] leading-relaxed text-gold-deep">
          일치하는 주문을 찾지 못했습니다. 주문번호와 휴대폰 번호를 다시 확인해 주세요.
          계속 찾을 수 없으면 고객센터(031-674-3150)로 문의해 주세요.
        </p>
      )}

      {result && (
        <div className="mt-8 rounded-2xl border border-line bg-paper p-6">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <p className="font-mono text-[15px] tabular-nums text-ink">{result.orderNo}</p>
            <span className="rounded-full bg-gold/15 px-3 py-1 text-[13px] font-semibold text-gold-deep">
              {result.status}
            </span>
          </div>
          {STATUS_HINT[result.status] && (
            <p className="mt-2 text-[13px] leading-relaxed text-mute">
              {STATUS_HINT[result.status]}
            </p>
          )}

          <ul className="mt-4 divide-y divide-line border-t border-line">
            {result.items.map((it, i) => (
              <li key={i} className="flex items-baseline justify-between py-2.5 text-[14px]">
                <span className="text-ink">
                  {it.name} {it.volume ?? ""} × {it.qty}
                </span>
                <span className="tabular-nums text-ink-soft">
                  {formatKRW(it.unitPrice * it.qty)}
                </span>
              </li>
            ))}
          </ul>

          <div className="mt-3 space-y-1.5 border-t border-line pt-3 text-[14px]">
            <div className="flex justify-between">
              <span className="text-mute">배송비</span>
              <span className="tabular-nums text-ink-soft">{formatKRW(result.shippingFee)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-mute">총 금액</span>
              <span className="font-semibold tabular-nums text-ink">
                {formatKRW(result.totalAmount)}
              </span>
            </div>
            {result.shipDate && (
              <div className="flex justify-between">
                <span className="text-mute">발송 예정일</span>
                <span className="tabular-nums text-ink-soft">{result.shipDate}</span>
              </div>
            )}
            {result.deliveryMethod && (
              <div className="flex justify-between">
                <span className="text-mute">수령 방법</span>
                <span className="text-ink-soft">{result.deliveryMethod}</span>
              </div>
            )}
            {result.shipName && (
              <div className="flex justify-between">
                <span className="text-mute">받는 분</span>
                <span className="text-ink-soft">{result.shipName}</span>
              </div>
            )}
          </div>

          {result.shipments.length > 0 && (
            <div className="mt-4 border-t border-line pt-4">
              <p className="text-[12px] uppercase tracking-[0.18em] text-mute">배송 조회</p>
              <ul className="mt-2 space-y-2">
                {result.shipments.map((s, i) => {
                  const url = trackingUrl(s.courier, s.trackingNo);
                  return (
                    <li key={i} className="text-[14px] text-ink-soft">
                      <span className="tabular-nums">{s.shipDate}</span>
                      {s.courier && <span className="ml-2">{courierLabel(s.courier)}</span>}
                      {s.trackingNo &&
                        (url ? (
                          <a
                            href={url}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-2 tabular-nums text-gold-deep underline hover:text-gold"
                          >
                            {s.trackingNo}
                          </a>
                        ) : (
                          <span className="ml-2 tabular-nums">{s.trackingNo}</span>
                        ))}
                      {s.deliveredAt ? (
                        <span className="ml-2 text-[12px] text-mute">배송완료</span>
                      ) : s.shippedAt ? (
                        <span className="ml-2 text-[12px] text-mute">배송중</span>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
        </div>
      )}
    </>
  );
}

export default function OrderLookupPage() {
  return (
    <div className="mx-auto max-w-md px-5 pb-24 pt-28 sm:px-8">
      <p className="eyebrow text-gold-deep">Order Status</p>
      <h1 className="mt-3 font-serif-kr text-[clamp(1.7rem,5vw,2.3rem)] font-medium text-ink">
        비회원 주문조회
      </h1>
      <p className="mt-3 text-[14px] leading-relaxed text-mute">
        주문번호와 주문하실 때 입력한 휴대폰 번호로 주문 상태·배송 정보를 확인할 수 있습니다.
        주문번호는 주문 완료 화면과 문자 안내에 있어요.
      </p>

      <Suspense fallback={null}>
        <LookupForm />
      </Suspense>

      <p className="mt-6 text-center text-[14px] text-mute">
        회원이신가요?{" "}
        <Link href="/account" className="text-gold-deep underline hover:text-gold">
          마이페이지에서 주문 내역 보기
        </Link>
      </p>
    </div>
  );
}

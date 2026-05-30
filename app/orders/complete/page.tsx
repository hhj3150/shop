"use client";

import { Suspense } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { DEPOSIT } from "@/lib/site";
import { DELIVERY_DAY_LABEL, type DeliveryDay } from "@/lib/cart";

export default function OrderCompletePage() {
  return (
    <Suspense>
      <Complete />
    </Suspense>
  );
}

function Complete() {
  const sp = useSearchParams();
  const orderNo = sp.get("no") ?? "";
  const day = sp.get("day") as DeliveryDay | null;
  const pos = Number(sp.get("pos") ?? "0");
  const waitlisted = sp.get("wait") === "1";
  const dayLabel = day ? DELIVERY_DAY_LABEL[day] : "";
  const isOnce = sp.get("type") === "once";
  const ship = sp.get("ship") ?? "";

  if (isOnce) {
    return (
      <div className="mx-auto max-w-md px-5 pb-24 pt-32 text-center sm:px-8">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gold/15">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#9a7838" strokeWidth="2">
            <path d="M5 12l4.5 4.5L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 className="mt-6 font-serif-kr text-2xl font-medium text-ink">
          주문이 접수되었습니다
        </h1>
        {orderNo && (
          <p className="mt-2 text-[14px] tabular-nums text-mute">주문번호 {orderNo}</p>
        )}

        {ship && (
          <div className="mt-6 rounded-2xl border border-gold/40 bg-gold/10 px-5 py-4 text-[14px] leading-relaxed text-gold-deep">
            입금이 확인되면{" "}
            <span className="font-semibold">{ship}</span>에 발송됩니다.
            <br />
            (발송은 월–금에만 진행됩니다.)
          </div>
        )}

        <div className="mt-6 rounded-2xl border border-gold/40 bg-gold/5 p-6 text-left">
          <p className="text-[12px] uppercase tracking-[0.18em] text-gold-deep">입금 계좌</p>
          <p className="mt-2 font-serif-kr text-lg text-ink">
            {DEPOSIT.bank} {DEPOSIT.account}
          </p>
          <p className="mt-0.5 text-[13px] text-mute">예금주 {DEPOSIT.holder}</p>
          <p className="mt-4 text-[13px] leading-relaxed text-ink-soft">
            위 계좌로 주문 금액을 입금해 주세요. 입금이 확인되는 즉시 발송을 준비하고,
            등록하신 번호로 안내드립니다.
          </p>
        </div>

        <div className="mt-8 flex justify-center gap-3">
          <Link href="/account" className="rounded-full bg-ink px-6 py-3 text-sm text-cream hover:bg-gold-deep">
            내 주문 보기
          </Link>
          <Link href="/#products" className="rounded-full border border-line px-6 py-3 text-sm text-ink-soft hover:border-gold hover:text-gold">
            계속 둘러보기
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-5 pb-24 pt-32 text-center sm:px-8">
      <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-gold/15">
        <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#9a7838" strokeWidth="2">
          <path d="M5 12l4.5 4.5L19 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h1 className="mt-6 font-serif-kr text-2xl font-medium text-ink">
        {waitlisted ? "대기자로 등록되었습니다" : "구독 신청이 접수되었습니다"}
      </h1>
      {orderNo && (
        <p className="mt-2 text-[14px] tabular-nums text-mute">주문번호 {orderNo}</p>
      )}

      {day && pos > 0 && (
        <div
          className={`mt-6 rounded-2xl border px-5 py-4 text-[14px] leading-relaxed ${
            waitlisted
              ? "border-line bg-paper-2/60 text-ink-soft"
              : "border-gold/40 bg-gold/10 text-gold-deep"
          }`}
        >
          {waitlisted ? (
            <>
              {dayLabel} 정원(100명)이 마감되어{" "}
              <span className="font-semibold">대기 {pos}번째</span>로 등록되었습니다.
              한 자리가 비면 가장 먼저 안내드립니다.
            </>
          ) : (
            <>
              {dayLabel}의{" "}
              <span className="font-semibold">{pos}번째 회원</span>으로 모십니다.
            </>
          )}
        </div>
      )}

      <div className="mt-6 rounded-2xl border border-gold/40 bg-gold/5 p-6 text-left">
        <p className="text-[12px] uppercase tracking-[0.18em] text-gold-deep">
          자동이체 등록 계좌
        </p>
        <p className="mt-2 font-serif-kr text-lg text-ink">
          {DEPOSIT.bank} {DEPOSIT.account}
        </p>
        <p className="mt-0.5 text-[13px] text-mute">예금주 {DEPOSIT.holder}</p>
        <p className="mt-4 text-[13px] leading-relaxed text-ink-soft">
          위 계좌로 4주마다 자동이체를 등록해 주세요. 목장에서 자동이체를 확인한 뒤
          발송을 준비하고, 등록하신 번호로 안내드립니다.
        </p>
      </div>

      <div className="mt-8 flex justify-center gap-3">
        <Link href="/account" className="rounded-full bg-ink px-6 py-3 text-sm text-cream hover:bg-gold-deep">
          내 구독 보기
        </Link>
        <Link href="/#products" className="rounded-full border border-line px-6 py-3 text-sm text-ink-soft hover:border-gold hover:text-gold">
          계속 둘러보기
        </Link>
      </div>
    </div>
  );
}

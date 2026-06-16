"use client";

import { Suspense, useEffect } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { track } from "@/lib/track";
import { DepositAccount } from "@/components/DepositAccount";
import { CopyAmount } from "@/components/CopyAmount";
import { DELIVERY_DAY_LABEL, type DeliveryDay } from "@/lib/cart";
import { formatKRW } from "@/lib/products";
import { DEPOSIT } from "@/lib/site";

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
  const amount = Number(sp.get("amount") ?? "0");
  // 추천 적립금 차감액(있을 때만). amount 는 이미 차감 후 입금액(서버 권위값).
  const credit = Number(sp.get("credit") ?? "0");
  const isPortOne = sp.get("pay") === "portone";
  // 비회원 주문: '내 주문 보기'(로그인 필요) 대신 주문번호 보관 안내를 노출한다.
  const isGuest = sp.get("guest") === "1";
  // PortOne 리디렉션 실패 시 code/message 가 쿼리로 돌아온다.
  const failCode = sp.get("code");
  const failMessage = sp.get("message");

  // 퍼널: 주문이 실제로 접수된 경우에만(주문번호 있고 결제실패 아님) 1회 기록.
  useEffect(() => {
    if (orderNo && !(isPortOne && failCode)) track("purchase", { once: true });
  }, [orderNo, isPortOne, failCode]);

  // PortOne 결제 실패/취소 → 재시도 안내.
  if (isPortOne && failCode) {
    return (
      <div className="mx-auto max-w-md px-5 pb-24 pt-32 text-center sm:px-8">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-red-50">
          <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#dc2626" strokeWidth="2">
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 className="mt-7 font-serif-kr text-[26px] font-medium leading-tight tracking-[-0.01em] text-ink">
          결제가 완료되지 않았습니다
        </h1>
        {orderNo && (
          <p className="mt-3 inline-block rounded-full border border-line bg-cream/80 px-3.5 py-1.5 text-[13px] tabular-nums text-mute">주문번호 {orderNo}</p>
        )}
        <div className="mt-6 rounded-2xl border border-red-200 bg-red-50 px-5 py-4 text-[14px] leading-relaxed text-red-700">
          {failMessage || "결제가 취소되었거나 승인되지 않았습니다."}{" "}
          <br className="hidden sm:block" />
          주문은 입금 대기 상태로 남아 있으니 다시 시도하실 수 있습니다.
        </div>
        <div className="mt-9 flex justify-center gap-3">
          <Link href={isOnce ? "/order-once" : "/#subscribe"} className="rounded-full bg-ink px-6 py-3 text-sm text-cream hover:bg-gold-deep">
            다시 시도
          </Link>
          <Link href="/account" className="rounded-full border border-line px-6 py-3 text-sm text-ink-soft hover:border-gold hover:text-gold">
            내 주문 보기
          </Link>
        </div>
      </div>
    );
  }

  if (isOnce) {
    return (
      <div className="mx-auto max-w-md px-5 pb-24 pt-32 text-center sm:px-8">
        <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gold/15 ring-1 ring-gold/25 shadow-[0_12px_30px_-10px_rgba(154,120,56,0.5)]">
          <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#9a7838" strokeWidth="2">
            <path d="M5 12l4.5 4.5L19 7" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <h1 className="mt-7 font-serif-kr text-[26px] font-medium leading-tight tracking-[-0.01em] text-ink">
          주문이 접수되었습니다
        </h1>
        {orderNo && (
          <p className="mt-3 inline-block rounded-full border border-line bg-cream/80 px-3.5 py-1.5 text-[13px] tabular-nums text-mute">주문번호 {orderNo}</p>
        )}

        {ship && (
          <div className="mt-6 rounded-2xl border border-gold/40 bg-gold/10 px-5 py-4 text-[14px] leading-relaxed text-gold-deep">
            {isPortOne ? "결제가 확인되면 " : "입금이 확인되면 "}
            <span className="font-semibold">{ship}</span>에 발송됩니다.{" "}
            <br className="hidden sm:block" />
            (발송은 월–금에만 진행됩니다.)
          </div>
        )}

        {isPortOne ? (
          <div className="mt-6 rounded-2xl border border-gold/40 bg-gold/5 px-5 py-4 text-[14px] leading-relaxed text-ink-soft">
            결제가 접수되었습니다. 가상계좌로 결제하신 경우 안내된 계좌로 입금하시면
            자동으로 확인되며, 카드·간편결제는 즉시 확인됩니다. 확인 후 발송을 준비하고
            등록하신 번호로 안내드립니다.
          </div>
        ) : (
          <div className="mt-6 rounded-2xl border border-gold/40 bg-gold/5 p-6 text-left">
            <p className="text-[13px] uppercase tracking-[0.18em] text-gold-deep">입금 계좌</p>
            <DepositAccount />
            {credit > 0 && (
              <div className="mt-4 flex items-baseline justify-between text-[13px] text-hey-green">
                <span>추천 적립금 적용</span>
                <span className="tabular-nums">−{formatKRW(credit)}</span>
              </div>
            )}
            {amount > 0 && (
              <div className="mt-4 flex items-baseline justify-between border-t border-dashed border-gold/40 pt-4">
                <span className="text-[14px] text-mute">입금 금액</span>
                <CopyAmount amount={amount} />
              </div>
            )}
            <p className="mt-4 text-[14px] leading-relaxed text-ink-soft">
              위 계좌(예금주 {DEPOSIT.holder})로{" "}
              {amount > 0 ? <span className="font-semibold">{formatKRW(amount)}</span> : "주문 금액"}을
              입금해 주세요. 입금이 확인되는 즉시 발송을 준비하고, 등록하신 번호로 안내드립니다.
            </p>
          </div>
        )}

        {isGuest && (
          <p className="mt-6 text-[13px] leading-relaxed text-mute">
            비회원으로 주문하셨습니다. 문의 시 위 <span className="tabular-nums text-ink-soft">주문번호</span>를
            알려 주시면 빠르게 확인해 드립니다.
          </p>
        )}

        {/* 단품 → 구독 브리지 — 이미 한 번 산 분을 가장 싸게 전환. AI 상담으로 핸드오프. */}
        <div className="mt-9 rounded-2xl border border-gold/40 bg-gold/5 p-6 text-left">
          <p className="font-serif-kr text-[18px] font-medium text-ink">다음 주도, 같은 신선함을.</p>
          <p className="mt-2 text-[14px] leading-relaxed text-ink-soft">
            정기구독은 회당 최대{" "}
            <span className="font-semibold text-gold-deep">15% 더 저렴</span>하고, 매주 같은 요일에
            자동으로 도착합니다. 매번 주문·입금하지 않아도 돼요.
          </p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Link
              href="/#subscribe"
              className="rounded-full bg-ink px-5 py-2.5 text-[14px] font-medium text-cream transition-[transform,colors] hover:bg-gold-deep active:scale-[0.98]"
            >
              정기구독 보기
            </Link>
            <button
              type="button"
              onClick={() =>
                window.dispatchEvent(
                  new CustomEvent("shop:assistant-open", {
                    detail: { prompt: "단품으로 처음 마셔봤어요. 저한테 맞는 정기구독은 무엇일까요?" },
                  })
                )
              }
              className="rounded-full border border-gold/50 px-5 py-2.5 text-[14px] font-medium text-gold-deep transition-[transform,colors] hover:border-gold hover:bg-gold/10 active:scale-[0.98]"
            >
              맞는 구독 AI 상담
            </button>
          </div>
        </div>

        <div className="mt-6 flex justify-center gap-3">
          {!isGuest && (
            <Link href="/account" className="rounded-full bg-ink px-6 py-3 text-sm text-cream hover:bg-gold-deep">
              내 주문 보기
            </Link>
          )}
          <Link
            href="/#products"
            className="rounded-full border border-line px-6 py-3 text-sm text-ink-soft hover:border-gold hover:text-gold"
          >
            계속 둘러보기
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-md px-5 pb-24 pt-32 text-center sm:px-8">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-gold/15 ring-1 ring-gold/25 shadow-[0_12px_30px_-10px_rgba(154,120,56,0.5)]">
        <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="#9a7838" strokeWidth="2">
          <path d="M5 12l4.5 4.5L19 7" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </div>
      <h1 className="mt-7 font-serif-kr text-[26px] font-medium leading-tight tracking-[-0.01em] text-ink">
        {waitlisted ? "대기자로 등록되었습니다" : "구독 신청이 접수되었습니다"}
      </h1>
      {orderNo && (
        <p className="mt-3 inline-block rounded-full border border-line bg-cream/80 px-3.5 py-1.5 text-[13px] tabular-nums text-mute">주문번호 {orderNo}</p>
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

      {isPortOne ? (
        <div className="mt-6 rounded-2xl border border-gold/40 bg-gold/5 px-5 py-4 text-[14px] leading-relaxed text-ink-soft">
          결제가 접수되었습니다. 가상계좌로 결제하신 경우 안내된 계좌로 입금하시면
          자동으로 확인되며, 카드·간편결제는 즉시 확인됩니다. 확인 후 발송을 준비하고
          등록하신 번호로 안내드립니다.
        </div>
      ) : (
        <div className="mt-6 rounded-2xl border border-gold/40 bg-gold/5 p-6 text-left">
          <p className="text-[13px] uppercase tracking-[0.18em] text-gold-deep">
            무통장입금 계좌
          </p>
          <DepositAccount />
          {credit > 0 && (
            <div className="mt-4 flex items-baseline justify-between text-[13px] text-hey-green">
              <span>추천 적립금 적용</span>
              <span className="tabular-nums">−{formatKRW(credit)}</span>
            </div>
          )}
          {amount > 0 && (
            <div className="mt-4 flex items-baseline justify-between border-t border-dashed border-gold/40 pt-4">
              <span className="text-[14px] text-mute">입금 금액 (기간분 일괄)</span>
              <CopyAmount amount={amount} />
            </div>
          )}
          <p className="mt-4 text-[14px] leading-relaxed text-ink-soft">
            위 계좌(예금주 {DEPOSIT.holder})로{" "}
            {amount > 0 ? (
              <>
                선택하신 구독 기간분 <span className="font-semibold">{formatKRW(amount)}</span>을
              </>
            ) : (
              "선택하신 구독 기간분을"
            )}{" "}
            한 번에 입금해 주세요. 목장에서 입금을 확인한 뒤 발송을 준비하고, 등록하신 번호로 안내드립니다.
          </p>
        </div>
      )}

      <div className="mt-9 flex justify-center gap-3">
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

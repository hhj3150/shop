"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useDialog } from "@/lib/useDialog";
import { useCart, DELIVERY_DAY_LABEL } from "@/lib/cart";
import { useAuth } from "@/lib/auth";
import {
  getProduct,
  formatKRW,
  discountForPeriod,
  SUB_PERIODS,
  PERIOD_LABEL,
  MIN_ORDER_KRW,
  PRODUCTS,
} from "@/lib/products";
import { useStorefrontCatalog } from "@/lib/storefront";
import { visibleProducts } from "@/lib/storefront-merge";

export function CartDrawer() {
  const router = useRouter();
  const { user } = useAuth();
  const {
    items,
    isOpen,
    close,
    period,
    weeks,
    perDelivery,
    shipTotal,
    periodTotal,
    weeklyPrice,
    setPeriod,
    setQty,
    remove,
    add,
  } = useCart();
  const { map } = useStorefrontCatalog();

  // Escape·배경 스크롤 잠금·포커스 트랩을 공통 훅으로 처리.
  const dialogRef = useDialog<HTMLElement>(isOpen, close);

  // 회당(매주) 상품 합계가 최소 주문금액 미만이면 배송 불가 → 주문하기 차단 + 안내.
  //   (이전엔 미만이어도 checkout 으로 넘어가 거기서 막혀 '주문이 안된다' 클레임이 잦았음)
  const belowMin = perDelivery < MIN_ORDER_KRW;

  // 함께 담기 — 이전 화면으로 돌아가지 않고 장바구니에서 바로 다른 제품을 더 담는다.
  //   (단품 1개로 최소금액 미달일 때 되돌아가던 번거로움 제거). 같은 요일로 담는다.
  const targetDay = items[0]?.deliveryDay ?? "wed";
  const addable = visibleProducts(PRODUCTS, map).filter(
    (p) => !items.some((i) => i.productId === p.id && i.deliveryDay === targetDay)
  );

  function goCheckout() {
    if (belowMin) return;
    close();
    router.push(user ? "/checkout" : "/login?next=/checkout");
  }

  return (
    <>
      <div
        onClick={close}
        className={`fixed inset-0 z-[60] bg-ink/30 backdrop-blur-sm transition-opacity duration-500 ${
          isOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
        aria-hidden={!isOpen}
      />

      <aside
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="장바구니"
        aria-hidden={!isOpen}
        tabIndex={-1}
        className={`fixed right-0 top-0 z-[70] flex h-full w-full max-w-md flex-col bg-cream shadow-2xl outline-none transition-transform duration-500 ease-[var(--ease-soft)] ${
          isOpen ? "translate-x-0" : "translate-x-full"
        }`}
      >
        <div className="flex items-center justify-between border-b border-line px-6 py-5">
          <h2 className="font-serif-kr text-lg text-ink">장바구니</h2>
          <button
            onClick={close}
            aria-label="닫기"
            className="-mr-2 flex h-11 w-11 items-center justify-center text-mute transition-colors hover:text-ink"
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {items.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center text-center">
              <p className="font-serif-kr text-base text-ink-soft">담긴 제품이 없습니다.</p>
              <p className="mt-2 text-sm text-mute">목장에서 갓 짜낸 한 병을 담아보세요.</p>
            </div>
          ) : (
            <>
            <ul className="divide-y divide-line">
              {items.map((item) => {
                const p = getProduct(item.productId);
                if (!p) return null;
                return (
                  <li key={item.key} className="flex gap-4 py-5">
                    <div className="relative h-20 w-16 shrink-0 overflow-hidden rounded-lg bg-paper-2">
                      <Image
                        src={p.image}
                        alt={p.name}
                        fill
                        sizes="64px"
                        className="object-contain p-1.5"
                      />
                    </div>
                    <div className="flex flex-1 flex-col">
                      <div className="flex items-start justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-ink">
                            {p.name} {p.volume}
                          </p>
                          <p className="mt-0.5 text-[12px] uppercase tracking-[0.18em] text-gold-deep">
                            정기구독 · 매주 {DELIVERY_DAY_LABEL[item.deliveryDay]}
                          </p>
                        </div>
                        <button
                          onClick={() => remove(item.key)}
                          aria-label="삭제"
                          className="-mr-2 -mt-1 flex h-10 w-10 items-center justify-center text-mute transition-colors hover:text-ink"
                        >
                          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
                            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                          </svg>
                        </button>
                      </div>

                      <div className="mt-3 flex items-center justify-between">
                        <div className="flex items-center rounded-full border border-line">
                          <button
                            onClick={() => setQty(item.key, item.qty - 1)}
                            className="flex h-11 w-11 items-center justify-center text-lg text-mute transition-colors hover:text-ink"
                            aria-label="수량 감소"
                          >
                            −
                          </button>
                          <span className="min-w-6 text-center text-sm tabular-nums text-ink">
                            {item.qty}
                          </span>
                          <button
                            onClick={() => setQty(item.key, item.qty + 1)}
                            className="flex h-11 w-11 items-center justify-center text-lg text-mute transition-colors hover:text-ink"
                            aria-label="수량 증가"
                          >
                            +
                          </button>
                        </div>
                        <span className="text-sm tabular-nums text-ink">
                          {formatKRW(weeklyPrice(item.productId) * item.qty)}
                        </span>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>

            {/* 함께 담기 — 이전 화면으로 돌아가지 않고 여기서 바로 추가(같은 요일) */}
            {addable.length > 0 && (
              <div className="mt-6 border-t border-line pt-5">
                <p className="text-[12px] uppercase tracking-[0.18em] text-mute">함께 담기</p>
                <p className="mt-1 text-[12.5px] leading-relaxed text-ink-soft">
                  같은 요일({DELIVERY_DAY_LABEL[targetDay]})에 다른 제품도 바로 더 담으실 수 있어요.
                </p>
                <ul className="mt-3 space-y-2.5">
                  {addable.map((p) => (
                    <li key={p.id} className="flex items-center gap-3">
                      <div className="relative h-12 w-10 shrink-0 overflow-hidden rounded-lg bg-paper-2">
                        <Image
                          src={p.image}
                          alt={`${p.name} ${p.volume}`}
                          fill
                          sizes="40px"
                          className="object-contain p-1"
                        />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-[13px] text-ink">
                          {p.name} {p.volume}
                        </p>
                        <p className="mt-0.5 text-[12px] tabular-nums text-gold-deep">
                          {formatKRW(weeklyPrice(p.id))} / 회
                          {p.soldOut && <span className="ml-1.5 text-mute">품절</span>}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={() => add({ productId: p.id, qty: 1, deliveryDay: targetDay })}
                        disabled={p.soldOut}
                        className="shrink-0 rounded-full border border-line px-3.5 py-2 text-[13px] font-medium text-ink-soft transition-colors hover:border-gold hover:text-gold-deep disabled:opacity-40"
                        aria-label={`${p.name} ${p.volume} 담기`}
                      >
                        담기
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            </>
          )}
        </div>

        {items.length > 0 && (
          <div className="border-t border-line px-6 py-5">
            {/* 구독 기간 선택 — 전체 장바구니에 적용 */}
            <p className="text-[12px] uppercase tracking-[0.18em] text-mute">
              구독 기간 · 한 번에 입금
            </p>
            <div className="mt-2 grid grid-cols-4 gap-1.5">
              {SUB_PERIODS.map((m) => {
                const active = period === m;
                return (
                  <button
                    key={m}
                    onClick={() => setPeriod(m)}
                    aria-pressed={active}
                    className={`flex flex-col items-center rounded-xl border py-1.5 text-[13px] transition-all ${
                      active
                        ? "border-gold bg-gold/10 text-ink"
                        : "border-line text-ink-soft hover:border-gold/50"
                    }`}
                  >
                    <span>{PERIOD_LABEL[m]}</span>
                    <span className="mt-0.5 text-[10px] tabular-nums text-gold-deep">
                      −{Math.round(discountForPeriod(m) * 100)}%
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="mt-4 flex items-center justify-between">
              <span className="text-sm text-mute">회당(매주) 상품 합계</span>
              <span className="text-sm tabular-nums text-ink-soft">
                {formatKRW(perDelivery)}
              </span>
            </div>
            <div className="mt-1.5 flex items-center justify-between">
              <span className="text-sm text-mute">배송비 ({weeks}회)</span>
              <span className="text-sm tabular-nums text-ink-soft">
                {formatKRW(shipTotal)}
              </span>
            </div>
            <div className="mt-1.5 flex items-center justify-between">
              <span className="text-sm text-mute">{PERIOD_LABEL[period]}분({weeks}회) 입금액</span>
              <span className="font-serif-kr text-xl text-ink tabular-nums">
                {formatKRW(periodTotal)}
              </span>
            </div>
            {belowMin ? (
              <div
                role="alert"
                className="mt-3 rounded-xl border border-gold/50 bg-gold/10 px-4 py-3 text-[13px] leading-relaxed text-gold-deep"
              >
                회당(매주) 상품 금액이{" "}
                <span className="font-semibold tabular-nums">{formatKRW(MIN_ORDER_KRW)}</span>{" "}
                이상이어야 배송할 수 있어요. 현재 회당 {formatKRW(perDelivery)}이라{" "}
                <span className="font-semibold tabular-nums">
                  {formatKRW(MIN_ORDER_KRW - perDelivery)}
                </span>{" "}
                더 담아 주세요.
              </div>
            ) : (
              <p className="mt-2 text-[13px] leading-relaxed text-gold-deep">
                매주 같은 요일에 받으시며, 선택하신 {PERIOD_LABEL[period]}분({weeks}회)을
                한 번에 입금 확인 후 발송됩니다.
              </p>
            )}
            <button
              onClick={goCheckout}
              disabled={belowMin}
              className="mt-5 w-full rounded-full bg-ink py-4 text-sm font-medium tracking-wide text-cream transition-[transform,colors] hover:bg-gold-deep active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-ink"
            >
              {belowMin
                ? `${formatKRW(MIN_ORDER_KRW - perDelivery)} 더 담아야 주문 가능`
                : user
                ? "주문하기 (무통장입금)"
                : "로그인하고 주문하기"}
            </button>
            <p className="mt-3 text-center text-[12px] text-mute">
              회원 전용 · 입금 확인 후 발송 · 문자 안내
            </p>
          </div>
        )}
      </aside>
    </>
  );
}

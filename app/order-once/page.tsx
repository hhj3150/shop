"use client";

import { Suspense, useEffect, useMemo, useState, type FormEvent } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useAuth } from "@/lib/auth";
import {
  PRODUCTS,
  getProduct,
  formatKRW,
  ONCE_MIN_KRW,
  ONCE_SHIPPING_KRW,
  onceShippingFee,
} from "@/lib/products";
import { isSpecialDeliveryPostcode } from "@/lib/regions";
import {
  createOnceOrder,
  createGuestOnceOrder,
  registerPayActionDeposit,
  revokeReferralCredit,
  type OnceItem,
} from "@/lib/orders";
import { getSupabase } from "@/lib/supabase";
import { usableBalance, redeemableCoupons, type RewardLite } from "@/lib/referral-credit";
import { backfillProfileShipping } from "@/lib/profile";
import { useStorefrontCatalog } from "@/lib/storefront";
import { visibleProducts, isCatalogRejection } from "@/lib/storefront-merge";
import { notify } from "@/lib/notify";
import { isPortOneConfigured, startPayment, type PayMethod } from "@/lib/portone";
import { nextDispatchDate, formatDispatch } from "@/lib/ship-date";
import { PayMethodSelect, type CheckoutMethod } from "@/components/PayMethodSelect";
import { Field } from "@/components/Field";
import { AddressSearch } from "@/components/AddressSearch";
import { Track } from "@/components/Track";
import { GiftOptions } from "@/components/GiftOptions";
import { LoadMyInfoButton, type MyInfoFields } from "@/components/LoadMyInfo";
import { CashReceiptFields } from "@/components/CashReceiptFields";
import {
  DEFAULT_CASH_RECEIPT,
  validateCashReceipt,
  type CashReceiptType,
} from "@/lib/cash-receipt";
import type { Recipient } from "@/lib/recipients";

export default function OrderOncePage() {
  return (
    <Suspense
      fallback={
        <div className="mx-auto max-w-md px-5 pt-28 text-center text-mute sm:px-8">
          불러오는 중…
        </div>
      }
    >
      <OrderOnce />
    </Suspense>
  );
}

function OrderOnce() {
  const router = useRouter();
  const sp = useSearchParams();
  const { ready, user, profile } = useAuth();

  const [qtys, setQtys] = useState<Record<string, number>>({});
  const [ship, setShip] = useState({
    name: "",
    phone: "",
    postcode: "",
    address: "",
    addressDetail: "",
    depositorName: "",
    memo: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [isGift, setIsGift] = useState(false);
  const [giftMessage, setGiftMessage] = useState("");
  const [method, setMethod] = useState<CheckoutMethod>("BANK");
  const [cashReceiptType, setCashReceiptType] = useState<CashReceiptType>(DEFAULT_CASH_RECEIPT);
  const [cashReceiptId, setCashReceiptId] = useState("");
  // 특수배송지역(제주·도서산간 등) 신선도 고지 동의.
  const [acceptFresh, setAcceptFresh] = useState(false);
  // 추천 적립금(쿠폰) 보유분 + 사용 여부. 기본 사용(선차감 정책). 끄면 주문 후 되돌린다.
  const [rewards, setRewards] = useState<RewardLite[]>([]);
  const [useReferralCredit, setUseReferralCredit] = useState(true);

  const { map, refresh } = useStorefrontCatalog();

  // 카드·간편결제(PortOne)는 PortOne 설정 시·선물이 아닐 때만 선택 가능하다.
  //   선물은 입금확인 문자가 받는 분에게 잘못 갈 수 있어 무통장(PayAction) 흐름으로 고정한다.
  const canPortOne = isPortOneConfigured && !isGift;
  // 실제 PortOne 결제는 무통장(BANK)이 아닌 결제수단을 골랐을 때만 사용한다.
  const usePortOne = canPortOne && method !== "BANK";

  // 단품 1회 구매는 비회원(게스트)도 가능하다 → 로그인 강제 리디렉션 없음.
  // 선물하기·정기구독 등 회원 전용 기능만 user 유무로 분기한다.

  // ?add=<id> 로 들어오면 해당 제품을 최소 주문금액(24,000원)을 채우는 수량으로 미리 담는다.
  //   1개로는 최소금액 미만이라 '주문하기'가 비활성화되므로, 바로 주문 가능한 수량을 채워 둔다.
  useEffect(() => {
    const add = sp.get("add");
    const p = add ? getProduct(add) : undefined;
    if (p) {
      const minQty = Math.max(1, Math.ceil(ONCE_MIN_KRW / p.price));
      setQtys((prev) => (prev[p.id] ? prev : { ...prev, [p.id]: minQty }));
    }
  }, [sp]);

  useEffect(() => {
    if (!profile) return;
    setShip((prev) => ({
      ...prev,
      name: prev.name || profile.name,
      phone: prev.phone || profile.phone,
      postcode: prev.postcode || (profile.postcode ?? ""),
      address: prev.address || (profile.address ?? ""),
      addressDetail: prev.addressDetail || (profile.address_detail ?? ""),
      depositorName: prev.depositorName || profile.name,
    }));
  }, [profile]);

  // 추천 적립금 잔액 조회(표시·미리보기용). 실패해도 주문은 그대로 진행된다.
  useEffect(() => {
    if (!user) return;
    let alive = true;
    getSupabase()
      .from("referral_rewards")
      .select("amount_krw,status,expires_at")
      .eq("user_id", user.id)
      .then(({ data }) => {
        if (alive) setRewards((data as RewardLite[]) ?? []);
      });
    return () => {
      alive = false;
    };
  }, [user]);

  const setQty = (id: string, q: number) =>
    setQtys((prev) => ({ ...prev, [id]: Math.max(0, q) }));

  const subtotal = useMemo(
    () =>
      visibleProducts(PRODUCTS, map).reduce(
        (sum, p) => sum + p.price * (qtys[p.id] ?? 0),
        0
      ),
    [qtys, map]
  );
  const count = useMemo(
    () =>
      visibleProducts(PRODUCTS, map).reduce((n, p) => n + (qtys[p.id] ?? 0), 0),
    [qtys, map]
  );
  // 배송지 우편번호 기준 배송비. 특수배송지역(제주·도서산간 등)은 5,000원이며
  //   서버(RPC)가 청구하는 금액과 일치시킨다.
  const isSpecialRegion = isSpecialDeliveryPostcode(ship.postcode);
  const shipping = onceShippingFee(subtotal, ship.postcode);
  const total = subtotal + shipping;
  const belowMin = subtotal < ONCE_MIN_KRW;

  // 추천 적립금 미리보기 — 서버(apply_referral_credit)와 동일 규칙으로 차감액을 계산해 표시한다.
  //   실제 차감은 서버 권위값. 토글을 끄면 차감 없이 전액 입금으로 보여준다.
  const creditAvailable = usableBalance(rewards, new Date().toISOString());
  const redeem = useReferralCredit
    ? redeemableCoupons({ availableCount: creditAvailable.count, orderTotal: total })
    : { useCount: 0, creditKrw: 0, payable: total };
  const finalPayable = total - redeem.creditKrw;

  const dispatch = useMemo(() => formatDispatch(nextDispatchDate()), []);

  function update<K extends keyof typeof ship>(key: K, value: string) {
    setShip((prev) => ({ ...prev, [key]: value }));
  }

  // 회원정보 불러오기: 가입 시 저장한 이름·연락처·주소·입금자명을 한 번에 채운다(재구매 편의).
  function fillFromProfile(fields: MyInfoFields) {
    setShip((prev) => ({ ...prev, ...fields }));
  }

  // 선물 받는 분을 주소록에서 선택하면 배송지 필드를 그 값으로 채운다.
  function applyRecipient(r: Recipient) {
    setShip((prev) => ({
      ...prev,
      name: r.name,
      phone: r.phone,
      postcode: r.postcode ?? "",
      address: r.address,
      addressDetail: r.addressDetail ?? "",
    }));
  }

  // 선물/나에게 모드 전환. 선물로 바꾸면 받는 분 칸을 비우고,
  //   나에게로 되돌리면 내 프로필 정보로 복구한다.
  function setGiftMode(on: boolean) {
    setIsGift(on);
    if (on) {
      setShip((prev) => ({
        ...prev,
        name: "",
        phone: "",
        postcode: "",
        address: "",
        addressDetail: "",
      }));
    } else if (profile) {
      setShip((prev) => ({
        ...prev,
        name: profile.name,
        phone: profile.phone,
        postcode: profile.postcode ?? "",
        address: profile.address ?? "",
        addressDetail: profile.address_detail ?? "",
      }));
    }
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (count === 0) {
      setError("구매하실 제품의 수량을 선택해 주세요.");
      return;
    }
    if (belowMin) {
      setError(`단품 구매는 상품 합계 ${formatKRW(ONCE_MIN_KRW)}부터 가능합니다.`);
      return;
    }
    if (!ship.name.trim() || !ship.phone.trim() || !ship.address.trim()) {
      setError("받는 분, 연락처, 주소를 입력해 주세요.");
      return;
    }
    if (isSpecialRegion && !acceptFresh) {
      setError("제주·도서산간 등 특수배송지역은 신선도 안내에 동의하셔야 주문할 수 있습니다.");
      return;
    }
    // 무통장입금은 입금자명이 있어야 PayAction 자동매칭이 가능하다.
    if (!usePortOne && !ship.depositorName.trim()) {
      setError("무통장입금은 입금자명을 입력해 주세요. (입금 자동 확인에 필요합니다)");
      return;
    }
    const receiptError = validateCashReceipt(cashReceiptType, cashReceiptId);
    if (receiptError) {
      setError(receiptError);
      return;
    }
    setBusy(true);
    try {
      const items: OnceItem[] = visibleProducts(PRODUCTS, map)
        .filter((p) => (qtys[p.id] ?? 0) > 0)
        .map((p) => ({ productId: p.id, qty: qtys[p.id], unitPrice: p.price }));
      // 회원은 createOnceOrder(로그인 필요), 비회원은 createGuestOnceOrder 로 분기.
      // 게스트는 선물하기를 노출하지 않으므로 isGift 는 항상 false 다.
      const shipInfo = {
        ...ship,
        isGift,
        gifterName: profile?.name ?? ship.depositorName,
        giftMessage,
        cashReceiptType,
        cashReceiptId,
      };
      const { orderId, orderNo, shipDate, totalAmount, referralCreditKrw } = user
        ? await createOnceOrder(items, shipInfo)
        : await createGuestOnceOrder(items, shipInfo);

      // 적립금 사용 안 함(토글 OFF): 서버가 자동 선차감한 적립금을 되돌린다(쿠폰 복구·금액 원복).
      //   이후 결제·입금 금액은 원복된 전액(finalTotal)을 권위값으로 사용한다.
      let finalTotal = totalAmount;
      let finalCredit = referralCreditKrw;
      if (!useReferralCredit && referralCreditKrw > 0) {
        const restored = await revokeReferralCredit(orderId);
        if (restored > 0) {
          finalTotal = totalAmount + restored;
          finalCredit = 0;
        }
      }

      // 회원 본인 주소 주문이면, 프로필의 빈 배송칸을 자동 보완 → 다음 주문부터 따라온다.
      if (user && profile && !isGift) void backfillProfileShipping(profile, ship);
      const shipLabel = formatDispatch(new Date(`${shipDate}T00:00:00`));
      const params = new URLSearchParams({
        no: orderNo,
        type: "once",
        ship: shipLabel,
        amount: String(finalTotal),
      });
      if (finalCredit > 0) params.set("credit", String(finalCredit));
      // 비회원 주문은 '내 주문 보기'(로그인 필요)를 숨기도록 완료 페이지에 표시.
      if (!user) params.set("guest", "1");

      if (usePortOne) {
        // PortOne 결제창 호출. 모바일은 redirectUrl 로 이동하므로 아래 분기는 PC에서만 도달.
        // 입금확인 문자는 웹훅이 보내므로 여기서 order_received 를 보내지 않는다.
        const firstName = getProduct(items[0].productId)?.name ?? "단품";
        const orderName = count > 1 ? `${firstName} 외 ${count - 1}건` : firstName;
        params.set("pay", "portone");
        const redirectUrl = `${window.location.origin}/orders/complete?${params.toString()}`;
        const result = await startPayment({
          paymentId: orderNo,
          orderName,
          totalAmount: finalTotal,
          payMethod: method as PayMethod,
          customerName: ship.name,
          customerPhone: ship.phone,
          redirectUrl,
        });
        if (result.ok) {
          router.push(`${redirectUrl}&paid=1`);
        } else if (result.code !== "REDIRECTING") {
          setError(result.message);
        }
        return;
      }

      // 무통장(BANK) 흐름: PayAction 에 주문 등록(자동 입금확인 대상으로 감시 시작).
      //   입금확인 문자 수신처: 선물이면 보내는 분 연락처, 일반/게스트는 배송 연락처.
      const ordererPhone = isGift ? (profile?.phone ?? ship.phone) : ship.phone;
      // await 로 등록 완결 후 라우팅 — fire-and-forget 이면 router.push 로 요청이 abort 돼
      //   서버 라우트에 도달조차 못 했음. 등록 실패는 내부에서 흡수(non-fatal)되어 주문은 진행됨.
      await registerPayActionDeposit(orderNo, ordererPhone);
      // 정보성 문자는 세션 토큰으로 인증되므로 회원 주문에서만 발송한다.
      // 비회원은 완료 페이지의 입금 안내로 갈음한다(입금확인 문자는 PayAction 이 자동 발송).
      if (user) void notify({ kind: isGift ? "gift_once" : "order_received", orderId });
      router.push(`/orders/complete?${params.toString()}`);
    } catch (err) {
      const msg = err instanceof Error ? err.message : "주문에 실패했습니다.";
      if (isCatalogRejection(msg)) {
        // 페이지 로드~제출 사이에 관리자가 품절/중지로 바꾼 레이스 → 카탈로그 재조회로 즉시 반영.
        await refresh();
        setError("해당 상품이 품절되었거나 판매 중지되었습니다. 장바구니를 확인해 주세요.");
      } else {
        setError(msg);
      }
    } finally {
      setBusy(false);
    }
  }

  if (!ready) {
    return (
      <div className="mx-auto max-w-md px-5 pt-28 text-center text-mute sm:px-8">
        불러오는 중…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-5 pb-24 pt-28 sm:px-8">
      <Track event="begin_checkout" once />
      <p className="eyebrow text-gold-deep">Single Order · 단품 구매</p>
      <h1 className="mt-3 font-serif-kr text-[clamp(1.7rem,5vw,2.3rem)] font-medium text-ink">
        한 번만, 골라 담기
      </h1>
      <p className="mt-3 text-[14px] leading-relaxed text-mute">
        구독 없이, 원하는 것만 한 번. 상품 합계{" "}
        <span className="text-ink-soft">{formatKRW(ONCE_MIN_KRW)} 이상</span> · 배송비{" "}
        {formatKRW(ONCE_SHIPPING_KRW)}. 입금이 확인되면{" "}
        <span className="text-ink-soft">{dispatch}</span>에 발송됩니다.{" "}
        <br className="hidden sm:block" />
        평일(월–목) 자정 전 주문은 다음 날, 금·토·일 주문은 월요일 발송. (발송 월–금)
      </p>

      {/* 비회원도 주문 가능 — 회원이면 배송지 자동입력·주문내역 조회가 편리하다는 안내 */}
      {!user && (
        <div className="mt-6 rounded-2xl border border-gold/30 bg-gold/5 px-5 py-4 text-[14px] leading-relaxed text-ink-soft">
          비회원으로 바로 주문하실 수 있습니다.{" "}
          <Link
            href="/login?next=/order-once"
            className="font-medium text-gold-deep underline-offset-4 hover:underline"
          >
            로그인
          </Link>
          하시면 배송지가 자동으로 채워지고, 주문·배송 내역을 한눈에 보실 수 있습니다.
        </div>
      )}

      {/* 제품 선택 */}
      <ul className="mt-8 space-y-3">
        {visibleProducts(PRODUCTS, map).map((p) => {
          const q = qtys[p.id] ?? 0;
          return (
            <li
              key={p.id}
              className="flex items-center gap-4 rounded-2xl border border-line bg-cream p-4"
            >
              <div className="relative h-16 w-14 shrink-0 overflow-hidden rounded-lg bg-paper">
                <Image
                  src={p.image}
                  alt={`${p.name} ${p.volume}`}
                  fill
                  sizes="56px"
                  className="object-contain p-1"
                />
              </div>
              <div className="min-w-0 flex-1">
                <p className="truncate text-[14px] text-ink">
                  {p.name} {p.volume}
                </p>
                <p className="mt-0.5 text-[13px] tabular-nums text-gold-deep">
                  {formatKRW(p.price)}
                  {p.soldOut && <span className="ml-1.5 text-mute">· 품절</span>}
                </p>
              </div>
              <div className="flex items-center rounded-full border border-line">
                <button
                  type="button"
                  onClick={() => setQty(p.id, q - 1)}
                  disabled={q === 0}
                  className="px-3.5 py-2 text-mute transition-colors hover:text-ink disabled:opacity-30"
                  aria-label={`${p.name} 수량 감소`}
                >
                  −
                </button>
                <span className="min-w-7 text-center text-[14px] tabular-nums text-ink">{q}</span>
                <button
                  type="button"
                  onClick={() => setQty(p.id, q + 1)}
                  disabled={p.soldOut}
                  className="px-3.5 py-2 text-mute transition-colors hover:text-ink disabled:opacity-30"
                  aria-label={`${p.name} 수량 증가`}
                >
                  +
                </button>
              </div>
            </li>
          );
        })}
      </ul>

      {/* 합계 */}
      <div className="mt-6 rounded-2xl border border-line bg-cream p-5">
        <div className="flex justify-between text-[14px]">
          <span className="text-mute">상품 합계{count > 0 ? ` · ${count}개` : ""}</span>
          <span className="tabular-nums text-ink-soft">{formatKRW(subtotal)}</span>
        </div>
        <div className="mt-2 flex justify-between text-[14px]">
          <span className="text-mute">
            배송비
            {isSpecialRegion && (
              <span className="ml-1.5 text-[12px] text-gold-deep">제주·도서산간 5,000원</span>
            )}
          </span>
          <span className="tabular-nums text-ink-soft">
            {formatKRW(shipping)}
          </span>
        </div>
        {creditAvailable.count > 0 && (
          <div className="mt-2 border-t border-gold/20 pt-2 text-[14px]">
            <label className="flex cursor-pointer items-center justify-between gap-2">
              <span className="text-mute">
                추천 적립금 사용{" "}
                <span className="text-[12px] text-gold-deep">
                  ({creditAvailable.count}장 · {formatKRW(creditAvailable.krw)} 보유)
                </span>
              </span>
              <input
                type="checkbox"
                checked={useReferralCredit}
                onChange={(e) => setUseReferralCredit(e.target.checked)}
                className="h-4 w-4 accent-gold-deep"
              />
            </label>
            {redeem.creditKrw > 0 && (
              <div className="mt-1.5 flex justify-between text-gold-deep">
                <span>추천 적립금 ({redeem.useCount}장 적용)</span>
                <span className="tabular-nums">−{formatKRW(redeem.creditKrw)}</span>
              </div>
            )}
          </div>
        )}
        <div className="mt-3 flex items-end justify-between border-t border-line pt-3">
          <span className="text-mute">결제(입금) 금액</span>
          <span className="font-serif-kr text-xl tabular-nums text-ink">{formatKRW(finalPayable)}</span>
        </div>
        {belowMin && (
          <p className="mt-3 text-[13px] text-mute">
            상품 합계 {formatKRW(ONCE_MIN_KRW)} 이상부터 주문할 수 있습니다.
            {subtotal > 0 && ` (${formatKRW(ONCE_MIN_KRW - subtotal)} 더 담아 주세요)`}
          </p>
        )}
      </div>

      {/* 결제수단: PortOne 설정 시 무통장/카드/간편결제 선택, 무통장(또는 선물·미설정) 시 계좌 안내 */}
      <div className="mt-5 rounded-2xl border border-gold/40 bg-gold/5 p-5">
        {canPortOne && <PayMethodSelect value={method} onChange={setMethod} />}
        {usePortOne ? (
          <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">
            {formatKRW(finalPayable)}을 결제합니다. 결제가 확인되는 즉시 발송됩니다.
          </p>
        ) : (
          <div className={canPortOne ? "mt-4" : ""}>
            {!canPortOne && (
              <p className="text-[13px] uppercase tracking-[0.18em] text-gold-deep">무통장입금</p>
            )}
            <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">
              <span className="font-medium text-ink">주문 완료 후, 입금 금액·계좌 안내</span>
              <span className="mt-1 block text-mute">
                안내된 금액 그대로 보내주시면 자동으로 확인돼요. 미리 입금하지 않으셔도 괜찮습니다.
              </span>
            </p>
          </div>
        )}
      </div>

      {/* 배송지 */}
      <form onSubmit={onSubmit} className="mt-8 space-y-5">
        {user && (
          <GiftOptions
            userId={user.id}
            isGift={isGift}
            giftMessage={giftMessage}
            onModeChange={setGiftMode}
            onMessageChange={setGiftMessage}
            onSelectRecipient={applyRecipient}
          />
        )}
        {!isGift && (
          <LoadMyInfoButton profile={profile} onLoad={fillFromProfile} disabled={busy} />
        )}
        <Field id="name" label={isGift ? "받는 분 (선물 받으실 분)" : "받는 분"} required value={ship.name} onChange={(e) => update("name", e.target.value)} />
        <Field id="phone" label="연락처" hint="발송 안내 문자를 받는 번호." inputMode="numeric" required value={ship.phone} onChange={(e) => update("phone", e.target.value)} />
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <Field id="postcode" label="우편번호" inputMode="numeric" value={ship.postcode} onChange={(e) => update("postcode", e.target.value)} />
          </div>
          <div className="pb-1">
            <AddressSearch
              onSelect={(postcode, address) =>
                setShip((prev) => ({ ...prev, postcode, address }))
              }
            />
          </div>
        </div>
        <Field id="address" label="주소" required value={ship.address} onChange={(e) => update("address", e.target.value)} />
        <Field id="addressDetail" label="상세 주소" value={ship.addressDetail} onChange={(e) => update("addressDetail", e.target.value)} />

        {isSpecialRegion && (
          <div className="rounded-xl border border-gold/50 bg-gold/10 px-4 py-3">
            <p className="text-[14px] font-medium text-gold-deep">신선함이 생명입니다</p>
            <p className="mt-1 text-[13px] leading-relaxed text-ink-soft">
              입력하신 지역(제주·도서산간 등)은 당일·익일 배송이 어려워 도착까지 하루 이상 걸릴 수
              있고, 그만큼 신선도가 떨어질 수 있습니다. 이 지역은 배송비가 5,000원입니다.
            </p>
            <label className="mt-3 flex items-start gap-2 text-[13px] text-ink">
              <input
                type="checkbox"
                checked={acceptFresh}
                onChange={(e) => setAcceptFresh(e.target.checked)}
                className="mt-0.5 h-4 w-4 shrink-0 accent-gold-deep"
              />
              <span>신선도 안내를 확인했고, 배송비 5,000원에 동의합니다.</span>
            </label>
          </div>
        )}

        <Field id="depositorName" label="입금자명" hint="통장 입금 대조를 위해 실제 입금하실 분의 이름을 적어 주세요." value={ship.depositorName} onChange={(e) => update("depositorName", e.target.value)} />
        <Field id="memo" label="배송 메모 (선택)" value={ship.memo} onChange={(e) => update("memo", e.target.value)} />

        <CashReceiptFields
          type={cashReceiptType}
          id={cashReceiptId}
          onTypeChange={setCashReceiptType}
          onIdChange={setCashReceiptId}
        />

        {error && (
          <p className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-[14px] text-red-700">
            {error}
          </p>
        )}

        {(count === 0 || belowMin) && (
          <p className="rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 text-[14px] leading-relaxed text-gold-deep">
            {count === 0
              ? "구매하실 제품의 수량을 먼저 선택해 주세요."
              : `최소 주문금액은 ${formatKRW(ONCE_MIN_KRW)}입니다. 현재 상품 합계 ${formatKRW(subtotal)}이라 ${formatKRW(ONCE_MIN_KRW - subtotal)} 더 담으셔야 주문할 수 있습니다.`}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || belowMin || count === 0 || (isSpecialRegion && !acceptFresh)}
          className="w-full rounded-full bg-ink py-4 text-sm font-medium tracking-wide text-cream transition-colors hover:bg-gold-deep disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy
            ? usePortOne
              ? "결제 진행 중…"
              : "주문 접수 중…"
            : usePortOne
              ? `${formatKRW(finalPayable)} 결제하고 주문하기`
              : `${formatKRW(finalPayable)} 입금하고 주문하기`}
        </button>
        <p className="text-center text-[12px] text-mute">
          {usePortOne
            ? `결제가 확인되면 ${dispatch}에 발송됩니다.`
            : `입금이 확인되면 ${dispatch}에 정성껏 발송해 드려요.`}
        </p>
        <p className="mt-2 text-center text-[11.5px] leading-relaxed text-mute">
          신선식품 특성상 단순 변심에 의한 청약철회·교환·환불은 제한될 수 있습니다. 입금 후 발송 준비 전 취소는 전액 환불되며, 상품 하자·오배송은 교환·환불해 드립니다.
        </p>
        <p className="text-center text-[13px] text-mute">
          매주 받아보고 싶으시면{" "}
          <Link href="/#subscribe" className="text-gold-deep underline-offset-4 hover:underline">
            정기구독
          </Link>
          도 있습니다.
        </p>
      </form>
    </div>
  );
}

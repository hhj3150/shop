"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useCart, cartDeliveryDays, DELIVERY_DAY_LABEL } from "@/lib/cart";
import { getProduct, formatKRW, MIN_ORDER_KRW, PERIOD_LABEL } from "@/lib/products";
import { isSpecialDeliveryPostcode } from "@/lib/regions";
import { DEFAULT_DELIVERY_METHOD, isPickup, subShippingFor, type DeliveryMethod } from "@/lib/delivery-method";
import { createOrder, registerPayActionDeposit, revokeReferralCredit } from "@/lib/orders";
import { getSupabase } from "@/lib/supabase";
import { usableBalance, redeemableCoupons, type RewardLite } from "@/lib/referral-credit";
import { backfillProfileShipping } from "@/lib/profile";
import { useStorefrontCatalog } from "@/lib/storefront";
import { mergeProduct, isCatalogRejection } from "@/lib/storefront-merge";
import { notify } from "@/lib/notify";
import { isPortOneConfigured, startPayment, type PayMethod } from "@/lib/portone";
import { PayMethodSelect, type CheckoutMethod } from "@/components/PayMethodSelect";
import { Field } from "@/components/Field";
import { AddressSearch } from "@/components/AddressSearch";
import { Track } from "@/components/Track";
import { GiftOptions } from "@/components/GiftOptions";
import { DeliveryMethodSelect } from "@/components/DeliveryMethodSelect";
import { LoadMyInfoButton, type MyInfoFields } from "@/components/LoadMyInfo";
import { CashReceiptFields } from "@/components/CashReceiptFields";
import {
  DEFAULT_CASH_RECEIPT,
  validateCashReceipt,
  type CashReceiptType,
} from "@/lib/cash-receipt";
import type { Recipient } from "@/lib/recipients";

export default function CheckoutPage() {
  const router = useRouter();
  const { ready, user, profile } = useAuth();
  const { items, period, weeks, perDelivery, weeklyPrice, clear } = useCart();
  const { map, refresh } = useStorefrontCatalog();
  // 회당 상품 합계가 최소 주문금액 미만이면 신청 불가(버튼 비활성화 + 안내).
  const belowMin = perDelivery < MIN_ORDER_KRW;
  // 정기구독은 한 주문에 한 배송 요일만 — 요일이 섞여 있으면 신청 불가(버튼 비활성화 + 안내).
  //   요일별로 회차 금액·배송비·배송 명단이 따로 잡혀야 하므로(다요일 합산 주문은 회차/배송 오류).
  //   서버(create_subscription_order)도 같은 규칙으로 막는다 — 여기선 결제 전 능동 안내.
  const deliveryDays = cartDeliveryDays(items);
  const multiDay = deliveryDays.length > 1;
  // 장바구니 항목 중 품절·판매중지가 하나라도 있으면 제출 차단(체크아웃 진입 재검증).
  const hasBlocked = items.some((it) => {
    const p = getProduct(it.productId);
    const lp = p ? mergeProduct(p, map.get(p.id)) : null;
    return !!lp && (lp.hidden || lp.soldOut);
  });

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
  // 더블서밋 방어용 멱등키: 체크아웃당 1회 생성, 빠른 더블탭·재시도 때 같은 키를 재사용한다.
  //   주문이 완료(결제 성공·무통장 등록)되면 회전 → 다음 주문은 새 키를 쓴다.
  const idempotencyKeyRef = useRef<string | null>(null);
  const [isGift, setIsGift] = useState(false);
  const [giftMessage, setGiftMessage] = useState("");
  // 수령방법: 택배(기본) | 방문수령. 방문수령은 배송비 0·주소/선물/특수지역 동의 숨김.
  const [deliveryMethod, setDeliveryMethod] = useState<DeliveryMethod>(DEFAULT_DELIVERY_METHOD);
  const [method, setMethod] = useState<CheckoutMethod>("BANK");
  const [cashReceiptType, setCashReceiptType] = useState<CashReceiptType>(DEFAULT_CASH_RECEIPT);
  const [cashReceiptId, setCashReceiptId] = useState("");
  // 특수배송지역(제주·도서산간 등) 신선도 고지 동의.
  const [acceptFresh, setAcceptFresh] = useState(false);
  // 추천 적립금(쿠폰) 보유분 + 사용 여부. 기본 사용(선차감 정책). 끄면 주문 후 되돌린다.
  const [rewards, setRewards] = useState<RewardLite[]>([]);
  const [useReferralCredit, setUseReferralCredit] = useState(true);
  // 최소주문 미달 시: 죽은 버튼 대신, 클릭하면 금색 안내배너로 스크롤 + 잠깐 강조.
  const minNoticeRef = useRef<HTMLParagraphElement>(null);
  const [minFlash, setMinFlash] = useState(false);

  // 배송지 우편번호로 배송비를 다시 계산한다. 특수배송지역은 회당 5,000원이며
  //   서버(RPC)가 청구하는 금액과 일치시킨다. cart의 기본값(4,000원)을 덮어쓴다.
  const isSpecialRegion = isSpecialDeliveryPostcode(ship.postcode);
  const pickup = isPickup(deliveryMethod);
  const shipTotal = subShippingFor(deliveryMethod, perDelivery, ship.postcode, weeks);
  const periodTotal = perDelivery * weeks + shipTotal;

  // 추천 적립금 미리보기 — 서버(apply_referral_credit)와 동일 규칙으로 차감액을 계산해 표시한다.
  //   실제 차감은 서버 권위값. 토글을 끄면 차감 없이 전액 입금으로 보여준다.
  const creditAvailable = usableBalance(rewards, new Date().toISOString());
  const redeem = useReferralCredit
    ? redeemableCoupons({ availableCount: creditAvailable.count, orderTotal: periodTotal })
    : { useCount: 0, creditKrw: 0, payable: periodTotal };
  const finalPayable = periodTotal - redeem.creditKrw;

  // 카드·간편결제(PortOne)는 PortOne 설정 시에만, 또 선물이 아닐 때만 선택 가능하다.
  //   선물은 입금확인 문자가 받는 분에게 잘못 갈 수 있어 무통장(PayAction) 흐름으로 고정한다.
  const canPortOne = isPortOneConfigured && !isGift;
  // 실제 PortOne 결제는 무통장(BANK)이 아닌 결제수단을 골랐을 때만 사용한다.
  const usePortOne = canPortOne && method !== "BANK";

  useEffect(() => {
    if (ready && !user) router.replace("/login?next=/checkout");
  }, [ready, user, router]);

  // 프로필 정보로 배송지 초기값 채우기
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

  // 추천 적립금 잔액 조회(표시·미리보기용). 실패해도 결제는 그대로 진행된다.
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

  // 수령방법 전환. 방문수령으로 바꾸면 선물·주소·특수지역 동의를 초기화한다(택배 발송 전제 항목).
  //   주소 복원은 하지 않는다(방문수령은 주소 자체가 불필요).
  function changeDeliveryMethod(m: DeliveryMethod) {
    setDeliveryMethod(m);
    if (m === "방문수령") {
      setIsGift(false); // 선물은 택배 발송 전제 — 방문수령에선 숨김+초기화
      setShip((prev) => ({ ...prev, postcode: "", address: "", addressDetail: "" }));
      setAcceptFresh(false);
    }
  }

  // 최소주문 안내 배너로 스크롤 + 잠깐 강조(능동 피드백).
  function nudgeMinNotice() {
    minNoticeRef.current?.scrollIntoView({ behavior: "smooth", block: "center" });
    setMinFlash(true);
    setTimeout(() => setMinFlash(false), 1600);
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!user) return;
    // 최소 상품금액 미달은 가장 먼저 안내한다(클레임: 죽은 버튼 → 능동 안내).
    if (perDelivery < MIN_ORDER_KRW) {
      nudgeMinNotice();
      return;
    }
    // 다요일 혼합 주문 차단 — 한 번에 한 요일만(요일별 따로 신청). 서버도 동일하게 막는다.
    if (multiDay) {
      setError(
        `정기구독은 한 번에 한 배송 요일만 신청할 수 있어요. 지금 ${deliveryDays
          .map((d) => DELIVERY_DAY_LABEL[d])
          .join("·")}이 함께 담겨 있습니다. 요일별로 따로 신청해 주세요.`
      );
      return;
    }
    if (!ship.name.trim() || !ship.phone.trim() || (!pickup && !ship.address.trim())) {
      setError(pickup ? "받는 분, 연락처를 입력해 주세요." : "받는 분, 연락처, 주소를 입력해 주세요.");
      return;
    }
    if (!pickup && isSpecialRegion && !acceptFresh) {
      setError("제주·도서산간 등 특수배송지역은 신선도 안내에 동의하셔야 신청할 수 있습니다.");
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
      // 키 지연 생성(이벤트 핸들러 안 — 렌더 중 ref 접근 금지). 재시도 시 같은 키를 재사용.
      const idempotencyKey = (idempotencyKeyRef.current ??= crypto.randomUUID());
      const { orderId, orderNo, slots, totalAmount, referralCreditKrw } = await createOrder(items, period, {
        ...ship,
        deliveryMethod,
        isGift,
        gifterName: profile?.name ?? ship.depositorName,
        giftMessage,
        cashReceiptType,
        cashReceiptId,
      }, idempotencyKey);

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

      // 본인 주소 주문이면, 프로필의 빈 배송칸(연락처·주소)을 자동 보완 → 다음 주문부터 따라온다.
      if (profile && !isGift && !pickup) void backfillProfileShipping(profile, ship);

      // 완료 페이지로 넘길 슬롯 컨텍스트(선착순 순번 등)를 쿼리에 싣는다.
      const first = slots[0];
      const params = new URLSearchParams({ no: orderNo, amount: String(finalTotal) });
      if (finalCredit > 0) params.set("credit", String(finalCredit));
      if (first) {
        params.set("day", first.deliveryDay);
        params.set("pos", String(first.position));
        params.set("wait", first.waitlisted ? "1" : "0");
      }

      if (usePortOne) {
        // PortOne 결제창 호출. 모바일은 redirectUrl 로 이동하므로 아래 분기는 PC에서만 도달.
        // 입금확인 문자는 웹훅이 보내므로 여기서 order_received 를 보내지 않는다.
        params.set("pay", "portone");
        const redirectUrl = `${window.location.origin}/orders/complete?${params.toString()}`;
        const result = await startPayment({
          paymentId: orderNo,
          orderName: `${PERIOD_LABEL[period]} 정기구독`,
          totalAmount: finalTotal,
          payMethod: method as PayMethod,
          customerName: ship.name,
          customerPhone: ship.phone,
          redirectUrl,
        });
        if (result.ok) {
          idempotencyKeyRef.current = crypto.randomUUID(); // 결제 완료 → 다음 주문은 새 키.
          clear();
          router.push(`${redirectUrl}&paid=1`);
        } else if (result.code !== "REDIRECTING") {
          // 사용자가 취소했거나 결제 실패. 주문은 입금대기로 남아 재시도 가능.
          //   키는 회전하지 않는다 → 재제출 시 같은 키로 같은 주문을 재사용(중복 생성 방지).
          setError(result.message);
        }
        return;
      }

      // 무통장(또는 선물) 흐름: PayAction 에 주문 등록(자동 입금확인 대상으로 감시 시작).
      //   입금확인 문자 수신처: 선물이면 보내는 분(주문자) 연락처, 일반은 배송 연락처.
      const ordererPhone = isGift ? (profile?.phone ?? ship.phone) : ship.phone;
      // await 로 등록 완결 후 라우팅 — fire-and-forget 이면 router.push 로 요청이 abort 돼
      //   서버 라우트에 도달조차 못 했음. 등록 실패는 내부에서 흡수(non-fatal)되어 주문은 진행됨.
      await registerPayActionDeposit(orderNo, ordererPhone);
      // 즉시 입금 안내 문자 발송 후 완료 페이지로.
      void notify({ kind: isGift ? "gift_subscription" : "order_received", orderId });
      idempotencyKeyRef.current = crypto.randomUUID(); // 주문 접수 완료 → 다음 주문은 새 키.
      clear();
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

  if (!ready || !user) {
    return (
      <div className="mx-auto max-w-md px-5 pt-28 text-center text-mute sm:px-8">
        불러오는 중…
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="mx-auto max-w-md px-5 pb-24 pt-28 text-center sm:px-8">
        <p className="font-serif-kr text-lg text-ink">장바구니가 비어 있습니다.</p>
        <Link
          href="/#products"
          className="mt-6 inline-flex rounded-full bg-ink px-6 py-3 text-sm text-cream hover:bg-gold-deep"
        >
          제품 보러 가기
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-5 pb-24 pt-28 sm:px-8">
      <Track event="begin_checkout" once />
      <p className="eyebrow text-gold-deep">Checkout</p>
      <h1 className="mt-3 font-serif-kr text-[clamp(1.7rem,5vw,2.3rem)] font-medium text-ink">
        {PERIOD_LABEL[period]} 정기구독 신청
      </h1>
      <p className="mt-3 text-[14px] leading-relaxed text-mute">
        신청을 완료하면 다음 화면에서 <span className="text-ink-soft">{PERIOD_LABEL[period]}분({weeks}회)
        입금 금액·계좌</span>를 안내합니다. 입금 확인 후 발송하며, 준비되면 문자로 알려드립니다.
      </p>

      {/* 주문 요약 */}
      <div className="mt-8 rounded-2xl border border-line bg-cream p-5">
        <ul className="divide-y divide-line">
          {items.map((item) => {
            const p = getProduct(item.productId);
            if (!p) return null;
            const lp = mergeProduct(p, map.get(p.id));
            return (
              <li key={item.key} className="flex justify-between py-3 text-[14px]">
                <span className="text-ink-soft">
                  {p.name} {p.volume}
                  <span className="ml-2 text-[13px] text-gold-deep">
                    정기구독 · 매주 {DELIVERY_DAY_LABEL[item.deliveryDay]}
                  </span>
                  <span className="ml-2 text-mute">× {item.qty}</span>
                  {lp.hidden && <span className="ml-2 text-red-600">판매 중지</span>}
                  {lp.soldOut && <span className="ml-2 text-red-600">품절</span>}
                </span>
                <span className="tabular-nums text-ink">
                  {formatKRW(weeklyPrice(item.productId) * item.qty)}
                </span>
              </li>
            );
          })}
        </ul>
        <div className="mt-3 flex justify-between border-t border-line pt-3">
          <span className="text-mute">회당(매주) 상품 합계</span>
          <span className="tabular-nums text-ink-soft">{formatKRW(perDelivery)}</span>
        </div>
        <div className="mt-1.5 flex justify-between">
          <span className="text-mute">
            배송비 ({weeks}회)
            {!pickup && isSpecialRegion && (
              <span className="ml-1.5 text-[12px] text-gold-deep">제주·도서산간 회당 5,000원</span>
            )}
          </span>
          <span className="tabular-nums text-ink-soft">
            {pickup ? "방문수령 — 배송비 무료" : formatKRW(shipTotal)}
          </span>
        </div>
        {creditAvailable.count > 0 && (
          <div className="mt-2 border-t border-gold/20 pt-2">
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
        <div className="mt-1.5 flex justify-between">
          <span className="text-mute">{PERIOD_LABEL[period]}분({weeks}회) 입금액</span>
          <span className="font-serif-kr text-lg tabular-nums text-ink">
            {formatKRW(finalPayable)}
          </span>
        </div>
      </div>

      {/* 결제수단: PortOne 설정 시 무통장/카드/간편결제 선택, 무통장(또는 선물·미설정) 시 계좌 안내 */}
      <div className="mt-5 rounded-2xl border border-gold/40 bg-gold/5 p-5">
        {canPortOne && <PayMethodSelect value={method} onChange={setMethod} />}
        {usePortOne ? (
          <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">
            {PERIOD_LABEL[period]}분({weeks}회) {formatKRW(finalPayable)}을 한 번에 결제합니다.
            결제가 확인되는 즉시 발송이 시작됩니다.
          </p>
        ) : (
          <div className={canPortOne ? "mt-4" : ""}>
            {!canPortOne && (
              <p className="text-[13px] uppercase tracking-[0.18em] text-gold-deep">
                무통장입금
              </p>
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
        <DeliveryMethodSelect value={deliveryMethod} onChange={changeDeliveryMethod} />
        {!pickup && user && (
          <GiftOptions
            userId={user.id}
            isGift={isGift}
            giftMessage={giftMessage}
            onModeChange={setGiftMode}
            onMessageChange={setGiftMessage}
            onSelectRecipient={applyRecipient}
          />
        )}
        {!pickup && !isGift && (
          <LoadMyInfoButton profile={profile} onLoad={fillFromProfile} disabled={busy} />
        )}
        <Field id="name" label={isGift ? "받는 분 (선물 받으실 분)" : "받는 분"} required value={ship.name} onChange={(e) => update("name", e.target.value)} />
        <Field id="phone" label="연락처" hint="발송 안내 문자를 받는 번호." inputMode="numeric" required value={ship.phone} onChange={(e) => update("phone", e.target.value)} />
        {!pickup && (
          <>
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
                  있고, 그만큼 신선도가 떨어질 수 있습니다. 이 지역은 배송비가 회당 5,000원입니다.
                </p>
                <label className="mt-3 flex items-start gap-2 text-[13px] text-ink">
                  <input
                    type="checkbox"
                    checked={acceptFresh}
                    onChange={(e) => setAcceptFresh(e.target.checked)}
                    className="mt-0.5 h-4 w-4 shrink-0 accent-gold-deep"
                  />
                  <span>신선도 안내를 확인했고, 배송비 회당 5,000원에 동의합니다.</span>
                </label>
              </div>
            )}
          </>
        )}

        <Field id="depositorName" label="입금자명" hint="통장에 찍히는 이름 그대로 적어 주세요. 괄호·메모(예: (98예준))는 자동 입금 확인이 안 되니 빼 주세요." value={ship.depositorName} onChange={(e) => update("depositorName", e.target.value)} />
        <Field id="memo" label="배송 메모 (선택)" value={ship.memo} onChange={(e) => update("memo", e.target.value)} />

        <CashReceiptFields
          type={cashReceiptType}
          id={cashReceiptId}
          onTypeChange={setCashReceiptType}
          onIdChange={setCashReceiptId}
        />

        <p className="rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 text-[14px] leading-relaxed text-gold-deep">
          선택한 요일에 매주 한 번. {PERIOD_LABEL[period]}분({weeks}회)을 한 번에 입금하면
          확인 후 발송됩니다. 요일별 100명·전체 500명 한정.
        </p>

        {hasBlocked && (
          <p className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-[14px] leading-relaxed text-red-700">
            품절되었거나 판매 중지된 항목이 있습니다. 장바구니에서 해당 항목을 빼주셔야 신청할 수 있습니다.
          </p>
        )}

        {multiDay && (
          <p className="rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 text-[14px] leading-relaxed text-gold-deep">
            정기구독은 한 번에 한 배송 요일만 신청할 수 있어요. 지금{" "}
            <span className="font-medium text-ink">
              {deliveryDays.map((d) => DELIVERY_DAY_LABEL[d]).join("·")}
            </span>
            이 함께 담겨 있습니다. 요일이 다른 항목은 장바구니에서 빼고, 그 요일은 따로 신청해
            주세요. (요일별로 회차 금액·배송이 각각 잡힙니다.)
          </p>
        )}

        {error && (
          <p className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-[14px] text-red-700">
            {error}
          </p>
        )}

        {belowMin && (
          <p
            ref={minNoticeRef}
            className={
              "rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 text-[14px] leading-relaxed text-gold-deep transition-shadow" +
              (minFlash ? " ring-2 ring-gold-deep ring-offset-1 ring-offset-cream" : "")
            }
          >
            회당 최소 상품금액은 {formatKRW(MIN_ORDER_KRW)}입니다. 현재 회당{" "}
            {formatKRW(perDelivery)}이라 {formatKRW(MIN_ORDER_KRW - perDelivery)} 더 담으셔야
            신청할 수 있습니다. (배송비 별도)
          </p>
        )}

        <button
          type="submit"
          disabled={busy || hasBlocked || multiDay || (!pickup && isSpecialRegion && !acceptFresh)}
          className="w-full rounded-full bg-ink py-4 text-sm font-medium tracking-wide text-cream transition-colors hover:bg-gold-deep disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy
            ? usePortOne
              ? "결제 진행 중…"
              : "신청 접수 중…"
            : usePortOne
              ? "구독 신청하고 결제하기"
              : "구독 신청하고 입금 안내 받기"}
        </button>
        <p className="text-center text-[12px] text-mute">
          {usePortOne
            ? "결제가 확인되면 발송이 시작됩니다."
            : "입금이 확인되면 자동으로 발송해 드려요."}
        </p>
        <p className="mt-2 text-center text-[11.5px] leading-relaxed text-mute">
          신선식품 특성상 단순 변심에 의한 청약철회·교환·환불은 제한될 수 있습니다. 입금 후 발송 준비 전 취소는 전액 환불되며, 상품 하자·오배송은 교환·환불해 드립니다.
        </p>
      </form>
    </div>
  );
}

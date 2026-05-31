"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useCart, DELIVERY_DAY_LABEL } from "@/lib/cart";
import { getProduct, formatKRW, MIN_ORDER_KRW, PERIOD_LABEL } from "@/lib/products";
import { createOrder } from "@/lib/orders";
import { notify } from "@/lib/notify";
import { isPortOneConfigured, startPayment, type PayMethod } from "@/lib/portone";
import { DepositAccount } from "@/components/DepositAccount";
import { PayMethodSelect } from "@/components/PayMethodSelect";
import { Field } from "@/components/Field";
import { AddressSearch } from "@/components/AddressSearch";
import { GiftOptions } from "@/components/GiftOptions";
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
  const { items, period, weeks, perDelivery, shipTotal, periodTotal, weeklyPrice, clear } = useCart();
  // 회당 상품 합계가 최소 주문금액 미만이면 신청 불가(버튼 비활성화 + 안내).
  const belowMin = perDelivery < MIN_ORDER_KRW;

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
  const [payMethod, setPayMethod] = useState<PayMethod>("VIRTUAL_ACCOUNT");
  const [cashReceiptType, setCashReceiptType] = useState<CashReceiptType>(DEFAULT_CASH_RECEIPT);
  const [cashReceiptId, setCashReceiptId] = useState("");

  // 선물 주문은 입금확인 문자가 받는 분에게 잘못 갈 수 있어 기존 무통장 흐름을 유지한다.
  //   (선물 주문자에게는 별도 입금 안내가 나간다)
  const usePortOne = isPortOneConfigured && !isGift;

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

  function update<K extends keyof typeof ship>(key: K, value: string) {
    setShip((prev) => ({ ...prev, [key]: value }));
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
    if (!user) return;
    if (!ship.name.trim() || !ship.phone.trim() || !ship.address.trim()) {
      setError("받는 분, 연락처, 주소를 입력해 주세요.");
      return;
    }
    if (perDelivery < MIN_ORDER_KRW) {
      setError(`회당 최소 상품 금액은 ${formatKRW(MIN_ORDER_KRW)}입니다. (배송비 별도)`);
      return;
    }
    const receiptError = validateCashReceipt(cashReceiptType, cashReceiptId);
    if (receiptError) {
      setError(receiptError);
      return;
    }
    setBusy(true);
    try {
      const { orderId, orderNo, slots, totalAmount } = await createOrder(items, period, {
        ...ship,
        isGift,
        gifterName: profile?.name ?? ship.depositorName,
        giftMessage,
        cashReceiptType,
        cashReceiptId,
      });

      // 완료 페이지로 넘길 슬롯 컨텍스트(선착순 순번 등)를 쿼리에 싣는다.
      const first = slots[0];
      const params = new URLSearchParams({ no: orderNo });
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
          totalAmount,
          payMethod,
          customerName: ship.name,
          customerPhone: ship.phone,
          redirectUrl,
        });
        if (result.ok) {
          clear();
          router.push(`${redirectUrl}&paid=1`);
        } else if (result.code !== "REDIRECTING") {
          // 사용자가 취소했거나 결제 실패. 주문은 입금대기로 남아 재시도 가능.
          setError(result.message);
        }
        return;
      }

      // 무통장(또는 선물) 흐름: 즉시 입금 안내 문자 발송 후 완료 페이지로.
      void notify({ kind: isGift ? "gift_subscription" : "order_received", orderId });
      clear();
      router.push(`/orders/complete?${params.toString()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "주문에 실패했습니다.");
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
      <p className="eyebrow text-gold-deep">Checkout</p>
      <h1 className="mt-3 font-serif-kr text-[clamp(1.7rem,5vw,2.3rem)] font-medium text-ink">
        {PERIOD_LABEL[period]} 정기구독 신청
      </h1>
      <p className="mt-3 text-[14px] leading-relaxed text-mute">
        신청 후 아래 계좌로 <span className="text-ink-soft">{PERIOD_LABEL[period]}분({weeks}회)을
        한 번에</span> 입금해 주세요. 입금이 확인된 회원께만 발송하며, 발송 준비가 되면
        등록하신 번호로 안내드립니다.
      </p>

      {/* 주문 요약 */}
      <div className="mt-8 rounded-2xl border border-line bg-cream p-5">
        <ul className="divide-y divide-line">
          {items.map((item) => {
            const p = getProduct(item.productId);
            if (!p) return null;
            return (
              <li key={item.key} className="flex justify-between py-3 text-[14px]">
                <span className="text-ink-soft">
                  {p.name} {p.volume}
                  <span className="ml-2 text-[13px] text-gold-deep">
                    정기구독 · 매주 {DELIVERY_DAY_LABEL[item.deliveryDay]}
                  </span>
                  <span className="ml-2 text-mute">× {item.qty}</span>
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
          <span className="text-mute">배송비 ({weeks}회)</span>
          <span className="tabular-nums text-ink-soft">
            {formatKRW(shipTotal)}
          </span>
        </div>
        <div className="mt-1.5 flex justify-between">
          <span className="text-mute">{PERIOD_LABEL[period]}분({weeks}회) 입금액</span>
          <span className="font-serif-kr text-lg tabular-nums text-ink">
            {formatKRW(periodTotal)}
          </span>
        </div>
      </div>

      {/* 결제수단: PortOne 설정 시 결제수단 선택, 미설정/선물 시 무통장 안내 */}
      <div className="mt-5 rounded-2xl border border-gold/40 bg-gold/5 p-5">
        {usePortOne ? (
          <>
            <PayMethodSelect value={payMethod} onChange={setPayMethod} />
            <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">
              {PERIOD_LABEL[period]}분({weeks}회) {formatKRW(periodTotal)}을 한 번에 결제합니다.
              가상계좌는 입금이 확인되는 즉시 발송이 시작됩니다.
            </p>
          </>
        ) : (
          <>
            <p className="text-[13px] uppercase tracking-[0.18em] text-gold-deep">
              무통장입금 계좌
            </p>
            <DepositAccount />
            <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">
              은행 앱·창구에서 위 계좌로 {PERIOD_LABEL[period]}분({weeks}회) {formatKRW(periodTotal)}을
              한 번에 입금해 주세요. 입금 확인 후 발송이 시작됩니다.
            </p>
          </>
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
        <Field id="depositorName" label="입금자명" hint="통장 입금 대조를 위해 실제 입금하실 분의 이름을 적어 주세요." value={ship.depositorName} onChange={(e) => update("depositorName", e.target.value)} />
        <Field id="memo" label="배송 메모 (선택)" value={ship.memo} onChange={(e) => update("memo", e.target.value)} />

        <CashReceiptFields
          type={cashReceiptType}
          id={cashReceiptId}
          onTypeChange={setCashReceiptType}
          onIdChange={setCashReceiptId}
        />

        <p className="rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 text-[14px] leading-relaxed text-gold-deep">
          선택하신 요일에 매주 한 번 받으시며, {PERIOD_LABEL[period]}분({weeks}회)을
          한 번에 입금해 주시면 입금 확인 후 발송이 시작됩니다. 정기구독은 요일별 선착순
          100명, 전체 500명 한정입니다.
        </p>

        {error && (
          <p className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-[14px] text-red-700">
            {error}
          </p>
        )}

        {belowMin && (
          <p className="rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 text-[14px] leading-relaxed text-gold-deep">
            회당 최소 상품금액은 {formatKRW(MIN_ORDER_KRW)}입니다. 현재 회당{" "}
            {formatKRW(perDelivery)}이라 {formatKRW(MIN_ORDER_KRW - perDelivery)} 더 담으셔야
            신청할 수 있습니다. (배송비 별도)
          </p>
        )}

        <button
          type="submit"
          disabled={busy || belowMin}
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
            ? "결제(가상계좌 입금 포함)가 확인되면 발송이 시작됩니다."
            : "신청 시 입금 확인 대기 상태로 접수됩니다. 입금 확인 후 발송됩니다."}
        </p>
      </form>
    </div>
  );
}

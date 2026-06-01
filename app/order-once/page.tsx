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
import { createOnceOrder, createGuestOnceOrder, type OnceItem } from "@/lib/orders";
import { useStorefrontCatalog } from "@/lib/storefront";
import { visibleProducts } from "@/lib/storefront-merge";
import { notify } from "@/lib/notify";
import { isPortOneConfigured, startPayment, type PayMethod } from "@/lib/portone";
import { nextDispatchDate, formatDispatch } from "@/lib/ship-date";
import { DepositAccount } from "@/components/DepositAccount";
import { PayMethodSelect } from "@/components/PayMethodSelect";
import { Field } from "@/components/Field";
import { AddressSearch } from "@/components/AddressSearch";
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
  const [payMethod, setPayMethod] = useState<PayMethod>("VIRTUAL_ACCOUNT");
  const [cashReceiptType, setCashReceiptType] = useState<CashReceiptType>(DEFAULT_CASH_RECEIPT);
  const [cashReceiptId, setCashReceiptId] = useState("");

  const { map, loading: catalogLoading } = useStorefrontCatalog();

  // 선물 주문은 입금확인 문자가 받는 분에게 잘못 갈 수 있어 기존 무통장 흐름을 유지한다.
  const usePortOne = isPortOneConfigured && !isGift;

  // 단품 1회 구매는 비회원(게스트)도 가능하다 → 로그인 강제 리디렉션 없음.
  // 선물하기·정기구독 등 회원 전용 기능만 user 유무로 분기한다.

  // ?add=<id> 로 들어오면 해당 제품을 최소 주문금액(25,000원)을 채우는 수량으로 미리 담는다.
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
  const shipping = onceShippingFee(subtotal);
  const total = subtotal + shipping;
  const belowMin = subtotal < ONCE_MIN_KRW;

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
      const { orderId, orderNo, shipDate, totalAmount } = user
        ? await createOnceOrder(items, shipInfo)
        : await createGuestOnceOrder(items, shipInfo);
      const shipLabel = formatDispatch(new Date(`${shipDate}T00:00:00`));
      const params = new URLSearchParams({
        no: orderNo,
        type: "once",
        ship: shipLabel,
        amount: String(totalAmount),
      });
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
          totalAmount,
          payMethod,
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

      // 정보성 문자는 세션 토큰으로 인증되므로 회원 주문에서만 발송한다.
      // 비회원은 완료 페이지의 입금 안내로 갈음한다(웹훅 결제 시엔 입금확인 문자 자동 발송).
      if (user) void notify({ kind: isGift ? "gift_once" : "order_received", orderId });
      router.push(`/orders/complete?${params.toString()}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "주문에 실패했습니다.");
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
      <p className="eyebrow text-gold-deep">Single Order · 단품 구매</p>
      <h1 className="mt-3 font-serif-kr text-[clamp(1.7rem,5vw,2.3rem)] font-medium text-ink">
        한 번만, 골라 담기
      </h1>
      <p className="mt-3 text-[14px] leading-relaxed text-mute">
        구독 없이 원하는 제품만 골라 한 번 받으실 수 있습니다. 상품 합계{" "}
        <span className="text-ink-soft">{formatKRW(ONCE_MIN_KRW)} 이상</span>부터 주문되며,
        배송비는 주문 금액과 관계없이 {formatKRW(ONCE_SHIPPING_KRW)}입니다.
        입금이 확인되면 <span className="text-ink-soft">{dispatch}</span>에 발송됩니다.
        <br />
        평일(월~목) 자정까지 주문하시면 다음 날, 금요일 주문은 월요일, 주말(토·일) 주문은 화요일에 발송됩니다. (발송은 월–금)
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
                  <span className="ml-1.5 text-mute">{p.taxFree ? "면세" : "과세"}</span>
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
          <span className="text-mute">배송비</span>
          <span className="tabular-nums text-ink-soft">
            {formatKRW(shipping)}
          </span>
        </div>
        <div className="mt-3 flex items-end justify-between border-t border-line pt-3">
          <span className="text-mute">결제(입금) 금액</span>
          <span className="font-serif-kr text-xl tabular-nums text-ink">{formatKRW(total)}</span>
        </div>
        {belowMin && (
          <p className="mt-3 text-[13px] text-mute">
            상품 합계 {formatKRW(ONCE_MIN_KRW)} 이상부터 주문할 수 있습니다.
            {subtotal > 0 && ` (${formatKRW(ONCE_MIN_KRW - subtotal)} 더 담아 주세요)`}
          </p>
        )}
      </div>

      {/* 결제수단: PortOne 설정 시 결제수단 선택, 미설정/선물 시 무통장 안내 */}
      <div className="mt-5 rounded-2xl border border-gold/40 bg-gold/5 p-5">
        {usePortOne ? (
          <>
            <PayMethodSelect value={payMethod} onChange={setPayMethod} />
            <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">
              {formatKRW(total)}을 결제합니다. 가상계좌는 입금이 확인되는 즉시 발송됩니다.
            </p>
          </>
        ) : (
          <>
            <p className="text-[13px] uppercase tracking-[0.18em] text-gold-deep">입금 계좌</p>
            <DepositAccount />
            <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">
              주문 후 위 계좌로 {formatKRW(total)}을 입금해 주세요. 입금이 확인되면 발송됩니다.
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
          disabled={busy || belowMin || count === 0 || catalogLoading}
          className="w-full rounded-full bg-ink py-4 text-sm font-medium tracking-wide text-cream transition-colors hover:bg-gold-deep disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy
            ? usePortOne
              ? "결제 진행 중…"
              : "주문 접수 중…"
            : usePortOne
              ? `${formatKRW(total)} 결제하고 주문하기`
              : `${formatKRW(total)} 입금하고 주문하기`}
        </button>
        <p className="text-center text-[12px] text-mute">
          {usePortOne
            ? `결제(가상계좌 입금 포함)가 확인되면 ${dispatch}에 발송됩니다.`
            : `무통장입금 주문입니다. 입금 확인 후 ${dispatch}에 발송됩니다.`}
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

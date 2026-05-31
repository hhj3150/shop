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
  ONCE_FREE_SHIP_KRW,
  onceShippingFee,
} from "@/lib/products";
import { createOnceOrder, type OnceItem } from "@/lib/orders";
import { notify } from "@/lib/notify";
import { nextDispatchDate, formatDispatch } from "@/lib/ship-date";
import { DepositAccount } from "@/components/DepositAccount";
import { Field } from "@/components/Field";
import { AddressSearch } from "@/components/AddressSearch";
import { GiftOptions } from "@/components/GiftOptions";
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

  useEffect(() => {
    if (ready && !user) router.replace("/login?next=/order-once");
  }, [ready, user, router]);

  // ?add=<id> 로 들어오면 해당 제품 1개를 미리 담는다.
  useEffect(() => {
    const add = sp.get("add");
    if (add && getProduct(add)) {
      setQtys((prev) => (prev[add] ? prev : { ...prev, [add]: 1 }));
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
      PRODUCTS.reduce((sum, p) => sum + p.price * (qtys[p.id] ?? 0), 0),
    [qtys]
  );
  const count = useMemo(
    () => PRODUCTS.reduce((n, p) => n + (qtys[p.id] ?? 0), 0),
    [qtys]
  );
  const shipping = onceShippingFee(subtotal);
  const total = subtotal + shipping;
  const belowMin = subtotal < ONCE_MIN_KRW;
  const freeShip = subtotal >= ONCE_FREE_SHIP_KRW;

  const dispatch = useMemo(() => formatDispatch(nextDispatchDate()), []);

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
    setBusy(true);
    try {
      const items: OnceItem[] = PRODUCTS.filter((p) => (qtys[p.id] ?? 0) > 0).map(
        (p) => ({ productId: p.id, qty: qtys[p.id], unitPrice: p.price })
      );
      const { orderId, orderNo, shipDate } = await createOnceOrder(items, {
        ...ship,
        isGift,
        gifterName: profile?.name ?? ship.depositorName,
        giftMessage,
      });
      void notify({ kind: isGift ? "gift_once" : "order_received", orderId });
      const shipLabel = formatDispatch(new Date(`${shipDate}T00:00:00`));
      const params = new URLSearchParams({ no: orderNo, type: "once", ship: shipLabel });
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

  return (
    <div className="mx-auto max-w-2xl px-5 pb-24 pt-28 sm:px-8">
      <p className="eyebrow text-gold-deep">Single Order · 단품 구매</p>
      <h1 className="mt-3 font-serif-kr text-[clamp(1.7rem,5vw,2.3rem)] font-medium text-ink">
        한 번만, 골라 담기
      </h1>
      <p className="mt-3 text-[14px] leading-relaxed text-mute">
        구독 없이 원하는 제품만 골라 한 번 받으실 수 있습니다. 상품 합계{" "}
        <span className="text-ink-soft">{formatKRW(ONCE_MIN_KRW)} 이상</span>부터 주문되며,
        배송비는 {formatKRW(ONCE_SHIPPING_KRW)}, {formatKRW(ONCE_FREE_SHIP_KRW)} 이상 구매 시 무료입니다.
        입금이 확인되면 <span className="text-ink-soft">{dispatch}</span>에 발송됩니다.
        <br />
        평일(월~목) 자정까지 주문하시면 다음 날, 금요일 주문은 월요일, 주말(토·일) 주문은 화요일에 발송됩니다. (발송은 월–금)
      </p>

      {/* 제품 선택 */}
      <ul className="mt-8 space-y-3">
        {PRODUCTS.map((p) => {
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
                  className="px-3.5 py-2 text-mute transition-colors hover:text-ink"
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
            {freeShip ? (
              <span className="text-gold-deep">무료배송</span>
            ) : (
              formatKRW(shipping)
            )}
          </span>
        </div>
        {!freeShip && subtotal > 0 && (
          <p className="mt-1.5 text-[13px] text-mute">
            {formatKRW(ONCE_FREE_SHIP_KRW)} 이상 구매 시 무료배송
            {` (${formatKRW(ONCE_FREE_SHIP_KRW - subtotal)} 더 담으면 무료)`}
          </p>
        )}
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

      {/* 입금 계좌 */}
      <div className="mt-5 rounded-2xl border border-gold/40 bg-gold/5 p-5">
        <p className="text-[13px] uppercase tracking-[0.18em] text-gold-deep">입금 계좌</p>
        <DepositAccount />
        <p className="mt-3 text-[13px] leading-relaxed text-ink-soft">
          주문 후 위 계좌로 {formatKRW(total)}을 입금해 주세요. 입금이 확인되면 발송됩니다.
        </p>
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

        {error && (
          <p className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-[14px] text-red-700">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy || belowMin || count === 0}
          className="w-full rounded-full bg-ink py-4 text-sm font-medium tracking-wide text-cream transition-colors hover:bg-gold-deep disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "주문 접수 중…" : `${formatKRW(total)} 입금하고 주문하기`}
        </button>
        <p className="text-center text-[12px] text-mute">
          무통장입금 주문입니다. 입금 확인 후 {dispatch}에 발송됩니다.
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

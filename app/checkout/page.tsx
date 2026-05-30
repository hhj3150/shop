"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { useCart, DELIVERY_DAY_LABEL, FREQUENCY_LABEL } from "@/lib/cart";
import { getProduct, formatKRW } from "@/lib/products";
import { createOrder } from "@/lib/orders";
import { DEPOSIT } from "@/lib/site";
import { Field } from "@/components/Field";

export default function CheckoutPage() {
  const router = useRouter();
  const { ready, user, profile } = useAuth();
  const { items, subtotal, clear } = useCart();

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

  const hasSub = items.some((i) => i.mode === "sub");

  function update<K extends keyof typeof ship>(key: K, value: string) {
    setShip((prev) => ({ ...prev, [key]: value }));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (!user) return;
    if (!ship.name.trim() || !ship.phone.trim() || !ship.address.trim()) {
      setError("받는 분, 연락처, 주소를 입력해 주세요.");
      return;
    }
    setBusy(true);
    try {
      const { orderNo } = await createOrder(user.id, items, ship);
      clear();
      router.push(`/orders/complete?no=${encodeURIComponent(orderNo)}`);
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
        무통장입금 주문
      </h1>
      <p className="mt-3 text-[14px] leading-relaxed text-mute">
        주문 후 아래 계좌로 입금하시면, 목장에서 입금을 확인한 뒤 발송 준비를
        시작하고 <span className="text-ink-soft">문자로 안내</span>해 드립니다.
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
                  <span className="ml-2 text-[12px] text-gold-deep">
                    {item.mode === "sub"
                      ? `정기구독 · ${FREQUENCY_LABEL[item.frequency ?? "weekly"]} ${DELIVERY_DAY_LABEL[item.deliveryDay ?? "tue"]}`
                      : "1회 구매"}
                  </span>
                  <span className="ml-2 text-mute">× {item.qty}</span>
                </span>
                <span className="tabular-nums text-ink">
                  {formatKRW(item.unitPrice * item.qty)}
                </span>
              </li>
            );
          })}
        </ul>
        <div className="mt-3 flex justify-between border-t border-line pt-3">
          <span className="text-mute">합계</span>
          <span className="font-serif-kr text-lg tabular-nums text-ink">
            {formatKRW(subtotal)}
          </span>
        </div>
      </div>

      {/* 입금 계좌 */}
      <div className="mt-5 rounded-2xl border border-gold/40 bg-gold/5 p-5">
        <p className="text-[12px] uppercase tracking-[0.18em] text-gold-deep">
          입금 계좌
        </p>
        <p className="mt-2 font-serif-kr text-lg text-ink">
          {DEPOSIT.bank} {DEPOSIT.account}
        </p>
        <p className="mt-0.5 text-[13px] text-mute">예금주 {DEPOSIT.holder}</p>
      </div>

      {/* 배송지 */}
      <form onSubmit={onSubmit} className="mt-8 space-y-5">
        <Field id="name" label="받는 분" required value={ship.name} onChange={(e) => update("name", e.target.value)} />
        <Field id="phone" label="연락처" hint="발송 안내 문자를 받는 번호." inputMode="numeric" required value={ship.phone} onChange={(e) => update("phone", e.target.value)} />
        <Field id="postcode" label="우편번호" inputMode="numeric" value={ship.postcode} onChange={(e) => update("postcode", e.target.value)} />
        <Field id="address" label="주소" required value={ship.address} onChange={(e) => update("address", e.target.value)} />
        <Field id="addressDetail" label="상세 주소" value={ship.addressDetail} onChange={(e) => update("addressDetail", e.target.value)} />
        <Field id="depositorName" label="입금자명" hint="통장 입금 대조를 위해 실제 입금하실 분의 이름을 적어 주세요." value={ship.depositorName} onChange={(e) => update("depositorName", e.target.value)} />
        <Field id="memo" label="배송 메모 (선택)" value={ship.memo} onChange={(e) => update("memo", e.target.value)} />

        {hasSub && (
          <p className="rounded-xl border border-gold/40 bg-gold/10 px-4 py-3 text-[13px] leading-relaxed text-gold-deep">
            정기구독은 선택한 주기·요일로 받으시며, 최소 4회 이후 언제든 해지하실
            수 있습니다. 정기구독은 선착순 1,000명 한정입니다.
          </p>
        )}

        {error && (
          <p className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-[13px] text-red-700">
            {error}
          </p>
        )}

        <button
          type="submit"
          disabled={busy}
          className="w-full rounded-full bg-ink py-4 text-sm font-medium tracking-wide text-cream transition-colors hover:bg-gold-deep disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "주문 접수 중…" : "주문하고 입금 안내 받기"}
        </button>
        <p className="text-center text-[11px] text-mute">
          주문 시 입금 대기 상태로 접수됩니다. 입금 확인 후 발송됩니다.
        </p>
      </form>
    </div>
  );
}

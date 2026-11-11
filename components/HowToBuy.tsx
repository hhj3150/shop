import Link from "next/link";
import {
  MIN_ORDER_KRW,
  ONCE_MIN_KRW,
  ONCE_SHIPPING_KRW,
  SUB_SHIPPING_KRW,
  SUB_TOTAL_CAP,
  discountRangeLabel,
  formatKRW,
  periodWeeksList,
} from "@/lib/products";

// 사는 방법 두 가지 — 상품 목록 바로 아래.
//   ★ 왜 필요한가: 홈의 상품 카드는 전부 '구독 신청'이었고 가입 화면은 "회원으로 모신
//     분께만 닿습니다"라고 말하는데, 실제로는 회원가입 없이 한 번만 살 수 있다.
//     2026-10-28~11-10 퍼널에서 결제 시작 27건 중 16건이 1회 구매였다 — 입구가 홈에
//     없는데도 그랬다. 처음 온 손님이 '가입해야만 살 수 있나'를 묻지 않게 한다.
//   ★ 숫자(최소금액·배송비·할인율·정원)는 전부 lib/products 에서 온다. 여기 적지 않는다.
export function HowToBuy() {
  const ways = [
    {
      key: "once",
      eyebrow: "한 번만",
      title: "1회 구매",
      lead: "회원가입 없이, 드셔 보고 싶은 만큼 한 번.",
      rows: [
        ["가격", "정가"],
        ["최소 주문", `상품 합계 ${formatKRW(ONCE_MIN_KRW)} 이상`],
        ["배송비", `${formatKRW(ONCE_SHIPPING_KRW)}`],
        ["발송", "입금 확인 다음 영업일"],
      ],
      href: "/order-once",
      cta: "1회 구매하기",
      primary: false,
    },
    {
      key: "sub",
      eyebrow: `창립 ${SUB_TOTAL_CAP}인 회원`,
      title: "정기구독",
      lead: "고른 요일에 매주 한 번, 회원가로.",
      rows: [
        ["가격", `정가에서 ${discountRangeLabel()}% 할인`],
        ["기간", `${periodWeeksList()}주 중 선택 · 한 번에 입금`],
        ["최소 주문", `회당 정가 ${formatKRW(MIN_ORDER_KRW)} 이상`],
        ["배송비", `회당 ${formatKRW(SUB_SHIPPING_KRW)}`],
      ],
      href: "/#subscribe",
      cta: "정기구독 안내 보기",
      primary: true,
    },
  ] as const;

  return (
    <section id="how-to-buy" className="scroll-mt-20 border-y border-line bg-paper-2/40">
      <div className="mx-auto max-w-5xl px-5 py-12 sm:px-8 sm:py-16">
        <p className="eyebrow text-center text-gold-deep">How to buy</p>
        <h2 className="t-title2 mt-3 text-center font-serif-kr font-medium text-ink">
          한 번만, 또는 매주.
        </h2>
        <div className="mt-8 grid gap-4 sm:grid-cols-2">
          {ways.map((w) => (
            <div key={w.key} className="flex flex-col rounded-3xl border border-line bg-cream p-6 sm:p-7">
              <p className="t-caption font-semibold uppercase tracking-[0.18em] text-gold-deep">{w.eyebrow}</p>
              <h3 className="t-title3 mt-1.5 font-serif-kr font-medium text-ink">{w.title}</h3>
              <p className="t-footnote mt-1.5 text-ink-soft">{w.lead}</p>
              <dl className="mt-5 flex-1 divide-y divide-line border-y border-line">
                {w.rows.map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-4 py-2.5">
                    <dt className="t-caption shrink-0 text-mute">{k}</dt>
                    <dd className="t-footnote text-right text-ink tabular-nums">{v}</dd>
                  </div>
                ))}
              </dl>
              <Link
                href={w.href}
                className={`t-footnote mt-5 flex min-h-12 items-center justify-center rounded-full px-6 font-medium tracking-wide transition-colors ${
                  w.primary
                    ? "bg-ink text-cream hover:bg-gold-deep"
                    : "border border-ink/25 bg-cream text-ink hover:border-gold hover:text-gold-deep"
                }`}
              >
                {w.cta}
              </Link>
            </div>
          ))}
        </div>
        <p className="t-caption mt-5 text-center text-mute">
          제주·도서산간은 배송비가 다릅니다 · 1회 구매로 드셔 보신 뒤 정기구독으로 바꾸실 수 있습니다.
        </p>
      </div>
    </section>
  );
}

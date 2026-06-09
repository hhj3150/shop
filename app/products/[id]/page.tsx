import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import {
  PRODUCTS,
  getProduct,
  SUB_PERIODS,
  discountForPeriod,
} from "@/lib/products";
import { PurchasePanel } from "@/components/PurchasePanel";
import { Track } from "@/components/Track";
import { ProductHeroPrice } from "@/components/ProductCommercial";
import { ProductReviews } from "@/components/ProductReviews";
import { Footer } from "@/components/Footer";
import { Reveal } from "@/components/Reveal";
import { SwipeNav } from "@/components/SwipeNav";
import { JsonLd } from "@/components/JsonLd";
import { buildProduct } from "@/lib/seo/schema";

export function generateStaticParams() {
  return PRODUCTS.map((p) => ({ id: p.id }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  const product = getProduct(id);
  if (!product) return { title: "제품을 찾을 수 없습니다" };
  const title = `${product.name} ${product.volume}`;
  const url = `/products/${product.id}`;
  // 제품별 canonical + OG/트위터 이미지. metadataBase(SITE_URL)가 상대경로를 절대화한다.
  return {
    title,
    description: product.shortDesc,
    alternates: { canonical: url },
    openGraph: {
      title,
      description: product.shortDesc,
      type: "website",
      locale: "ko_KR",
      url,
      images: [product.image],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description: product.shortDesc,
      images: [product.image],
    },
  };
}

export default async function ProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const product = getProduct(id);
  if (!product) notFound();

  const related = PRODUCTS.filter((p) => p.id !== product.id);

  const idx = PRODUCTS.findIndex((p) => p.id === product.id);
  const prev = PRODUCTS[(idx - 1 + PRODUCTS.length) % PRODUCTS.length];
  const next = PRODUCTS[(idx + 1) % PRODUCTS.length];

  // 정기구독 최대 회원 할인율(가장 긴 기간 기준) — 히어로 카피에 노출.
  const maxRate = Math.round(
    discountForPeriod(SUB_PERIODS[SUB_PERIODS.length - 1]) * 100
  );

  return (
    <SwipeNav prevHref={`/products/${prev.id}`} nextHref={`/products/${next.id}`}>
      <JsonLd data={buildProduct(product)} />
      <Track event="view_product" />
      {/* 브레드크럼 */}
      <div className="mx-auto max-w-7xl px-5 pt-24 sm:px-8">
        <nav className="py-5 text-[13.5px] tracking-wide text-mute">
          <Link href="/" className="hover:text-gold">홈</Link>
          <span className="mx-2">/</span>
          <Link href="/#products" className="hover:text-gold">제품</Link>
          <span className="mx-2">/</span>
          <span className="text-ink-soft">{product.name} {product.volume}</span>
        </nav>
      </div>

      {/* 애플식 풀블리드 히어로 — 큰 타이포 + 큰 이미지 + 가격 + 구성 앵커 */}
      <section className="overflow-hidden pb-1 pt-2 text-center">
        <div className="mx-auto max-w-xl px-5 sm:px-8">
          {/* 영문 카테고리 */}
          <p className="text-[12px] font-medium uppercase tracking-[0.28em] text-gold-deep">
            {product.nameEn}
          </p>
          {/* 제품명 — 핵심. 콤팩트하고 우아하게. */}
          <h1 className="mt-1.5 font-serif-kr text-[clamp(1.5rem,3.6vw,2rem)] font-medium leading-[1.18] tracking-[-0.01em] text-ink">
            {product.name}
            <span className="ml-2 align-baseline text-[0.62em] font-semibold tracking-tight text-gold-deep lining-nums tabular-nums">
              {product.volume}
            </span>
          </h1>
          {/* 브랜드 한 줄(보조) */}
          <p className="mx-auto mt-2 max-w-md font-serif-kr text-[13.5px] leading-relaxed text-ink-soft">
            {product.tagline}{" "}
            <span className="font-display italic text-gold">{product.taglineEm}</span>
          </p>
          <ProductHeroPrice product={product} maxRate={maxRate} />
          <div className="mt-4 flex flex-wrap items-center justify-center gap-3">
            <a
              href="#configure"
              className="inline-flex items-center gap-1.5 rounded-full bg-ink px-6 py-3 text-sm font-medium tracking-wide text-cream transition-colors hover:bg-gold-deep"
            >
              정기구독 신청 <span aria-hidden>↓</span>
            </a>
            <Link
              href={`/order-once?add=${product.id}`}
              className="inline-flex items-center gap-1.5 rounded-full border border-ink/25 bg-cream px-6 py-3 text-sm font-medium tracking-wide text-ink transition-colors hover:border-gold hover:text-gold-deep"
            >
              단품구매
            </Link>
          </div>
        </div>
      </section>

      {/* 구성 — 좌측 고정 이미지·스토리 / 우측 가이드형 옵션 패널 */}
      <div id="configure" className="mx-auto max-w-7xl scroll-mt-24 px-5 pb-8 pt-14 sm:px-8">
        <div className="grid gap-10 lg:grid-cols-2 lg:gap-16">
          {/* Image (sticky) */}
          <div className="lg:sticky lg:top-24 lg:self-start">
            <div className="relative aspect-[4/5] overflow-hidden rounded-[2rem] bg-paper">
              <Image
                src={product.image}
                alt={`${product.name} ${product.volume}`}
                width={1200}
                height={1200}
                priority
                sizes="(max-width:1024px) 92vw, 46vw"
                className="h-full w-full object-contain p-8 sm:p-10"
              />
            </div>
          </div>

          {/* 옵션 패널 — 바로 구매로(군더더기 텍스트 제거) */}
          <div className="flex flex-col">
            <div>
              <PurchasePanel product={product} />
            </div>

            {/* Specs — quick reference */}
            <dl className="mt-10 divide-y divide-line border-y border-line">
              {product.specs.map((s) => (
                <div key={s.label} className="flex items-baseline justify-between gap-4 py-4">
                  <dt className="shrink-0 text-[13px] uppercase tracking-[0.18em] text-mute">{s.label}</dt>
                  <dd className="min-w-0 break-keep text-right text-[14px] text-ink">{s.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>

      {/* 구매평 — 별점 후기 */}
      <ProductReviews productId={product.id} />

      {/* 법정 제품표시사항 */}
      <section className="mx-auto max-w-3xl px-5 py-20 sm:px-8">
        <Reveal>
          <p className="eyebrow text-gold-deep">Product Information</p>
          <h2 className="mt-3 font-serif-kr text-xl font-medium text-ink">제품표시사항</h2>
        </Reveal>
        <dl className="mt-8 divide-y divide-line border-y border-line text-[14px]">
          {(
            [
              ["제품명", `${product.name} ${product.volume}`],
              ["식품유형", product.label.type],
              ["원재료명", product.label.ingredients],
              ["내용량", product.label.content],
              ["보관방법", product.label.storage],
              ["포장재질", product.label.packaging],
              ["소비기한", product.label.shelf],
              ["제조원·판매원", product.label.maker],
              ["소비자상담", "031-674-3150 · 010-6642-5042"],
            ] as const
          ).map(([k, v]) => (
            <div key={k} className="grid grid-cols-[7rem_1fr] gap-4 py-3.5 sm:grid-cols-[9rem_1fr]">
              <dt className="text-[13px] uppercase tracking-[0.14em] text-mute">{k}</dt>
              <dd className="text-ink-soft">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 text-[11.5px] leading-relaxed text-mute">
          ※ 본 제품은 식품의 표시기준에 따라 표시되었으며, 부정·불량식품 신고는 국번 없이 1399.
          소비기한·중량 등 상세 표기는 수령하신 제품의 라벨을 따릅니다.
        </p>

        {/* 영양정보 */}
        <div className="mt-14">
          <Reveal>
            <h3 className="font-serif-kr text-lg font-medium text-ink">
              영양정보{" "}
              <span className="text-[13px] font-normal text-mute">({product.nutrition.basis})</span>
            </h3>
          </Reveal>
          <table className="mt-6 w-full border-y border-line text-[14px]">
            <caption className="sr-only">
              {product.name} {product.volume} 영양정보 ({product.nutrition.basis})
            </caption>
            <thead>
              <tr className="border-b border-line text-[12px] uppercase tracking-[0.12em] text-mute">
                <th scope="col" className="py-3 text-left font-medium">영양성분</th>
                <th scope="col" className="py-3 text-right font-medium">함량</th>
                <th scope="col" className="py-3 text-right font-medium">% 영양성분기준치</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              <tr>
                <th scope="row" className="py-3 text-left font-medium text-ink">총 열량</th>
                <td className="py-3 text-right text-ink">{product.nutrition.calories}</td>
                <td className="py-3 text-right text-mute" aria-hidden>—</td>
              </tr>
              {product.nutrition.rows.map((r) => (
                <tr key={r.label}>
                  <th scope="row" className="py-3 text-left font-normal text-ink-soft">{r.label}</th>
                  <td className="py-3 text-right text-ink-soft">{r.amount}</td>
                  <td className="py-3 text-right text-mute">{r.percent}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-4 text-[11.5px] leading-relaxed text-mute">
            ※ % 영양성분기준치는 1일 영양성분 기준치에 대한 비율이므로 개인의 필요 열량에 따라 다를 수 있습니다.
          </p>
        </div>
      </section>

      {/* Related */}
      <section className="mx-auto max-w-7xl px-5 py-24 sm:px-8">
        <Reveal>
          <p className="eyebrow">More from the farm</p>
          <h2 className="mt-4 font-serif-kr text-2xl font-medium text-ink">함께 보면 좋은 제품</h2>
        </Reveal>
        <div className="mt-10 grid grid-cols-1 gap-6 sm:grid-cols-3">
          {related.map((p, i) => (
            <Reveal key={p.id} delay={i * 80}>
              <Link
                href={`/products/${p.id}`}
                className="group flex h-full flex-col overflow-hidden rounded-3xl border border-line bg-cream transition-all duration-500 hover:-translate-y-1.5 hover:shadow-[0_24px_48px_-20px_rgba(40,30,15,0.25)]"
              >
                <div className="relative h-56 overflow-hidden bg-paper">
                  <Image
                    src={p.image}
                    alt={`${p.name} ${p.volume}`}
                    width={600}
                    height={600}
                    sizes="(max-width:640px) 90vw, 30vw"
                    className="h-full w-full object-contain p-4 transition-transform duration-700 group-hover:scale-[1.05]"
                  />
                </div>
                <div className="border-t border-line p-5">
                  <p className="text-[12px] uppercase tracking-[0.2em] text-mute">{p.volume}</p>
                  <h3 className="mt-2 font-serif-kr text-base text-ink">
                    {p.tagline}{" "}
                    <span className="font-display italic text-gold">{p.taglineEm}</span>
                  </h3>
                </div>
              </Link>
            </Reveal>
          ))}
        </div>
      </section>

      <Footer />
    </SwipeNav>
  );
}

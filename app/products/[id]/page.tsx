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
import { ProductKicker, ProductHighlights } from "@/components/ProductHighlights";
import { ProductReviews } from "@/components/ProductReviews";
import { TrustBadges } from "@/components/TrustBadges";
import { ProductSignature } from "@/components/ProductSignature";
import { Footer } from "@/components/Footer";
import { Reveal } from "@/components/Reveal";
import { SwipeNav } from "@/components/SwipeNav";
import { JsonLd } from "@/components/JsonLd";
import { buildProduct } from "@/lib/seo/schema";
import { createClient } from "@supabase/supabase-js";
import { reviewSummary, type ReviewRow } from "@/lib/reviews";

// 서버 컴포넌트에서 별점 집계를 위해 후기를 읽는다. lib/supabase.ts 의 getSupabase()는
// "use client" 브라우저 전용 클라이언트(persistSession)라 서버에서 쓸 수 없으므로,
// anon 키로 최소 서버 클라이언트를 인라인 생성한다(service_role 사용 금지).
// list_reviews 는 SECURITY DEFINER RPC 라 anon 으로도 호출 가능.
async function fetchRatingSummary(
  productId: string
): Promise<{ value: number; count: number }> {
  try {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!url || !anonKey) {
      throw new Error(
        "Supabase 환경변수가 없습니다. NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY를 설정하세요."
      );
    }
    const supabase = createClient(url, anonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await supabase.rpc("list_reviews", {
      p_product_id: productId,
    });
    if (error) throw new Error(error.message);
    const summary = reviewSummary((data ?? []) as ReviewRow[]);
    return { value: summary.average, count: summary.count };
  } catch (err) {
    // 후기 조회 실패가 제품 페이지를 깨뜨리지 않도록 별점 없이 계속 진행.
    console.error("제품 별점 집계 실패:", err);
    return { value: 0, count: 0 };
  }
}

export function generateStaticParams() {
  return PRODUCTS.map((p) => ({ id: p.id }));
}

// ISR: 정적 프리렌더(빠름) + 1시간마다 런타임 재생성. 새 리뷰의 별점(JSON-LD
//   aggregateRating)이 재배포 없이도 갱신되게 한다. (Cache Components 미사용 →
//   route segment config 사용 가능 — node_modules/next 문서 확인.)
export const revalidate = 3600;

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

  // 별점 집계(서버) + 가격 유효일(올해 말). buildProduct 는 순수 함수라 날짜를 여기서 계산해 주입한다.
  const rating = await fetchRatingSummary(product.id);
  const priceValidUntil = `${new Date().getFullYear()}-12-31`;

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
      <JsonLd data={buildProduct(product, { rating, priceValidUntil })} />
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

      {/* 애플식 히어로 — 데스크톱은 이미지·정보 2단 구도, 모바일은 정보→이미지 1단.
          이미지를 히어로로 끌어올려 와이드 화면의 빈 여백을 제품으로 채운다. */}
      <section className="overflow-hidden pb-1 pt-2">
        <div className="mx-auto max-w-xl px-5 sm:px-8 lg:max-w-7xl lg:pt-6">
          <div className="text-center lg:grid lg:grid-cols-2 lg:items-center lg:gap-16 lg:text-left">
            {/* 이미지 — 모바일에서 먼저(제품을 바로 보이게) / 데스크톱은 왼쪽 */}
            {/*   모바일은 높이를 제한해 제품과 구매 버튼이 한 화면에 함께 보이게 한다. */}
            <div className="lg:order-first">
              <div className="relative mx-auto h-[44vh] max-w-md overflow-hidden rounded-[2rem] bg-paper lg:h-auto lg:aspect-[4/5] lg:max-w-none">
                <Image
                  src={product.image}
                  alt={`${product.name} ${product.volume}`}
                  width={1200}
                  height={1200}
                  priority
                  sizes="(max-width:1024px) 92vw, 46vw"
                  className="h-full w-full object-contain p-6 sm:p-10"
                />
              </div>
            </div>
            {/* 정보 — 모바일에선 이미지 아래(구매 CTA 먼저, 설명은 그 뒤) / 데스크톱은 오른쪽 */}
            <div className="mt-8 lg:order-last lg:mt-0">
              {/* 영문 카테고리 */}
              <p className="text-[12px] font-medium uppercase tracking-[0.28em] text-gold-deep">
                {product.nameEn}
              </p>
              {/* 제품명 — 핵심. 데스크톱에서 더 크게 화면을 장악. */}
              <h1 className="mt-1.5 font-serif-kr text-[clamp(1.5rem,3.6vw,2.6rem)] font-medium leading-[1.16] tracking-[-0.01em] text-ink">
                {product.name}
                <span className="ml-2 align-baseline text-[0.62em] font-semibold tracking-tight text-gold-deep lining-nums tabular-nums">
                  {product.volume}
                </span>
              </h1>
              {/* 브랜드 한 줄 — 0.01% 선언(태그라인 대체) */}
              <ProductKicker highlights={product.highlights} />
              <ProductHeroPrice product={product} maxRate={maxRate} />
              <div className="mt-4 flex flex-wrap items-center justify-center gap-3 lg:justify-start">
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
              {/* 히어로 요약 — 0.01% 선언 + 무선 스펙시트(효능 표현 없이 사실만) */}
              <ProductHighlights highlights={product.highlights} />
            </div>
          </div>
        </div>
      </section>

      {/* 시그니처 증명 — 제품별 대표 수치 하나를 크게(우유=오메가 2:1, 요거트=병당 유산균) */}
      <ProductSignature signature={product.signature} />

      {/* 구매 — 데스크톱은 우측 스티키 구매카드 + 좌측 보조콘텐츠 2단, 모바일은 현행 세로 흐름 유지 */}
      <div className="lg:mx-auto lg:grid lg:max-w-7xl lg:grid-cols-[1fr_400px] lg:items-start lg:gap-12 lg:px-8 lg:pt-12">
        {/* 구매 카드 — DOM 앞(모바일 맨 위) / 데스크톱 우측 스티키.
            data-swipe-ignore: 구매 중 좌우 스와이프가 제품 이동으로 잡혀 선택이 초기화되지 않도록 제외. */}
        <div
          id="configure"
          data-swipe-ignore
          className="mx-auto max-w-xl scroll-mt-24 px-5 pt-12 sm:px-8 lg:order-last lg:mx-0 lg:max-w-none lg:px-0 lg:pt-0 lg:sticky lg:top-24"
        >
          <PurchasePanel product={product} />
        </div>

        {/* 보조 콘텐츠 — DOM 뒤(모바일 구매카드 아래) / 데스크톱 좌측 스크롤 */}
        <div className="lg:order-first lg:min-w-0">
          {/* 신뢰 단서 — 구매 결정 지점(모바일에선 구매카드 바로 아래) */}
          <div className="mx-auto mt-10 max-w-xl px-5 sm:px-8 lg:mx-0 lg:mt-0 lg:max-w-none lg:px-0">
            <TrustBadges />
          </div>

          {/* Specs — quick reference */}
          <div className="mx-auto mt-12 max-w-xl px-5 sm:px-8 lg:mx-0 lg:mt-14 lg:max-w-none lg:px-0">
            <p className="eyebrow text-gold-deep">Specification</p>
            <dl className="mt-5 divide-y divide-line border-t border-line">
              {product.specs.map((s) => (
                <div key={s.label} className="flex items-baseline justify-between gap-4 py-5">
                  <dt className="shrink-0 text-[11px] uppercase tracking-[0.22em] text-mute">{s.label}</dt>
                  <dd className="min-w-0 break-keep text-right font-serif-kr text-[15.5px] text-ink-soft">{s.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* 구매평 — 별점 후기 */}
          <ProductReviews productId={product.id} />

          {/* 법정 제품표시사항 · 영양정보 — 기본 접힘으로 핵심 구매를 위로, 페이지를 짧게 */}
          <section className="mx-auto max-w-3xl px-5 py-20 sm:px-8 lg:mx-0 lg:max-w-none lg:px-0 lg:py-16">
        <Reveal>
          <p className="eyebrow text-gold-deep">Product Information</p>
        </Reveal>
        <div className="mt-5 divide-y divide-line border-y border-line">
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between py-5 font-serif-kr text-xl font-medium text-ink [&::-webkit-details-marker]:hidden">
            제품표시사항
            <svg className="h-4 w-4 shrink-0 text-mute transition-transform duration-300 group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </summary>
          <div className="pb-6">
        <dl className="divide-y divide-line border-y border-line text-[14px]">
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
          </div>
        </details>

        {/* 영양정보 */}
        <details className="group">
          <summary className="flex cursor-pointer list-none items-center justify-between py-5 font-serif-kr text-xl font-medium text-ink [&::-webkit-details-marker]:hidden">
            <span>영양정보 <span className="text-[13px] font-normal text-mute">({product.nutrition.basis})</span></span>
            <svg className="h-4 w-4 shrink-0 text-mute transition-transform duration-300 group-open:rotate-180" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <path d="M6 9l6 6 6-6" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </summary>
          <div className="pb-6">
          <table className="w-full border-y border-line text-[14px]">
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
        </details>
        </div>
          </section>
        </div>
      </div>

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

import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { PRODUCTS, getProduct } from "@/lib/products";
import { PurchasePanel } from "@/components/PurchasePanel";
import { WhyHayMilk } from "@/components/WhyHayMilk";
import { Footer } from "@/components/Footer";
import { Reveal } from "@/components/Reveal";

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
  return {
    title: `${product.name} ${product.volume}`,
    description: product.shortDesc,
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

  return (
    <>
      <div className="mx-auto max-w-7xl px-5 pt-24 sm:px-8">
        <nav className="py-5 text-[12px] tracking-wide text-mute">
          <Link href="/" className="hover:text-gold">홈</Link>
          <span className="mx-2">/</span>
          <Link href="/#products" className="hover:text-gold">제품</Link>
          <span className="mx-2">/</span>
          <span className="text-ink-soft">{product.name} {product.volume}</span>
        </nav>

        <div className="grid gap-10 pb-8 lg:grid-cols-2 lg:gap-16">
          {/* Image */}
          <div className="lg:sticky lg:top-24 lg:self-start">
            <div className="relative flex aspect-[4/5] items-center justify-center overflow-hidden rounded-[2rem] bg-gradient-to-b from-paper-2 to-paper">
              <span
                className="absolute left-6 top-6 h-1.5 w-12 rounded-full"
                style={{ background: product.accent }}
              />
              <Image
                src={product.image}
                alt={`${product.name} ${product.volume}`}
                width={380}
                height={480}
                priority
                className="h-[80%] w-auto object-contain drop-shadow-[0_24px_44px_rgba(40,30,15,0.22)]"
              />
            </div>
          </div>

          {/* Detail */}
          <div className="flex flex-col">
            <p className="text-[11px] uppercase tracking-[0.24em] text-gold">
              {product.nameEn} · {product.volume} · {product.badge}
            </p>
            <h1 className="mt-4 font-serif-kr text-[clamp(2rem,4vw,3rem)] font-medium leading-[1.15] text-ink">
              {product.tagline}{" "}
              <span className="font-display italic text-gold">{product.taglineEm}</span>
            </h1>
            <p className="mt-5 text-[15px] leading-loose text-ink-soft">{product.shortDesc}</p>

            {product.story.map((s, i) => (
              <p key={i} className="mt-4 text-[14px] leading-loose text-ink-soft">
                {s}
              </p>
            ))}

            <div className="mt-8">
              <PurchasePanel product={product} />
            </div>

            {/* Specs — quick reference */}
            <dl className="mt-10 divide-y divide-line border-y border-line">
              {product.specs.map((s) => (
                <div key={s.label} className="flex items-center justify-between py-4">
                  <dt className="text-[12px] uppercase tracking-[0.18em] text-mute">{s.label}</dt>
                  <dd className="text-[14px] text-ink">{s.value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>

      {/* 왜 A2 저지 헤이밀크인가 — 텍스트 에디토리얼 */}
      <WhyHayMilk />

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
              <dt className="text-[12px] uppercase tracking-[0.14em] text-mute">{k}</dt>
              <dd className="text-ink-soft">{v}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-6 text-[11.5px] leading-relaxed text-mute">
          ※ 본 제품은 식품의 표시기준에 따라 표시되었으며, 부정·불량식품 신고는 국번 없이 1399.
          소비기한·중량 등 상세 표기는 수령하신 제품의 라벨을 따릅니다.
        </p>
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
                <div className="relative flex h-56 items-center justify-center">
                  <Image
                    src={p.image}
                    alt={`${p.name} ${p.volume}`}
                    width={160}
                    height={200}
                    className="h-[78%] w-auto object-contain drop-shadow-[0_14px_24px_rgba(40,30,15,0.16)] transition-transform duration-700 group-hover:scale-[1.06]"
                  />
                </div>
                <div className="border-t border-line p-5">
                  <p className="text-[11px] uppercase tracking-[0.2em] text-mute">{p.volume}</p>
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
    </>
  );
}

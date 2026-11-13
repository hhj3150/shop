import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Footer } from "@/components/Footer";
import { JsonLd } from "@/components/JsonLd";
import { pageMetadata } from "@/lib/seo/meta";
import { buildBreadcrumb } from "@/lib/seo/schema";
import { buildLearnArticle } from "@/lib/seo/learn-schema";
import {
  LEARN_HUB,
  LEARN_PAGES,
  getLearnPage,
  learnFarmNote,
  learnPath,
  formatKoDate,
} from "@/lib/seo/learn";
import { learnImage, learnOgImage } from "@/lib/seo/learn-images";
import { activeCertifications } from "@/lib/certifications";
import { kstYmd } from "@/lib/kst";

// 해설 글 1편 — 질문형 소제목, 첫 문단에 결론, 화면에 보이는 '출처' 목록(GEO).
//   본문은 lib/seo/learn.ts 한 곳. 서버 렌더(정적) — 크롤러·AI 봇이 JS 없이 전문을 읽는다.
//   정해 둔 글만 만든다(dynamicParams=false → 그 밖의 주소는 404).
export const dynamicParams = false;

// '송영신목장에서는' 상자의 인증 목록은 오늘(KST) 기준 유효한 것만 — 하루에 한 번 다시 만들어
//   유효기간이 끝난 인증이 재배포 없이도 빠지게 한다.
export const revalidate = 86400;

export function generateStaticParams() {
  return LEARN_PAGES.map((p) => ({ slug: p.slug }));
}

export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>;
}): Promise<Metadata> {
  const { slug } = await params;
  const page = getLearnPage(slug);
  if (!page) return {};
  const img = learnImage(page.slug);
  return pageMetadata({
    title: page.title,
    description: page.description,
    path: learnPath(page.slug),
    ...(img ? { ogImage: learnOgImage(img) } : {}),
  });
}

export default async function LearnArticlePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  const page = getLearnPage(slug);
  if (!page) notFound();

  const note = learnFarmNote(page.slug, {
    certifications: activeCertifications(kstYmd(new Date().toISOString())),
  });
  const others = LEARN_PAGES.filter((p) => p.slug !== page.slug);
  const img = learnImage(page.slug);

  return (
    <>
      <JsonLd data={buildLearnArticle(page)} />
      <JsonLd
        data={buildBreadcrumb([
          { name: "송영신목장", path: "/" },
          { name: "알아보기", path: LEARN_HUB.path },
          { name: page.title, path: learnPath(page.slug) },
        ])}
      />
      <article className="mx-auto max-w-3xl px-5 pb-24 pt-28 sm:px-8">
        <nav aria-label="이동 경로" className="t-footnote text-mute">
          <ol className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
            <li>
              <Link href="/" className="hover:text-ink">송영신목장</Link>
            </li>
            <li aria-hidden>›</li>
            <li>
              <Link href={LEARN_HUB.path} className="hover:text-ink">알아보기</Link>
            </li>
          </ol>
        </nav>

        <h1 className="mt-4 font-serif-kr text-[clamp(1.7rem,4.6vw,2.4rem)] font-medium leading-tight text-ink">
          {page.title}
        </h1>
        <p className="t-footnote mt-3 text-mute">
          최종 업데이트 <time dateTime={page.updated}>{formatKoDate(page.updated)}</time>
        </p>

        {img && (
          <figure className="-mx-5 mt-8 sm:mx-0">
            <div className="relative aspect-[4/3] w-full overflow-hidden bg-paper sm:rounded-2xl">
              <Image
                src={img.src}
                alt={img.alt}
                fill
                preload
                sizes="(max-width:768px) 100vw, 768px"
                className="object-cover"
                style={{ objectPosition: img.position }}
              />
            </div>
            {img.caption && (
              <figcaption className="t-caption mt-2.5 px-5 text-mute sm:px-0">{img.caption}</figcaption>
            )}
          </figure>
        )}

        <p className="t-body mt-8 text-ink">{page.intro}</p>

        <div className="mt-10 space-y-10">
          {page.sections.map((s) => (
            <section key={s.heading}>
              <h2 className="t-title3 font-serif-kr text-ink">
                {s.heading}
              </h2>
              <div className="t-body mt-3 space-y-3 text-ink-soft">
                {s.paragraphs.map((para) => (
                  <p key={para}>{para}</p>
                ))}
              </div>
            </section>
          ))}
        </div>

        {(note.paragraphs.length > 0 || note.list.length > 0) && (
          <aside
            aria-labelledby="farm-note"
            className="mt-12 rounded-2xl border border-line bg-cream px-5 py-6 sm:px-7"
          >
            <h2 id="farm-note" className="t-headline font-serif-kr text-ink">
              송영신목장에서는
            </h2>
            <div className="t-callout mt-3 space-y-2 text-ink-soft">
              {note.paragraphs.map((para) => (
                <p key={para}>{para}</p>
              ))}
            </div>
            {note.list.length > 0 && (
              <ul className="t-subhead mt-3 list-disc space-y-1.5 pl-5 text-ink-soft">
                {note.list.map((li) => (
                  <li key={li}>{li}</li>
                ))}
              </ul>
            )}
            {note.links.length > 0 && (
              <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-1">
                {note.links.map((l) => (
                  <li key={l.href}>
                    <Link
                      href={l.href}
                      className="t-subhead inline-flex min-h-11 items-center text-gold-deep underline underline-offset-4 hover:text-ink"
                    >
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        )}

        <section aria-labelledby="sources" className="mt-12 border-t border-line pt-8">
          <h2 id="sources" className="t-headline font-serif-kr text-ink">
            출처
          </h2>
          <ol className="t-footnote mt-4 list-decimal space-y-2.5 pl-5 text-ink-soft">
            {page.sources.map((src) => (
              <li key={src.url}>
                {src.name} ({src.accessed ? `${src.year}년 열람` : `${src.year}`}).{" "}
                <a
                  href={src.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all text-gold-deep underline underline-offset-2 hover:text-ink"
                >
                  {src.url}
                </a>
              </li>
            ))}
          </ol>
        </section>

        <nav aria-labelledby="more-learn" className="mt-12 border-t border-line pt-8">
          <h2 id="more-learn" className="t-headline font-serif-kr text-ink">
            함께 알아보기
          </h2>
          <ul className="mt-3 space-y-1">
            {others.map((p) => (
              <li key={p.slug}>
                <Link
                  href={learnPath(p.slug)}
                  className="t-callout inline-flex min-h-11 items-center text-ink-soft underline underline-offset-4 hover:text-gold-deep"
                >
                  {p.title}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </article>
      <Footer />
    </>
  );
}

import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { JsonLd } from "@/components/JsonLd";
import { pageMetadata } from "@/lib/seo/meta";
import { buildBreadcrumb } from "@/lib/seo/schema";
import { buildLearnHub } from "@/lib/seo/learn-schema";
import { LEARN_HUB, LEARN_PAGES, learnPath, formatKoDate } from "@/lib/seo/learn";
import { LEARN_HUB_IMAGE, learnImage, learnOgImage } from "@/lib/seo/learn-images";

// 알아보기 — 해설 글 모음. 검색·AI 가 'A2 우유 뜻', '저지 우유', '헤이밀크', '인증 목장' 같은
//   정보성 질문의 출처로 가리킬 수 있는 고정 주소들의 입구다. 서버 렌더(정적) — JS 없이도 다 읽힌다.
export const metadata: Metadata = pageMetadata({
  title: LEARN_HUB.title,
  description: LEARN_HUB.description,
  path: LEARN_HUB.path,
  ogImage: learnOgImage(LEARN_HUB_IMAGE),
});

export default function LearnHubPage() {
  return (
    <>
      <JsonLd data={buildLearnHub(LEARN_PAGES)} />
      <JsonLd
        data={buildBreadcrumb([
          { name: "송영신목장", path: "/" },
          { name: "알아보기", path: LEARN_HUB.path },
        ])}
      />
      <div className="mx-auto max-w-3xl px-5 pb-24 pt-28 sm:px-8">
        <p className="eyebrow text-gold-deep">Learn</p>
        <h1 className="mt-3 font-serif-kr text-[clamp(1.8rem,5vw,2.6rem)] font-medium text-ink">
          알아보기
        </h1>
        <p className="t-body mt-4 text-ink-soft">
          A2 우유, 저지, 헤이밀크, 인증 목장이 무엇인지 사실과 출처로 설명합니다.
        </p>

        <div className="relative -mx-5 mt-8 aspect-[16/9] overflow-hidden bg-paper sm:mx-0 sm:rounded-2xl">
          <Image
            src={LEARN_HUB_IMAGE.src}
            alt={LEARN_HUB_IMAGE.alt}
            fill
            preload
            sizes="(max-width:768px) 100vw, 768px"
            className="object-cover"
            style={{ objectPosition: LEARN_HUB_IMAGE.position }}
          />
        </div>

        <ul className="mt-10 space-y-4">
          {LEARN_PAGES.map((p) => {
            const img = learnImage(p.slug);
            return (
            <li key={p.slug}>
              <Link
                href={learnPath(p.slug)}
                className="group flex items-start gap-4 rounded-2xl border border-line bg-cream px-5 py-5 transition-colors hover:border-gold sm:gap-5 sm:px-6"
              >
                {img && (
                  <span className="relative aspect-[3/4] w-20 shrink-0 overflow-hidden rounded-xl bg-paper sm:w-28">
                    <Image
                      src={img.src}
                      alt=""
                      fill
                      sizes="(max-width:640px) 80px, 112px"
                      className="object-cover transition-transform duration-500 group-hover:scale-[1.03]"
                      style={{ objectPosition: img.position }}
                    />
                  </span>
                )}
                <span className="min-w-0 flex-1">
                <h2 className="t-title3 font-serif-kr text-ink">
                  {p.title}
                </h2>
                <p className="t-subhead mt-2 text-ink-soft">{p.description}</p>
                <p className="t-caption mt-3 text-mute">
                  최종 업데이트{" "}
                  <time dateTime={p.updated}>{formatKoDate(p.updated)}</time>
                </p>
                </span>
              </Link>
            </li>
            );
          })}
        </ul>
      </div>
      <Footer />
    </>
  );
}

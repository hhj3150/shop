import type { Metadata } from "next";
import Link from "next/link";
import { Footer } from "@/components/Footer";
import { JsonLd } from "@/components/JsonLd";
import { pageMetadata } from "@/lib/seo/meta";
import { buildBreadcrumb } from "@/lib/seo/schema";
import { buildLearnHub } from "@/lib/seo/learn-schema";
import { LEARN_HUB, LEARN_PAGES, learnPath, formatKoDate } from "@/lib/seo/learn";

// 알아보기 — 해설 글 모음. 검색·AI 가 'A2 우유 뜻', '저지 우유', '헤이밀크', '인증 목장' 같은
//   정보성 질문의 출처로 가리킬 수 있는 고정 주소들의 입구다. 서버 렌더(정적) — JS 없이도 다 읽힌다.
export const metadata: Metadata = pageMetadata({
  title: LEARN_HUB.title,
  description: LEARN_HUB.description,
  path: LEARN_HUB.path,
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

        <ul className="mt-10 space-y-4">
          {LEARN_PAGES.map((p) => (
            <li key={p.slug}>
              <Link
                href={learnPath(p.slug)}
                className="block rounded-2xl border border-line bg-cream px-5 py-5 transition-colors hover:border-gold sm:px-6"
              >
                <h2 className="t-title3 font-serif-kr text-ink">
                  {p.title}
                </h2>
                <p className="t-subhead mt-2 text-ink-soft">{p.description}</p>
                <p className="t-caption mt-3 text-mute">
                  최종 업데이트{" "}
                  <time dateTime={p.updated}>{formatKoDate(p.updated)}</time>
                </p>
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <Footer />
    </>
  );
}

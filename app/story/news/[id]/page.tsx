import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Footer } from "@/components/Footer";
import { JsonLd } from "@/components/JsonLd";
import { formatTitle, toParagraphs } from "@/lib/news";
import { fetchNewsById, fetchPublishedNews, fetchLatestNews } from "@/lib/news-server";
import { newsMetadata } from "@/lib/news-meta";
import { buildNewsArticle, buildNewsBreadcrumb } from "@/lib/news-schema";
import {
  newsDateLabel,
  newsPath,
  safeYoutubeId,
  toIsoOrNull,
  youtubeEmbedUrl,
} from "@/lib/news-feed";

// 목장 소식 한 건의 고유 주소 — /story/news/<id>.
//   [왜] 소식은 /story 에서 브라우저가 직접 읽어 그렸다. 서버 HTML 에 글이 없고 글마다 주소도 없어서
//        검색·AI 가 색인하거나 인용할 곳이 없었다. 이 페이지는 서버에서 글 전체를 HTML 로 낸다.
//   ISR: 게시된 글은 빌드 때 미리 만들고(없으면 0개 — 빌드는 그대로 통과), 새 글은 처음 열릴 때 만든다.
//        1시간마다 다시 만든다 — 관리자가 고친 내용·게시 취소가 재배포 없이 반영된다.
//        (Cache Components 미사용 → route segment config 사용. node_modules/next/dist/docs/01-app/
//        03-api-reference/04-functions/generate-static-params.md — "All paths at runtime")
//   미게시·삭제·없는 글은 404(notFound).

export const revalidate = 3600;

export async function generateStaticParams() {
  return (await fetchPublishedNews()).map((r) => ({ id: r.id }));
}

type Props = { params: Promise<{ id: string }> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const row = await fetchNewsById(id);
  if (!row) return { title: "소식을 찾을 수 없습니다" };
  return newsMetadata(row);
}

/** 이 글을 뺀 최근 소식 몇 개 — 글끼리 서로 이어 준다(오래된 글도 링크로 닿게). */
const OTHER_NEWS_MAX = 3;

export default async function NewsPostPage({ params }: Props) {
  const { id } = await params;
  // 본문과 '다른 소식'을 함께 시작한다(차례로 기다리면 최악 8초+8초).
  //   '다른 소식'은 덧붙이는 목록이라, 그 조회만 실패하면 목록 없이 글을 그린다(글 전체를 500 으로 만들지 않는다).
  const [row, latest] = await Promise.all([
    fetchNewsById(id),
    fetchLatestNews(OTHER_NEWS_MAX + 1).catch((err: unknown) => {
      console.error("다른 목장 소식 조회 실패 — 목록 없이 그림:", err);
      return [];
    }),
  ]);
  if (!row) notFound();

  const title = formatTitle(row.title);
  const paragraphs = toParagraphs(row.body);
  const published = toIsoOrNull(row.created_at);
  const youtube = safeYoutubeId(row.youtube_id);
  const others = latest
    .filter((r) => r.id !== row.id)
    .slice(0, OTHER_NEWS_MAX);

  return (
    <>
      <JsonLd data={buildNewsArticle(row)} />
      <JsonLd data={buildNewsBreadcrumb(row)} />

      <article className="mx-auto max-w-3xl px-5 pb-20 pt-28 sm:px-8">
        <nav aria-label="이동 경로" className="t-footnote text-mute">
          <Link href="/story" className="underline-offset-4 hover:text-ink hover:underline">
            목장 이야기
          </Link>
          <span aria-hidden="true"> › </span>
          <span>목장 소식</span>
        </nav>

        <header className="mt-8">
          <p className="eyebrow text-gold-deep">Farm Journal</p>
          <h1 className="mt-3 font-serif-kr text-[clamp(1.8rem,5vw,2.6rem)] font-medium leading-tight text-ink">
            {title}
          </h1>
          {published && (
            <p className="t-footnote mt-3 text-mute">
              <time dateTime={published}>{newsDateLabel(row.created_at)}</time>
            </p>
          )}
        </header>

        {row.cover_url && (
          <div className="relative mt-8 aspect-[16/9] w-full overflow-hidden rounded-2xl bg-paper">
            <Image
              src={row.cover_url}
              alt={title}
              fill
              preload
              sizes="(max-width:768px) 92vw, 760px"
              className="object-cover"
            />
          </div>
        )}

        {youtube && (
          <div className="relative mt-8 aspect-video w-full overflow-hidden rounded-2xl bg-ink">
            {/* 개인정보 보호 모드(youtube-nocookie) — 재생 전에는 쿠키를 심지 않는다. */}
            <iframe
              src={youtubeEmbedUrl(youtube)}
              title={`${title} — 영상`}
              loading="lazy"
              referrerPolicy="strict-origin-when-cross-origin"
              allow="accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
              allowFullScreen
              className="absolute inset-0 h-full w-full"
            />
          </div>
        )}

        <div className="t-body mt-8 space-y-5 text-ink-soft">
          {paragraphs.map((p, i) => (
            <p key={i} className="whitespace-pre-line">
              {p}
            </p>
          ))}
        </div>

        {others.length > 0 && (
          <section aria-labelledby="other-news" className="mt-16 border-t border-line pt-8">
            <h2 id="other-news" className="font-serif-kr text-lg font-medium text-ink">
              다른 목장 소식
            </h2>
            <ul className="mt-4 divide-y divide-line/70">
              {others.map((o) => (
                <li key={o.id}>
                  <Link
                    href={newsPath(o.id)}
                    className="flex min-h-12 flex-col justify-center py-3 hover:bg-cream/40"
                  >
                    <span className="t-caption text-mute">{newsDateLabel(o.created_at)}</span>
                    <span className="t-callout mt-0.5 font-medium text-ink">{formatTitle(o.title)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        )}

        <p className="mt-12">
          <Link
            href="/story#news"
            className="t-footnote inline-flex min-h-11 items-center text-gold-deep underline underline-offset-4 hover:text-ink"
          >
            ← 목장 이야기로 돌아가기
          </Link>
        </p>
      </article>
      <Footer />
    </>
  );
}

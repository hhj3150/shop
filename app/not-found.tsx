import Link from "next/link";
import { Footer } from "@/components/Footer";

// 없는 주소(사이트 전체)와 notFound() 의 공통 404 화면.
//   [왜] 이 파일이 없으면 Next 기본 404 가 자기 <title>('404: This page could not be found.')을 하나 더 넣어
//        <head> 에 제목이 둘이었다(2026-11-12 운영 감사). 여기서는 <title> 을 따로 그리지 않는다 —
//        루트 레이아웃의 기본 제목 하나만 나가고, noindex 는 Next 가 404 응답에 자동으로 붙인다.
//   길 잃은 손님이 바로 돌아갈 수 있게 주요 입구를 건다.
const EXITS = [
  { href: "/#products", label: "제품 보기" },
  { href: "/story", label: "목장 이야기" },
  { href: "/faq", label: "자주 묻는 질문" },
  { href: "/learn", label: "알아보기" },
] as const;

export default function NotFound() {
  return (
    <>
      <div className="mx-auto max-w-2xl px-5 pb-24 pt-28 text-center sm:px-8">
        <p className="eyebrow text-gold-deep">404 · Not Found</p>
        <h1 className="mt-3 font-serif-kr text-[clamp(1.7rem,5vw,2.3rem)] font-medium text-ink">
          찾으시는 페이지가 없습니다.
        </h1>
        <p className="t-body mt-4 text-ink-soft">
          주소가 바뀌었거나 더 이상 없는 페이지입니다. 아래에서 다시 찾아보세요.
        </p>
        <ul className="mt-8 flex flex-wrap justify-center gap-2.5">
          {EXITS.map((e) => (
            <li key={e.href}>
              <Link
                href={e.href}
                className="inline-flex min-h-11 items-center rounded-full border border-line bg-cream px-5 text-[14px] text-ink transition-colors hover:border-gold"
              >
                {e.label}
              </Link>
            </li>
          ))}
        </ul>
      </div>
      <Footer />
    </>
  );
}

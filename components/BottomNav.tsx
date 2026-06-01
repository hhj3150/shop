"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

// 외부 링크 메뉴. 각 항목을 브랜드 색으로 칠한 원형 배지 아이콘으로 보여준다.
// (색은 보조 신호일 뿐 — 라벨 텍스트를 항상 함께 두어 색만으로 구분하지 않게 한다.)
const EXTERNAL = [
  {
    label: "송영신목장",
    href: "https://www.a2jerseymilk.com",
    color: "#9a7838", // 브랜드 골드
    tint: "#f6edd9",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M4 11.5 12 5l8 6.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M6 10.5V19h12v-8.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M10 19v-4h4v4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    label: "MILK ROAD",
    href: "https://youtu.be/bbr2yvqV_6Y?si=_MqELOrg0XBYydfd",
    color: "#e0352b", // 유튜브 레드
    tint: "#fce4e2",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <rect x="3.5" y="6" width="17" height="12" rx="3" />
        <path d="M10.5 9.5 14.5 12l-4 2.5V9.5Z" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    label: "블로그",
    href: "https://blog.naver.com/78redmoon",
    color: "#03c75a", // 네이버 그린
    tint: "#d9f5e6",
    icon: (
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
        <path d="M14.5 4.5 19.5 9.5 9 20H4v-5L14.5 4.5Z" strokeLinejoin="round" />
        <path d="M13 6 18 11" strokeLinecap="round" />
      </svg>
    ),
  },
];

export function BottomNav() {
  const pathname = usePathname();
  const shopActive = pathname === "/";
  return (
    <nav
      aria-label="모바일 메뉴"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper/90 backdrop-blur-xl pb-[env(safe-area-inset-bottom)] md:hidden"
    >
      <ul className="mx-auto grid max-w-md grid-cols-4">
        <li>
          <Link
            href="/"
            aria-current={shopActive ? "page" : undefined}
            className={`flex min-h-12 flex-col items-center justify-center gap-1 py-3 text-[11px] tracking-wide transition-colors ${
              shopActive ? "text-gold-deep" : "text-ink-soft hover:text-gold-deep"
            }`}
          >
            <Image
              src="/brand/heymilk-logo.png"
              alt=""
              width={800}
              height={800}
              className="h-[22px] w-[22px] object-contain"
            />
            쇼핑
          </Link>
        </li>
        {EXTERNAL.map((it) => (
          <li key={it.label}>
            <a
              href={it.href}
              target="_blank"
              rel="noopener noreferrer"
              className="flex min-h-12 flex-col items-center justify-center gap-1 py-2.5 text-[11px] tracking-wide text-ink-soft transition-colors hover:text-ink"
            >
              <span
                className="flex h-7 w-7 items-center justify-center rounded-full"
                style={{ backgroundColor: it.tint, color: it.color }}
              >
                {it.icon}
              </span>
              {it.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

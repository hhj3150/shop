"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";

const EXTERNAL = [
  {
    label: "송영신목장",
    href: "https://www.a2jerseymilk.com",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M4 11.5 12 5l8 6.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M6 10.5V19h12v-8.5" strokeLinecap="round" strokeLinejoin="round" />
        <path d="M10 19v-4h4v4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    ),
  },
  {
    label: "브랜드영상",
    href: "https://youtu.be/bI5EmgK0i2A?si=MK61I2LYE3wQsx4S",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="3.5" y="6" width="17" height="12" rx="3" />
        <path d="M10.5 9.5 14.5 12l-4 2.5V9.5Z" fill="currentColor" stroke="none" />
      </svg>
    ),
  },
  {
    label: "블로그",
    href: "https://blog.naver.com/78redmoon",
    icon: (
      <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
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
              className="flex min-h-12 flex-col items-center justify-center gap-1 py-3 text-[11px] tracking-wide text-ink-soft transition-colors hover:text-gold-deep"
            >
              {it.icon}
              {it.label}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

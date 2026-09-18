"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useState } from "react";
import { useCart } from "@/lib/cart";
import { useAuth } from "@/lib/auth";
import { BRAND_HOME, subscribeStartHref } from "@/lib/site";

export function Nav() {
  const { count, open } = useCart();
  const { ready, user } = useAuth();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // 스크롤을 내리면 헤더가 '유리'가 된다 — 아래 내용이 채도를 유지한 채 비쳐,
  //   덮개가 아니라 그 위에 얹힌 판처럼 읽힌다. 다만 조작부라 글자가 언제나 또렷한
  //   선까지만 투명하게 둔다(material-chrome).
  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-500 ${
        scrolled
          ? "material-chrome border-b border-line/60 elev-1"
          : "bg-transparent border-b border-transparent"
      }`}
    >
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
        <Link
          href="/"
          aria-label="송영신목장 A2 저지 헤이밀크 홈"
          className="tap press flex items-center"
        >
          <Image
            src="/brand/heymilk-logo.png"
            alt="송영신목장 A2 저지 헤이밀크"
            width={800}
            height={800}
            priority
            sizes="44px"
            className="h-10 w-auto sm:h-11"
          />
        </Link>

        <div className="hidden items-center gap-9 text-[14px] tracking-wide text-ink-soft md:flex">
          <Link href="/#products" className="transition-colors hover:text-gold">
            제품
          </Link>
          <Link
            href={subscribeStartHref(ready && !!user)}
            className="transition-colors hover:text-gold"
          >
            정기구독
          </Link>
          <a
            href={BRAND_HOME}
            target="_blank"
            rel="noopener noreferrer"
            className="transition-colors hover:text-gold"
          >
            목장 이야기
          </a>
        </div>

        <div className="flex items-center gap-2.5">
          <Link
            href={user ? "/account" : "/login"}
            aria-label={user ? "내 계정" : "로그인"}
            className="tap press flex min-h-11 items-center gap-1.5 rounded-full border border-line bg-cream/60 px-4 text-[13px] tracking-wide text-ink transition-colors hover:border-gold hover:text-gold"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <circle cx="12" cy="8" r="3.2" />
              <path d="M5 19a7 7 0 0 1 14 0" strokeLinecap="round" />
            </svg>
            <span className="hidden sm:inline">{user ? "내 계정" : "로그인"}</span>
          </Link>

          <button
            onClick={open}
            aria-label="장바구니 열기"
            className="tap press group relative flex min-h-11 items-center gap-2 rounded-full border border-line bg-cream/60 px-4 text-[13px] tracking-wide text-ink transition-colors hover:border-gold hover:text-gold"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
              <path d="M6 7h12l-1 13H7L6 7Z" strokeLinejoin="round" />
              <path d="M9 7a3 3 0 0 1 6 0" strokeLinecap="round" />
            </svg>
            <span className="t-num">{count}</span>
          </button>
        </div>
      </nav>
    </header>
  );
}

"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useCart } from "@/lib/cart";
import { BRAND_HOME } from "@/lib/site";

export function Nav() {
  const { count, open } = useCart();
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 12);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={`fixed inset-x-0 top-0 z-50 transition-all duration-500 ${
        scrolled
          ? "bg-paper/80 backdrop-blur-xl border-b border-line/70"
          : "bg-transparent border-b border-transparent"
      }`}
    >
      <nav className="mx-auto flex h-16 max-w-7xl items-center justify-between px-5 sm:px-8">
        <Link href="/" className="flex items-center gap-2.5">
          <span className="font-display text-[15px] uppercase tracking-[0.2em] text-ink">
            송영신목장
          </span>
          <span className="hidden text-[10px] uppercase tracking-[0.3em] text-mute sm:inline">
            A2 Jersey
          </span>
        </Link>

        <div className="hidden items-center gap-9 text-[13px] tracking-wide text-ink-soft md:flex">
          <Link href="/#products" className="transition-colors hover:text-gold">
            제품
          </Link>
          <Link href="/#subscribe" className="transition-colors hover:text-gold">
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

        <button
          onClick={open}
          aria-label="장바구니 열기"
          className="group relative flex items-center gap-2 rounded-full border border-line bg-cream/60 px-4 py-2 text-[12px] tracking-wide text-ink transition-all hover:border-gold hover:text-gold"
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6">
            <path d="M6 7h12l-1 13H7L6 7Z" strokeLinejoin="round" />
            <path d="M9 7a3 3 0 0 1 6 0" strokeLinecap="round" />
          </svg>
          <span className="tabular-nums">{count}</span>
        </button>
      </nav>
    </header>
  );
}

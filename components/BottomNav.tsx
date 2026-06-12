"use client";

import Link from "next/link";
import Image from "next/image";
import { usePathname } from "next/navigation";
import { useState } from "react";
import { useCart } from "@/lib/cart";
import { useAuth } from "@/lib/auth";
import { useDialog } from "@/lib/useDialog";

// 하단바는 '지금 사게 만드는' 커머스 동선(홈·장바구니·내 계정)을 thumb-zone 에 둔다.
// 외부 브랜드 채널(목장 홈·유튜브·블로그)은 마케팅 자산이라 버리지 않고 '더보기' 시트로 한 탭 뒤에 둔다.
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

function tabClass(active: boolean): string {
  return `flex min-h-12 flex-col items-center justify-center gap-1 py-3 text-[11px] tracking-wide transition-colors ${
    active ? "text-gold-deep" : "text-ink-soft hover:text-gold-deep"
  }`;
}

const ICON = "h-[22px] w-[22px]";

function CartIcon() {
  return (
    <svg className={ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <path d="M6 7h12l-1 11.2a2 2 0 0 1-2 1.8H9a2 2 0 0 1-2-1.8L6 7Z" strokeLinejoin="round" />
      <path d="M9 7a3 3 0 0 1 6 0" strokeLinecap="round" />
    </svg>
  );
}

function AccountIcon() {
  return (
    <svg className={ICON} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden>
      <circle cx="12" cy="8.5" r="3.2" />
      <path d="M5.6 19a6.4 6.4 0 0 1 12.8 0" strokeLinecap="round" />
    </svg>
  );
}

function MoreIcon() {
  return (
    <svg className={ICON} viewBox="0 0 24 24" fill="currentColor" stroke="none" aria-hidden>
      <circle cx="6" cy="12" r="1.5" />
      <circle cx="12" cy="12" r="1.5" />
      <circle cx="18" cy="12" r="1.5" />
    </svg>
  );
}

export function BottomNav() {
  const pathname = usePathname();
  const { count, open } = useCart();
  const { user } = useAuth();
  const [moreOpen, setMoreOpen] = useState(false);
  const sheetRef = useDialog<HTMLDivElement>(moreOpen, () => setMoreOpen(false));

  const homeActive = pathname === "/";
  const accountActive = pathname.startsWith("/account");

  return (
    <>
      {/* 더보기 시트 — 외부 브랜드 채널 */}
      <div
        onClick={() => setMoreOpen(false)}
        aria-hidden
        className={`fixed inset-0 z-[60] bg-ink/30 backdrop-blur-sm transition-opacity duration-300 md:hidden ${
          moreOpen ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      />
      <div
        ref={sheetRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label="브랜드 채널 더보기"
        aria-hidden={!moreOpen}
        className={`fixed inset-x-0 bottom-0 z-[70] mx-auto max-w-md rounded-t-2xl border-t border-line bg-paper p-5 pb-[calc(env(safe-area-inset-bottom)+1.25rem)] shadow-2xl outline-none transition-transform duration-300 ease-[var(--ease-soft)] md:hidden ${
          moreOpen ? "translate-y-0" : "translate-y-full"
        }`}
      >
        <div className="mb-3 flex items-center justify-between">
          <p className="text-sm font-medium text-ink">브랜드 채널</p>
          <button
            type="button"
            onClick={() => setMoreOpen(false)}
            aria-label="닫기"
            className="flex h-8 w-8 items-center justify-center rounded-full text-mute transition-colors hover:bg-cream hover:text-ink"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" aria-hidden>
              <path d="M6 6 18 18M18 6 6 18" strokeLinecap="round" />
            </svg>
          </button>
        </div>
        <ul className="space-y-1">
          {EXTERNAL.map((it) => (
            <li key={it.label}>
              <a
                href={it.href}
                target="_blank"
                rel="noopener noreferrer"
                onClick={() => setMoreOpen(false)}
                className="flex items-center gap-3 rounded-xl px-3 py-3 transition-colors hover:bg-cream"
              >
                <span
                  className="flex h-9 w-9 items-center justify-center rounded-full"
                  style={{ backgroundColor: it.tint, color: it.color }}
                >
                  {it.icon}
                </span>
                <span className="text-[14px] text-ink-soft">{it.label}</span>
                <span className="ml-auto text-mute" aria-hidden>
                  ↗
                </span>
              </a>
            </li>
          ))}
        </ul>
      </div>

      {/* 하단 탭바 */}
      <nav
        aria-label="모바일 메뉴"
        className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-paper pb-[env(safe-area-inset-bottom)] md:hidden"
      >
        <ul className="mx-auto grid max-w-md grid-cols-4">
          {/* 홈 */}
          <li>
            <Link href="/" aria-current={homeActive ? "page" : undefined} className={tabClass(homeActive)}>
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

          {/* 장바구니 — 드로어 열기 + 담긴 수량 배지 */}
          <li>
            <button
              type="button"
              onClick={open}
              aria-label={count > 0 ? `장바구니 열기, ${count}개 담김` : "장바구니 열기"}
              className={`${tabClass(false)} w-full`}
            >
              <span className="relative">
                <CartIcon />
                {count > 0 && (
                  <span className="absolute -right-2 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-gold-deep px-1 text-[10px] font-semibold leading-none text-cream tabular-nums">
                    {count}
                  </span>
                )}
              </span>
              장바구니
            </button>
          </li>

          {/* 내 계정 / 로그인 */}
          <li>
            <Link
              href={user ? "/account" : "/login"}
              aria-current={accountActive ? "page" : undefined}
              className={tabClass(accountActive)}
            >
              <AccountIcon />
              {user ? "내 계정" : "로그인"}
            </Link>
          </li>

          {/* 더보기 — 외부 채널 시트 */}
          <li>
            <button
              type="button"
              onClick={() => setMoreOpen(true)}
              aria-haspopup="dialog"
              aria-expanded={moreOpen}
              className={`${tabClass(moreOpen)} w-full`}
            >
              <MoreIcon />
              더보기
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}

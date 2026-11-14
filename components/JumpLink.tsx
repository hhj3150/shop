"use client";

import type { ReactNode } from "react";

// 같은 화면 안의 다른 자리로 데려가는 링크(예: '★ N건 리뷰' → 구매평, '수량 채우기' → 수량).
//
//   ★ 기록(history)을 남기지 않는다. 화면 안 이동은 '화면'이 아니라서, 남기면 '이전' 버튼이
//     같은 화면을 한 번 더 거치거나(스크롤만 되돌아감) 헛돈다(lib/back-nav.ts).
//     - 맨 <a href="#…"> 는 Next 가 무시하는 기록을 남겨 '이전'으로 돌아오면 화면이 안 바뀌었고,
//     - next/link 의 #링크는 같은 주소일 때 두 번째부터 아무 일도 안 하며 포커스도 옮기지 않았다
//       (2026-11-14 교차 검증).
//   그래서 누를 때마다 그 자리로 스크롤하고, 키보드·화면낭독기 사용자도 그 자리에서 이어 가도록
//   포커스를 옮긴다. JS 가 없으면 평범한 #링크로 동작한다(href 유지).
export function JumpLink({
  to,
  className,
  tabIndex,
  children,
}: {
  /** 이동할 요소의 id(# 없이) */
  to: string;
  className?: string;
  tabIndex?: number;
  children: ReactNode;
}) {
  return (
    <a
      href={`#${to}`}
      className={className}
      tabIndex={tabIndex}
      onClick={(e) => {
        const target = document.getElementById(to);
        if (!target) return; // 대상이 없으면 브라우저 기본 동작
        e.preventDefault();
        // scroll-margin(scroll-mt-*)·CSS 의 부드러운 스크롤·동작 줄이기 설정을 그대로 따른다.
        target.scrollIntoView({ block: "start" });
        if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
        target.focus({ preventScroll: true });
      }}
    >
      {children}
    </a>
  );
}

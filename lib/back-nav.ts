// 스마트폰 '이전 화면' 버튼의 규칙 — 순수 함수만(테스트 대상). 화면 쪽은 components/BackButton.tsx.
//
//   왜 필요한가: 쇼핑몰은 홈 화면에 추가하면 앱처럼 열린다(manifest display: "standalone").
//   그때는 브라우저 뒤로가기 버튼이 없어, 해설 글·제품·소식에서 목록으로 돌아가려면
//   홈으로 갔다가 다시 찾아 들어가야 했다(2026-11-14 회장님 지적).
//
//   동작: 이 탭에서 사이트 안을 걸어 들어온 기록이 있으면 브라우저 '뒤로'와 똑같이 한 걸음 뒤로
//   (스크롤 위치까지 돌아간다). 검색·카카오톡 링크로 바로 들어와 앞 화면이 없으면 그 화면의
//   '목록'으로 보낸다 — 사이트 밖(검색 결과·다른 앱)으로 튕겨 나가지 않게.

/** 앞 화면이 없을 때 갈 곳(그 화면의 목록). */
export function backFallback(pathname: string): string {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (/^\/learn\/[^/]+$/.test(path)) return "/learn";
  if (/^\/story\/news\/[^/]+$/.test(path)) return "/story#news";
  if (/^\/products\/[^/]+$/.test(path)) return "/#products";
  if (/^\/account\/.+/.test(path)) return "/account";
  if (/^\/admin\/.+/.test(path)) return "/admin";
  return "/";
}

/** 홈에서는 버튼을 보이지 않는다(더 돌아갈 곳이 없다). */
export function showBackButton(pathname: string): boolean {
  return (pathname.replace(/\/+$/, "") || "/") !== "/";
}

/**
 * 이 탭에서 사이트 안을 지나온 주소 기록(브라우저 기록을 흉내 낸 스택).
 *   - 같은 주소를 다시(새로고침) → 그대로
 *   - 바로 앞 주소로 이동(뒤로 가기) → 맨 위를 뺀다
 *   - 그 밖 → 쌓는다(최대 50개)
 */
export function recordVisit(stack: readonly string[], path: string): string[] {
  if (stack.at(-1) === path) return [...stack];
  if (stack.at(-2) === path) return stack.slice(0, -1);
  return [...stack, path].slice(-50);
}

/** 사이트 안의 앞 화면이 있으면 true — 그때만 브라우저 '뒤로'를 쓴다. */
export function canGoBackInSite(stack: readonly string[]): boolean {
  return stack.length > 1;
}

/**
 * 새로 페이지를 불러왔을 때(전체 로드) 기록을 이어 갈지.
 *   다른 사이트·앱에서 링크로 들어왔으면(같은 출처가 아닌 referrer, 또는 referrer 없음) 기록을 새로 시작한다
 *   — 예전 기록이 남아 있으면 '뒤로'가 사이트 밖으로 나가 버린다.
 *   새로고침·브라우저 앞/뒤 이동으로 다시 불러온 경우는 이어 간다.
 */
export function shouldResetOnLoad(input: {
  navigationType: string | undefined;
  referrer: string;
  origin: string;
}): boolean {
  if (input.navigationType === "reload" || input.navigationType === "back_forward") return false;
  if (!input.referrer) return true;
  try {
    return new URL(input.referrer).origin !== input.origin;
  } catch {
    return true;
  }
}

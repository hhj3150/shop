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

// ───────── 1순위: 브라우저의 실제 기록(Navigation API) ─────────
//   navigation.entries() 는 지금 화면과 이어진 '같은 사이트' 기록만 준다 — 앞이 다른 사이트면 비어 있다.
//   그래서 이것으로 고르면 '이전'이 사이트 밖으로 나갈 수 없다. (Android Chrome·삼성 인터넷·카카오톡
//   Android, iOS Safari 26.2+ 지원. 없는 브라우저는 아래 2순위 기록을 쓴다.)

/**
 * 지금 화면보다 앞에 있는 '다른 주소'의 사이트 내 기록까지 몇 칸 돌아가면 되는지(음수).
 *   같은 주소의 #앵커 이동처럼 경로가 같은 기록은 건너뛴다 — 그대로 '뒤로'하면 스크롤만 되돌아간다.
 *   돌아갈 사이트 내 기록이 없으면 null(→ 목록으로).
 */
export function pickBackDelta(
  entries: readonly { url: string | null }[],
  currentIndex: number
): number | null {
  const here = pathOf(entries[currentIndex]?.url ?? null);
  if (here === null) return null;
  for (let j = currentIndex - 1; j >= 0; j--) {
    const p = pathOf(entries[j]?.url ?? null);
    if (p === null) return null; // 알 수 없는 기록 — 무리하지 않고 목록으로
    if (p !== here) return j - currentIndex;
  }
  return null;
}

function pathOf(url: string | null): string | null {
  if (!url) return null;
  try {
    return new URL(url).pathname.replace(/\/+$/, "") || "/";
  } catch {
    return null;
  }
}

// ───────── 2순위: 이 탭에서 사이트 안을 지나온 주소 기록(Navigation API 가 없을 때) ─────────
//   ★ 어긋나면 '덜 세는' 쪽으로 어긋나야 안전하다: 덜 세면 목록으로 갈 뿐이지만,
//     더 세면 router.back() 이 사이트 밖으로 나간다(2026-11-14 교차 검토: 로그인 가드의 replace 를
//     push 로 세서 '바로 구매 → 로그인 → 이전 → 이전'이 빈 화면으로 나갔다).

export type VisitKind = "push" | "replace" | "traverse";

/**
 * 주소가 바뀐 방식을 가린다.
 *   - popstate(브라우저 뒤로·앞으로·우리 버튼의 back) 직후 → traverse
 *   - history.length 가 늘었다 → push
 *   - 늘지 않았다 → replace(로그인 가드 등). 뒤로 간 다음 새로 이동한 push 도 여기로 오는데,
 *     그러면 한 칸 덜 세어 목록으로 갈 뿐이라 안전하다.
 */
export function classifyVisit(input: { traversal: boolean; lengthBefore: number; lengthNow: number }): VisitKind {
  if (input.traversal) return "traverse";
  return input.lengthNow > input.lengthBefore ? "push" : "replace";
}

/** 기록 갱신(최대 50개). */
export function nextStack(stack: readonly string[], path: string, kind: VisitKind): string[] {
  if (stack.at(-1) === path) return [...stack];
  if (kind === "push") return [...stack, path].slice(-50);
  if (kind === "replace") return stack.length ? [...stack.slice(0, -1), path] : [path];
  // traverse: 바로 앞이면 한 칸 빼고, 모르는 곳이면(앞으로 가기 등) 처음부터 — 덜 세는 쪽.
  if (stack.at(-2) === path) return stack.slice(0, -1);
  return [path];
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

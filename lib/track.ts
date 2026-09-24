import { getSupabase } from "./supabase";

// 퍼널 측정 — 익명 세션 기반 전환 이벤트(개인정보 없음).
//   브라우저마다 무작위 세션 ID 1개를 localStorage 에 두고, 단계 이벤트를 기록한다.

export type FunnelEvent = "visit" | "view_product" | "add_to_cart" | "begin_checkout" | "purchase";

function sessionId(): string {
  try {
    let id = localStorage.getItem("fnl_sid");
    if (!id) {
      id = crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      localStorage.setItem("fnl_sid", id);
    }
    return id;
  } catch {
    return "anon";
  }
}

// 익명 이벤트 기록. once=true 면 같은 세션에서 1회만 기록한다(중복 방지).
export function track(event: FunnelEvent, opts?: { once?: boolean }): void {
  if (typeof window === "undefined") return;
  try {
    if (opts?.once) {
      const k = `fnl_seen_${event}`;
      if (sessionStorage.getItem(k)) return;
      sessionStorage.setItem(k, "1");
    }
    // ★ .then() 을 반드시 붙인다 — supabase-js 의 쿼리 빌더는 '게으르다'.
    //   PostgrestBuilder 는 then() 안에서 비로소 fetch 를 시작한다. 그래서
    //   `void builder` 처럼 then 을 부르지 않으면 식만 만들어지고 요청은 나가지 않는다.
    //   이 한 줄이 빠져 있어 funnel_events 가 서비스 시작 이래 0건이었다(2026-09-24 발견).
    //   실패는 조용히 삼킨다 — 분석이 사용자 흐름을 막지 않는다. 다만 '보내기는' 한다.
    getSupabase()
      .from("funnel_events")
      .insert({ session_id: sessionId(), event, path: location.pathname })
      .then(
        () => {},
        () => {}
      );
  } catch {
    // 분석 실패가 사용자 흐름을 막지 않는다.
  }
}

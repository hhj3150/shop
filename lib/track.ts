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
    void getSupabase()
      .from("funnel_events")
      .insert({ session_id: sessionId(), event, path: location.pathname });
  } catch {
    // 분석 실패가 사용자 흐름을 막지 않는다.
  }
}

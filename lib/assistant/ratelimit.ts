import { createClient } from "@supabase/supabase-js";

// 공개 AI 엔드포인트 레이트리밋. Supabase RPC(assistant_rate_check) 고정창 카운터.
//   환경/마이그레이션 미설정·일시 오류 시에는 통과(fail-open) — 가용성을 우선하고,
//   보호는 마이그레이션 적용 후 동작한다.

// Netlify/프록시 환경에서 클라이언트 IP 추출.
export function clientIp(req: Request): string {
  return (
    req.headers.get("x-nf-client-connection-ip") ||
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

// true = 허용, false = 한도 초과(차단).
export async function checkRateLimit(ip: string, limit = 20, windowSeconds = 60): Promise<boolean> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anon) return true;
  try {
    const sb = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { data, error } = await sb.rpc("assistant_rate_check", {
      p_ip: ip,
      p_limit: limit,
      p_window_seconds: windowSeconds,
    });
    if (error) {
      console.warn("[ratelimit] RPC 오류(통과 처리):", error.message);
      return true;
    }
    return data !== false;
  } catch (e) {
    console.warn("[ratelimit] 실패(통과 처리):", e);
    return true;
  }
}

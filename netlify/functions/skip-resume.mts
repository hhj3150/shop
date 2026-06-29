import type { Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";

// '이번 주 건너뛰기' 자동재개 cron.
//   건너뛸 배송일이 지난 구독(skip_resume_on <= 오늘)을 정확히 1주(7일) 적립하고 재개한다.
//   검증된 일시정지 수학 재사용 — 총 회차 보존, 종료일만 +7. (RPC: auto_resume_skips)
export default async function handler(): Promise<Response> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secret = process.env.PAYMENT_RECOVERY_SECRET; // 운영 cron 공용 시크릿 재사용
  if (!url || !anon || !secret) {
    console.warn("[skip-resume] 미설정 — 건너뜀");
    return new Response("skip: not configured");
  }

  const sb = createClient(url, anon);
  const { data, error } = await sb.rpc("auto_resume_skips", { p_secret: secret });
  if (error) {
    console.error("[skip-resume] auto_resume_skips 실패:", error.message);
    return new Response("error", { status: 500 });
  }

  console.log(`[skip-resume] resumed=${data ?? 0}`);
  return new Response(`ok resumed=${data ?? 0}`);
}

// 매일 00:15 KST(15:15 UTC) — 전날까지 건너뛴 구독을 새 날 시작 직후 자동재개.
export const config: Config = { schedule: "15 15 * * *" };

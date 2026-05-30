"use client";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// 정적 프론트(Netlify)에서 anon key + RLS로 동작한다. 키 미설정 시 빌드는 통과하되
// 런타임에서 명확히 실패하도록 한다.
let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient {
  if (!url || !anonKey) {
    throw new Error(
      "Supabase 환경변수가 없습니다. NEXT_PUBLIC_SUPABASE_URL / NEXT_PUBLIC_SUPABASE_ANON_KEY를 설정하세요."
    );
  }
  if (!client) {
    client = createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true },
    });
  }
  return client;
}

// 환경변수가 갖춰졌는지 UI에서 미리 확인할 때 사용.
export const isSupabaseConfigured = Boolean(url && anonKey);

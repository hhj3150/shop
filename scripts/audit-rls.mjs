// 운영 Supabase RLS 실측 — 공개 anon 키로(인증 없이) PII 테이블을 직접 찔러본다.
// 공격자가 클라이언트 번들에서 얻는 것과 동일한 키. READ 전용·비파괴적.
//
//   실행: node scripts/audit-rls.mjs
//
// 자격증명 우선순위: .env.local 의 실제 값 → 없거나 placeholder면 라이브 번들에서 추출.
//
// 판정(중요):
//   🚨 누출      = HTTP 200 + PII 행이 1개 이상 반환됨
//   ✅ 안전      = 서버가 응답했고(0행 또는 권한거부코드) PII 없음
//   ⚠️ 미확정    = 연결 실패(네트워크/DNS) — RLS가 막은 게 아니라 도달조차 못함

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const LIVE = "https://shop.a2jerseymilk.com";

function loadEnv(path) {
  const env = {};
  try {
    for (const line of readFileSync(path, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (m) env[m[1]] = m[2].replace(/^["']|["']$/g, "");
    }
  } catch {}
  return env;
}

function isReal(url, key) {
  return (
    url && key &&
    /^https:\/\/[a-z0-9]+\.supabase\.co/.test(url) &&
    /^eyJ/.test(key) // anon 키는 JWT(eyJ...)
  );
}

// 라이브 번들에서 supabase URL + anon 키 추출(공격자 시점).
async function extractFromLive() {
  const html = await (await fetch(LIVE, { redirect: "follow" })).text();
  const chunks = [...html.matchAll(/\/_next\/static\/[A-Za-z0-9_/-]+\.js/g)].map((m) => m[0]);
  let url = (html.match(/https:\/\/[a-z0-9]+\.supabase\.co/) || [])[0];
  let key = (html.match(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/) || [])[0];
  for (const ch of [...new Set(chunks)]) {
    if (url && key) break;
    try {
      const js = await (await fetch(LIVE + ch)).text();
      url = url || (js.match(/https:\/\/[a-z0-9]+\.supabase\.co/) || [])[0];
      key = key || (js.match(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/) || [])[0];
    } catch {}
  }
  return { url, key };
}

const isNetErr = (e) =>
  !e ? false : /fetch failed|ENOTFOUND|ECONNREFUSED|EAI_AGAIN|network|getaddrinfo/i.test(e.message || "");

async function main() {
  const env = loadEnv(".env.local");
  let URL = env.NEXT_PUBLIC_SUPABASE_URL;
  let ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  let source = ".env.local";

  if (!isReal(URL, ANON)) {
    console.log("ℹ️  .env.local 이 placeholder/누락 → 라이브 번들에서 실키 추출 시도…");
    const ext = await extractFromLive();
    URL = ext.url; ANON = ext.key; source = "라이브 번들";
  }
  if (!isReal(URL, ANON)) {
    console.error("❌ 실제 Supabase URL/anon 키를 확보하지 못했습니다. 수동 제공 필요.");
    process.exit(2);
  }

  const ref = (URL.match(/https:\/\/([a-z0-9]+)\./) || [])[1];
  console.log(`\n대상: ${ref}.supabase.co  (출처: ${source}, anon·비로그인)\n`);

  const anon = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } });

  const PII = ["profiles","orders","order_items","subscription_slots","billing_keys","billing_charges","recurring_subscriptions","sms_log","referrals","referral_rewards","order_returns","orphan_deposits","member_admin_notes","reviews"];
  const PUBLIC_OK = ["product_catalog","subscription_day_count"];

  let leak = 0, safe = 0, incon = 0;

  const probe = async (t) => {
    const { data, error } = await anon.from(t).select("*").limit(2);
    const n = Array.isArray(data) ? data.length : 0;
    if (n > 0) { leak++; console.log(`🚨 누출   ${t.padEnd(24)} ${n}행! 컬럼: ${Object.keys(data[0]).slice(0,8).join(", ")}`); }
    else if (error && isNetErr(error)) { incon++; console.log(`⚠️ 미확정 ${t.padEnd(24)} 연결실패(${error.message.slice(0,40)}) — 도달 못함`); }
    else { safe++; console.log(`✅ 안전   ${t.padEnd(24)} ${error ? `권한거부(${error.code||error.message.slice(0,30)})` : "200·0행"}`); }
  };

  console.log("── PII 테이블: 인증 없이 조회 (서버응답+0행=안전 / 행반환=누출 / 연결실패=미확정) ──");
  for (const t of PII) await probe(t);

  console.log("\n── 공개 의도(대조군: 읽혀야 정상 = 연결·RLS 모두 살아있음을 증명) ──");
  for (const t of PUBLIC_OK) {
    const { data, error } = await anon.from(t).select("*").limit(1);
    const n = Array.isArray(data) ? data.length : 0;
    console.log(`   ${t.padEnd(24)} ${n>0?`${n}행(정상 공개)`:error?(isNetErr(error)?`⚠️연결실패`:`오류:${error.code||error.message.slice(0,30)}`):"0행"}`);
  }

  console.log("\n── 민감 RPC 게이트 ──");
  {
    const { data, error } = await anon.rpc("payment_recovery_targets", { p_secret: "wrong-" + "x".repeat(12) });
    const n = Array.isArray(data) ? data.length : 0;
    if (n>0){leak++;console.log(`🚨 누출   payment_recovery_targets  틀린시크릿인데 ${n}행(이름/전화) 반환!`);}
    else if (error && isNetErr(error)){incon++;console.log(`⚠️ 미확정 payment_recovery_targets  연결실패`);}
    else {safe++;console.log(`✅ 안전   payment_recovery_targets  거부(${error?(error.code||error.message.slice(0,30)):"0행"})`);}
  }
  {
    const { data, error } = await anon.rpc("list_reviews", { p_product_id: "milk-750" });
    if (error && isNetErr(error)){incon++;console.log(`⚠️ 미확정 list_reviews  연결실패`);}
    else if (error){console.log(`ℹ️  list_reviews  오류: ${error.code||error.message.slice(0,40)}`);}
    else {
      const rows=data||[]; const hasUid=rows.some(r=>"user_id" in r); const s=rows[0]?.author_name??"(없음)";
      const masked=/[*]/.test(s)||s==="(없음)";
      if(hasUid||(!masked&&rows.length>0)){leak++;console.log(`🚨 점검   list_reviews  실명/user_id 노출! 예시="${s}" uid=${hasUid}`);}
      else {safe++;console.log(`✅ 안전   list_reviews  ${rows.length}건·마스킹 예시="${s}"·user_id노출=${hasUid}`);}
    }
  }

  console.log("\n── 관리자 게이트: 비로그인(anon)이 admin RPC 호출 시 거부돼야 함 ──");
  for (const fn of ["referral_admin_list"]) {
    const { data, error } = await anon.rpc(fn, {});
    if (error && isNetErr(error)) { incon++; console.log(`⚠️ 미확정 ${fn}  연결실패`); }
    else if (error) { safe++; console.log(`✅ 안전   ${fn.padEnd(22)} 거부됨: "${(error.message||"").slice(0,40)}"`); }
    else { leak++; console.log(`🚨 누출   ${fn.padEnd(22)} 비관리자인데 데이터 반환! (${Array.isArray(data)?data.length:"obj"})`); }
  }
  // 보상 무효화(쓰기) — anon이 가짜 id로 호출. is_admin 가드면 '관리자만' 예외(데이터 변경 0).
  {
    const { error } = await anon.rpc("referral_reward_void", { p_id: "00000000-0000-0000-0000-000000000000", p_note: "audit" });
    if (error && isNetErr(error)) { incon++; console.log(`⚠️ 미확정 referral_reward_void  연결실패`); }
    else if (error) { safe++; console.log(`✅ 안전   referral_reward_void   거부됨: "${(error.message||"").slice(0,40)}"`); }
    else { leak++; console.log(`🚨 누출   referral_reward_void   비관리자가 보상 변경 성공!`); }
  }

  console.log(`\n────────────────────────────────`);
  console.log(`✅ 안전 ${safe} · 🚨 누출 ${leak} · ⚠️ 미확정 ${incon}`);
  if (leak>0) console.log("→ ⚠️ 누출 발견! 위 🚨 RLS 정책 즉시 점검.");
  else if (incon>0 && safe<=2) console.log("→ 대부분 연결 실패. 네트워크/자격증명 문제로 검증 불완전(안전 단정 불가).");
  else console.log("→ 인증 없는 외부인이 PII에 접근 불가. 운영 RLS 정상 작동 확인.");
  process.exit(leak>0?1:0);
}

main().catch((e)=>{console.error("스크립트 오류:",e);process.exit(3);});

import type { Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { isSolapiConfigured, sendInfo } from "../../lib/solapi";
import {
  decideRenewalStage,
  buildRenewalMessage,
  type RenewalTarget,
} from "../../lib/renewal-retention";

type TargetRow = {
  slot_id: number;
  name: string;
  phone: string;
  expiry_date: string; // 'YYYY-MM-DD'
  sent_stages: string[] | null;
};

export default async function handler(): Promise<Response> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secret = process.env.RENEWAL_REMINDER_SECRET;
  if (!url || !anon || !secret || !isSolapiConfigured()) {
    console.warn("[renewal-retention] 미설정 — 건너뜀");
    return new Response("skip: not configured");
  }

  const sb = createClient(url, anon);
  const { data, error } = await sb.rpc("renewal_reminder_targets", {
    p_secret: secret,
  });
  if (error) {
    console.error("[renewal-retention] targets 조회 실패:", error.message);
    return new Response("error", { status: 500 });
  }

  const now = new Date();
  let sent = 0;

  for (const row of (data ?? []) as TargetRow[]) {
    const t: RenewalTarget = {
      slotId: row.slot_id,
      name: row.name,
      phone: row.phone,
      expiryDate: row.expiry_date,
      sentStages: row.sent_stages ?? [],
    };
    const stage = decideRenewalStage(t.expiryDate, now, t.sentStages);
    if (stage === "none") continue;

    // 발송 전 원장 기록(확정 정책 — 중복 < 누락).
    const { error: recErr } = await sb.rpc("record_renewal_reminder", {
      p_secret: secret,
      p_slot_id: t.slotId,
      p_stage: stage,
      p_expiry: t.expiryDate,
    });
    if (recErr) {
      console.error(`[renewal-retention] 원장 기록 실패 slot=${t.slotId}:`, recErr.message);
      continue;
    }
    if (!t.phone) {
      console.warn(`[renewal-retention] 전화번호 없음 slot=${t.slotId}`);
      continue;
    }
    const m = buildRenewalMessage(t);
    const result = await sendInfo(t.phone, {
      text: m.text,
      subject: m.subject,
      alimtalk: { templateKey: m.templateKey, variables: m.variables },
    });
    if (!result.ok) {
      console.warn(`[renewal-retention] 발송 실패 slot=${t.slotId}:`, result);
    }
    sent += 1;
  }

  console.log(`[renewal-retention] sent=${sent}`);
  return new Response(`ok sent=${sent}`);
}

// 매일 00:00 UTC = 09:00 KST.
export const config: Config = { schedule: "0 0 * * *" };

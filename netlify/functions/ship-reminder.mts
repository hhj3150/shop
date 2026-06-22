import type { Config } from "@netlify/functions";
import { createClient } from "@supabase/supabase-js";
import { isSolapiConfigured, sendInfo } from "../../lib/solapi";
import {
  buildReminderTargets,
  buildShipReminderMessage,
  type ReminderOrder,
  type ReminderItem,
  type ReminderSlot,
} from "../../lib/ship-reminder";

type Dataset = {
  orders: ReminderOrder[];
  items: ReminderItem[];
  slots: ReminderSlot[];
  reminded: string[];
};

// 한국시각(KST) 기준 '내일' 발송일(YYYY-MM-DD). 저녁에 돌면 다음 영업일분을 예고한다.
function tomorrowKST(): string {
  const kstNow = new Date(Date.now() + 9 * 3600 * 1000);
  const t = new Date(
    Date.UTC(kstNow.getUTCFullYear(), kstNow.getUTCMonth(), kstNow.getUTCDate() + 1)
  );
  return t.toISOString().slice(0, 10);
}

export default async function handler(): Promise<Response> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anon = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const secret = process.env.PAYMENT_RECOVERY_SECRET; // 운영 cron 공용 시크릿 재사용
  if (!url || !anon || !secret || !isSolapiConfigured()) {
    console.warn("[ship-reminder] 미설정 — 건너뜀");
    return new Response("skip: not configured");
  }

  const shipDate = tomorrowKST();
  const sb = createClient(url, anon);
  const { data, error } = await sb.rpc("ship_reminder_dataset", {
    p_secret: secret,
    p_ship_date: shipDate,
  });
  if (error) {
    console.error("[ship-reminder] dataset 조회 실패:", error.message);
    return new Response("error", { status: 500 });
  }

  const ds = (data ?? {}) as Partial<Dataset>;
  const targets = buildReminderTargets({
    dateISO: shipDate,
    orders: ds.orders ?? [],
    items: ds.items ?? [],
    slots: ds.slots ?? [],
    remindedOrderIds: new Set(ds.reminded ?? []),
  });

  let sent = 0;
  for (const t of targets) {
    if (!t.shipPhone) continue;
    // 발송 전 원장 기록(확정 정책: 누락 < 중복). 재시도 시 중복 예고를 막는다.
    const { error: recErr } = await sb.rpc("record_ship_reminder", {
      p_secret: secret,
      p_order_id: t.orderId,
      p_ship_date: t.shipDate,
    });
    if (recErr) {
      console.error(`[ship-reminder] 원장 기록 실패 ${t.orderNo}:`, recErr.message);
      continue;
    }
    const m = buildShipReminderMessage(t);
    const result = await sendInfo(t.shipPhone, { text: m.text, subject: m.subject });
    if (!result.ok) {
      console.warn(`[ship-reminder] 발송 실패 ${t.orderNo}:`, result);
      continue;
    }
    sent += 1;
  }

  console.log(`[ship-reminder] date=${shipDate} targets=${targets.length} sent=${sent}`);
  return new Response(`ok date=${shipDate} sent=${sent}`);
}

// 매일 09:00 UTC = 18:00 KST — 다음날 발송분을 전날 저녁에 예고.
export const config: Config = { schedule: "0 9 * * *" };

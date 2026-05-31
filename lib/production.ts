// 생산·재고 관리 — 생산자용 데이터 모델.
//   생산자가 날짜별로 제품의 생산계획/실제생산을 기록하고,
//   확정 구독 수요(요일별 필요수량)와 비교해 부족·잉여를 파악한다.
//   원유(L) 환산은 제품 용량 합계에 손실/여유율을 더한 추정치다(생산자가 조정).
import { getSupabase } from "@/lib/supabase";
import { PRODUCTS } from "@/lib/products";

// 한 날짜·제품의 생산 기록 (production_logs 1행).
export type ProductionLog = {
  id?: string;
  prod_date: string; // YYYY-MM-DD
  product_key: string; // "A2 저지 헤이밀크 750mL"
  planned: number;
  produced: number;
  note: string | null;
};

// 생산 계획에 쓰는 표준 제품 키 — 주문 여부와 무관하게 전 SKU를 노출.
export const PRODUCTION_KEYS: readonly string[] = PRODUCTS.map(
  (p) => `${p.name} ${p.volume}`
);

// 제품 키 → 1개당 용량(mL). 용량 문자열("180mL")에서 숫자만 추출.
const VOLUME_ML: Readonly<Record<string, number>> = Object.fromEntries(
  PRODUCTS.map((p) => [`${p.name} ${p.volume}`, parseVolumeMl(p.volume)])
);

function parseVolumeMl(volume: string): number {
  const m = volume.match(/([0-9]+(?:\.[0-9]+)?)/);
  return m ? Math.round(parseFloat(m[1])) : 0;
}

export function volumeMl(productKey: string): number {
  return VOLUME_ML[productKey] ?? 0;
}

// 수량 입력(제품키→개수)을 받아 원유 환산(L)을 계산.
//   기본 환산 = Σ(용량mL × 개수) / 1000, 여기에 손실/여유율(lossPct, %)을 더한다.
//   정밀 수율이 아닌 운영용 추정치 — 생산자가 lossPct로 보정한다.
export function rawMilkLiters(
  quantities: Readonly<Record<string, number>>,
  lossPct: number
): number {
  const baseMl = PRODUCTION_KEYS.reduce(
    (sum, key) => sum + volumeMl(key) * (quantities[key] ?? 0),
    0
  );
  const factor = 1 + Math.max(0, lossPct) / 100;
  return Math.round((baseMl / 1000) * factor * 10) / 10;
}

// 특정 날짜의 생산 기록을 모두 조회 → 제품키로 인덱싱한 맵으로 반환.
export async function loadProduction(
  date: string
): Promise<Record<string, ProductionLog>> {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("production_logs")
      .select("id, prod_date, product_key, planned, produced, note")
      .eq("prod_date", date);
    if (error) throw error;
    const map: Record<string, ProductionLog> = {};
    for (const row of (data as ProductionLog[]) ?? []) {
      map[row.product_key] = row;
    }
    return map;
  } catch (error) {
    console.error("생산 기록 조회 실패:", error);
    throw new Error("생산 기록을 불러오지 못했습니다.");
  }
}

// 한 날짜의 생산 기록을 일괄 저장(upsert). (prod_date, product_key) 유니크 기준.
export async function saveProduction(rows: ProductionLog[]): Promise<void> {
  if (rows.length === 0) return;
  try {
    const sb = getSupabase();
    const payload = rows.map((r) => ({
      prod_date: r.prod_date,
      product_key: r.product_key,
      planned: Math.max(0, Math.round(r.planned)),
      produced: Math.max(0, Math.round(r.produced)),
      note: r.note?.trim() || null,
    }));
    const { error } = await sb
      .from("production_logs")
      .upsert(payload, { onConflict: "prod_date,product_key" });
    if (error) throw error;
  } catch (error) {
    console.error("생산 기록 저장 실패:", error);
    throw new Error("생산 기록 저장에 실패했습니다.");
  }
}

// 원유 입고 (당일 디투오로 들어온 원유 총량).
export type MilkIntake = { intake_date: string; liters: number; note: string | null };

// 특정 날짜의 원유 입고 기록 조회. 없으면 null.
export async function loadMilkIntake(date: string): Promise<MilkIntake | null> {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("milk_intakes")
      .select("intake_date, liters, note")
      .eq("intake_date", date)
      .maybeSingle();
    if (error) throw error;
    return (data as MilkIntake) ?? null;
  } catch (error) {
    console.error("원유 입고 조회 실패:", error);
    throw new Error("원유 입고 기록을 불러오지 못했습니다.");
  }
}

// 원유 입고 저장(upsert). intake_date 기준.
export async function saveMilkIntake(
  date: string,
  liters: number,
  note: string
): Promise<void> {
  try {
    const sb = getSupabase();
    const { error } = await sb
      .from("milk_intakes")
      .upsert(
        { intake_date: date, liters: Math.max(0, liters), note: note.trim() || null },
        { onConflict: "intake_date" }
      );
    if (error) throw error;
  } catch (error) {
    console.error("원유 입고 저장 실패:", error);
    throw new Error("원유 입고 저장에 실패했습니다.");
  }
}

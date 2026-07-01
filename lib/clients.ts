// 거래처(B2B) 관리 — 백화점·도매 등 송영신목장이 직접 납품하는 외부 거래처 명단과,
//   날짜·거래처·제품별 필요수량(b2b_demand)을 다룬다.
//   온라인 주문 수요와 합산해 "총 필요량"을 만들어 생산계획의 근거가 된다.
import { getSupabase } from "@/lib/supabase";

// 거래처 1곳 (clients 1행).
export type Client = {
  id: string;
  name: string;
  contact: string | null;
  memo: string | null;
  active: boolean;
};

// 한 날짜·거래처·제품의 B2B 필요수량 (b2b_demand 1행).
export type B2bDemand = {
  id?: string;
  demand_date: string; // YYYY-MM-DD
  client_id: string;
  product_key: string;
  qty: number;
};

// 활성 거래처 목록을 이름순으로 조회.
export async function loadClients(): Promise<Client[]> {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("clients")
      .select("id, name, contact, memo, active")
      .order("name", { ascending: true });
    if (error) throw error;
    return (data as Client[]) ?? [];
  } catch (error) {
    console.error("거래처 조회 실패:", error);
    throw new Error("거래처 명단을 불러오지 못했습니다.");
  }
}

// 거래처 등록. 빈 이름은 거부.
export async function addClient(
  name: string,
  contact?: string,
  memo?: string
): Promise<Client> {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("거래처 이름을 입력해 주세요.");
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("clients")
      .insert({
        name: trimmed,
        contact: contact?.trim() || null,
        memo: memo?.trim() || null,
      })
      .select("id, name, contact, memo, active")
      .single();
    if (error) throw error;
    return data as Client;
  } catch (error) {
    console.error("거래처 등록 실패:", error);
    throw new Error("거래처 등록에 실패했습니다.");
  }
}

// 거래처 활성/비활성 전환. 비활성 거래처는 필요량 입력 대상에서 빠진다.
export async function setClientActive(id: string, active: boolean): Promise<void> {
  try {
    const sb = getSupabase();
    const { error } = await sb.from("clients").update({ active }).eq("id", id);
    if (error) throw error;
  } catch (error) {
    console.error("거래처 상태 변경 실패:", error);
    throw new Error("거래처 상태를 변경하지 못했습니다.");
  }
}

// 특정 날짜의 B2B 필요수량을 모두 조회.
export async function loadB2bDemand(date: string): Promise<B2bDemand[]> {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("b2b_demand")
      .select("id, demand_date, client_id, product_key, qty")
      .eq("demand_date", date);
    if (error) throw error;
    return (data as B2bDemand[]) ?? [];
  } catch (error) {
    console.error("B2B 필요수량 조회 실패:", error);
    throw new Error("거래처 필요수량을 불러오지 못했습니다.");
  }
}

// 기간(from~to)의 B2B 필요수량을 모두 조회 — 생산계획 기간 집계용.
export async function loadB2bDemandRange(
  from: string,
  to: string
): Promise<B2bDemand[]> {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("b2b_demand")
      .select("id, demand_date, client_id, product_key, qty")
      .gte("demand_date", from)
      .lte("demand_date", to);
    if (error) throw error;
    return (data as B2bDemand[]) ?? [];
  } catch (error) {
    console.error("B2B 기간 필요수량 조회 실패:", error);
    throw new Error("거래처 기간 필요수량을 불러오지 못했습니다.");
  }
}

// 한 날짜의 B2B 필요수량 일괄 저장(upsert). (demand_date, client_id, product_key) 유니크 기준.
//   수량 0은 저장하지 않고 기존 행이 있으면 삭제해 깔끔히 유지한다.
export async function saveB2bDemand(
  date: string,
  rows: B2bDemand[]
): Promise<void> {
  try {
    const sb = getSupabase();
    const positive = rows.filter((r) => r.qty > 0);
    const payload = positive.map((r) => ({
      demand_date: date,
      client_id: r.client_id,
      product_key: r.product_key,
      qty: Math.max(0, Math.round(r.qty)),
    }));
    if (payload.length > 0) {
      const { error } = await sb
        .from("b2b_demand")
        .upsert(payload, { onConflict: "demand_date,client_id,product_key" });
      if (error) throw error;
    }
    // 0으로 비운 항목은 해당 날짜 행에서 삭제.
    const zero = rows.filter((r) => r.qty <= 0);
    for (const r of zero) {
      const { error } = await sb
        .from("b2b_demand")
        .delete()
        .eq("demand_date", date)
        .eq("client_id", r.client_id)
        .eq("product_key", r.product_key);
      if (error) throw error;
    }
  } catch (error) {
    console.error("B2B 필요수량 저장 실패:", error);
    throw new Error("거래처 필요수량 저장에 실패했습니다.");
  }
}

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
  shipped_at?: string | null; // 재고 출고(차감) 완료 시각. null=미출고.
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
      .select("id, demand_date, client_id, product_key, qty, shipped_at")
      .eq("demand_date", date);
    if (error) throw error;
    return (data as B2bDemand[]) ?? [];
  } catch (error) {
    console.error("B2B 필요수량 조회 실패:", error);
    throw new Error("거래처 필요수량을 불러오지 못했습니다.");
  }
}

// 청구(거래명세 스냅샷) 1행. (client_id, period_from, period_to) 유니크.
export type ClientInvoice = {
  id?: string;
  client_id: string;
  period_from: string; // YYYY-MM-DD
  period_to: string; // YYYY-MM-DD
  supply: number;
  tax: number;
  total: number;
  memo?: string | null;
  created_at?: string;
};

// 입금 1행.
export type ClientPayment = {
  id?: string;
  client_id: string;
  paid_on: string; // YYYY-MM-DD
  amount: number;
  method?: string | null;
  memo?: string | null;
  created_at?: string;
};

// 전체 청구 이력 조회(최신순).
export async function loadInvoices(): Promise<ClientInvoice[]> {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("client_invoices")
      .select("id, client_id, period_from, period_to, supply, tax, total, memo, created_at")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data as ClientInvoice[]) ?? [];
  } catch (error) {
    console.error("청구 이력 조회 실패:", error);
    throw new Error("청구 이력을 불러오지 못했습니다.");
  }
}

// 청구 스냅샷 일괄 확정(upsert). 같은 (거래처,기간)은 덮어쓴다 — 재확정 시 최신값 유지.
export async function upsertInvoices(rows: ClientInvoice[]): Promise<void> {
  const payload = rows.filter((r) => r.total > 0);
  if (payload.length === 0) return;
  try {
    const sb = getSupabase();
    const { error } = await sb
      .from("client_invoices")
      .upsert(
        payload.map((r) => ({
          client_id: r.client_id,
          period_from: r.period_from,
          period_to: r.period_to,
          supply: Math.max(0, Math.round(r.supply)),
          tax: Math.max(0, Math.round(r.tax)),
          total: Math.max(0, Math.round(r.total)),
          memo: r.memo ?? null,
        })),
        { onConflict: "client_id,period_from,period_to" }
      );
    if (error) throw error;
  } catch (error) {
    console.error("청구 확정 실패:", error);
    throw new Error("청구 확정에 실패했습니다.");
  }
}

// 전체 입금 이력 조회(최신순).
export async function loadPayments(): Promise<ClientPayment[]> {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("client_payments")
      .select("id, client_id, paid_on, amount, method, memo, created_at")
      .order("paid_on", { ascending: false });
    if (error) throw error;
    return (data as ClientPayment[]) ?? [];
  } catch (error) {
    console.error("입금 이력 조회 실패:", error);
    throw new Error("입금 이력을 불러오지 못했습니다.");
  }
}

// 입금 1건 기록.
export async function addPayment(p: ClientPayment): Promise<ClientPayment> {
  if (!(p.amount > 0)) throw new Error("입금액을 입력해 주세요.");
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("client_payments")
      .insert({
        client_id: p.client_id,
        paid_on: p.paid_on,
        amount: Math.max(0, Math.round(p.amount)),
        method: p.method?.trim() || null,
        memo: p.memo?.trim() || null,
      })
      .select("id, client_id, paid_on, amount, method, memo, created_at")
      .single();
    if (error) throw error;
    return data as ClientPayment;
  } catch (error) {
    console.error("입금 기록 실패:", error);
    throw new Error("입금 기록에 실패했습니다.");
  }
}

// 입금 1건 삭제.
export async function deletePayment(id: string): Promise<void> {
  try {
    const sb = getSupabase();
    const { error } = await sb.from("client_payments").delete().eq("id", id);
    if (error) throw error;
  } catch (error) {
    console.error("입금 삭제 실패:", error);
    throw new Error("입금 삭제에 실패했습니다.");
  }
}

// 거래처별 제품 납품 단가 (client_prices 1행).
export type ClientPrice = {
  id?: string;
  client_id: string;
  product_key: string;
  unit_price: number;
};

// 전체 거래처 단가를 조회 → client_id → (product_key → 단가) 맵.
export async function loadClientPrices(): Promise<
  Record<string, Record<string, number>>
> {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("client_prices")
      .select("client_id, product_key, unit_price");
    if (error) throw error;
    const map: Record<string, Record<string, number>> = {};
    for (const r of (data as ClientPrice[]) ?? []) {
      (map[r.client_id] ??= {})[r.product_key] = r.unit_price;
    }
    return map;
  } catch (error) {
    console.error("거래처 단가 조회 실패:", error);
    throw new Error("거래처 단가를 불러오지 못했습니다.");
  }
}

// 한 거래처의 제품 단가 일괄 저장(upsert). (client_id, product_key) 유니크 기준.
//   단가 0은 저장하지 않고 기존 행이 있으면 삭제해 깔끔히 유지한다.
export async function saveClientPrices(
  clientId: string,
  prices: Readonly<Record<string, number>>
): Promise<void> {
  try {
    const sb = getSupabase();
    const payload: ClientPrice[] = [];
    const zeroKeys: string[] = [];
    for (const [product_key, raw] of Object.entries(prices)) {
      const unit_price = Math.max(0, Math.round(raw || 0));
      if (unit_price > 0) payload.push({ client_id: clientId, product_key, unit_price });
      else zeroKeys.push(product_key);
    }
    if (payload.length > 0) {
      const { error } = await sb
        .from("client_prices")
        .upsert(payload, { onConflict: "client_id,product_key" });
      if (error) throw error;
    }
    for (const product_key of zeroKeys) {
      const { error } = await sb
        .from("client_prices")
        .delete()
        .eq("client_id", clientId)
        .eq("product_key", product_key);
      if (error) throw error;
    }
  } catch (error) {
    console.error("거래처 단가 저장 실패:", error);
    throw new Error("거래처 단가 저장에 실패했습니다.");
  }
}

// 한 날짜의 B2B 필요량을 재고에서 출고(차감)한다 — 멱등(이미 출고분은 건너뜀).
//   security definer RPC(b2b_ship_out) 경유. 반환: 차감 품목 수·수량.
export async function b2bShipOut(
  date: string
): Promise<{ products: number; qty: number }> {
  try {
    const sb = getSupabase();
    const { data, error } = await sb.rpc("b2b_ship_out", { p_demand_date: date });
    if (error) throw error;
    const r = (data as { products?: number; qty?: number }) ?? {};
    return { products: r.products ?? 0, qty: r.qty ?? 0 };
  } catch (error) {
    console.error("B2B 출고 처리 실패:", error);
    throw new Error(error instanceof Error ? error.message : "B2B 출고에 실패했습니다.");
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

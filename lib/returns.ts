// 환불/교환 워크플로 데이터 접근 — order_returns.
//   쓰기는 모두 SECURITY DEFINER RPC(관리자 전용)를 통한다.
import { getSupabase } from "@/lib/supabase";

export type ReturnType = "환불" | "교환";
export type ReturnStatus = "접수" | "승인" | "완료" | "반려";

export const RETURN_STATUSES: readonly ReturnStatus[] = [
  "접수",
  "승인",
  "완료",
  "반려",
];

// order_returns 1행.
export type OrderReturn = {
  id: string;
  order_id: string;
  type: ReturnType;
  status: ReturnStatus;
  reason: string | null;
  amount: number;
  resolution: string | null;
  created_at: string;
  resolved_at: string | null;
};

// 전체 환불/교환 내역(최신순). 관리자만 전체가 보인다.
export async function loadReturns(): Promise<OrderReturn[]> {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("order_returns")
      .select("id, order_id, type, status, reason, amount, resolution, created_at, resolved_at")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return (data as OrderReturn[]) ?? [];
  } catch (error) {
    console.error("환불/교환 내역 조회 실패:", error);
    throw new Error("환불/교환 내역을 불러오지 못했습니다.");
  }
}

// 접수 등록(관리자).
export async function createReturn(
  orderId: string,
  type: ReturnType,
  reason: string,
  amount: number
): Promise<void> {
  try {
    const sb = getSupabase();
    const { error } = await sb.rpc("create_order_return", {
      p_order_id: orderId,
      p_type: type,
      p_reason: reason.trim() || null,
      p_amount: Math.max(0, Math.round(amount)),
    });
    if (error) throw error;
  } catch (error) {
    console.error("환불/교환 접수 실패:", error);
    throw new Error(
      error instanceof Error ? error.message : "환불/교환 접수에 실패했습니다."
    );
  }
}

// 상태 전환 + 처리 메모(관리자).
export async function updateReturn(
  id: string,
  status: ReturnStatus,
  resolution: string
): Promise<void> {
  try {
    const sb = getSupabase();
    const { error } = await sb.rpc("update_order_return", {
      p_id: id,
      p_status: status,
      p_resolution: resolution.trim() || null,
    });
    if (error) throw error;
  } catch (error) {
    console.error("환불/교환 상태 변경 실패:", error);
    throw new Error(
      error instanceof Error ? error.message : "상태 변경에 실패했습니다."
    );
  }
}

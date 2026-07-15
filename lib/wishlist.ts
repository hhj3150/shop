// 찜하기(위시리스트) — wishlists 테이블(본인 행만 RLS 허용)에 대한 얇은 클라이언트.
//   product_id 는 카탈로그 텍스트 id. 실패는 호출부에서 처리(토글 UI는 원복).
import { getSupabase } from "./supabase";

// 내 찜 목록(product_id, 최신순).
export async function fetchWishlist(userId: string): Promise<string[]> {
  const { data, error } = await getSupabase()
    .from("wishlists")
    .select("product_id")
    .eq("user_id", userId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return ((data ?? []) as { product_id: string }[]).map((r) => r.product_id);
}

// 이 제품을 찜했는지.
export async function isWished(userId: string, productId: string): Promise<boolean> {
  const { data, error } = await getSupabase()
    .from("wishlists")
    .select("product_id")
    .eq("user_id", userId)
    .eq("product_id", productId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data !== null;
}

// 찜 추가 — 중복(이미 찜함)은 성공으로 간주(멱등).
export async function addWish(userId: string, productId: string): Promise<void> {
  const { error } = await getSupabase()
    .from("wishlists")
    .upsert({ user_id: userId, product_id: productId }, { onConflict: "user_id,product_id" });
  if (error) throw new Error(error.message);
}

// 찜 해제 — 없는 행 삭제도 성공(멱등).
export async function removeWish(userId: string, productId: string): Promise<void> {
  const { error } = await getSupabase()
    .from("wishlists")
    .delete()
    .eq("user_id", userId)
    .eq("product_id", productId);
  if (error) throw new Error(error.message);
}

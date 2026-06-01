import { getSupabase } from "./supabase";

export type ReviewRow = {
  id: string;
  user_id: string;
  product_id: string;
  author_name: string;
  rating: number; // 1–5
  body: string;
  created_at: string;
};

// 이름 마스킹: 첫 글자만 남기고 나머지는 *. (예: 하현제 → 하**)
export function maskName(name: string): string {
  const n = (name ?? "").trim();
  if (n.length <= 1) return n || "회원";
  return n[0] + "*".repeat(n.length - 1);
}

// 평균 별점 (소수 첫째 자리).
export function averageRating(reviews: ReviewRow[]): number {
  if (reviews.length === 0) return 0;
  const sum = reviews.reduce((s, r) => s + r.rating, 0);
  return Math.round((sum / reviews.length) * 10) / 10;
}

// 퍼널용 전체 후기 집계(순수). 후기 수·평균 별점·최근 N개를 함께 반환한다.
export type ReviewSummary = {
  count: number;
  average: number;
  recent: ReviewRow[];
};

export function reviewSummary(
  reviews: ReviewRow[],
  recentCount = 2
): ReviewSummary {
  return {
    count: reviews.length,
    average: averageRating(reviews),
    recent: reviews.slice(0, Math.max(0, recentCount)),
  };
}

export function formatReviewDate(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}.${pad(d.getMonth() + 1)}.${pad(d.getDate())}`;
}

export async function fetchReviews(productId: string): Promise<ReviewRow[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("reviews")
    .select("*")
    .eq("product_id", productId)
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ReviewRow[];
}

// 제품 구분 없이 전체 후기를 최신순으로 가져온다(퍼널 소셜 프루프 집계용).
export async function fetchAllReviews(): Promise<ReviewRow[]> {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from("reviews")
    .select("*")
    .order("created_at", { ascending: false });
  if (error) throw new Error(error.message);
  return (data ?? []) as ReviewRow[];
}

export async function createReview(
  userId: string,
  productId: string,
  authorName: string,
  rating: number,
  body: string
): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("reviews").insert({
    user_id: userId,
    product_id: productId,
    author_name: authorName.trim(),
    rating,
    body: body.trim(),
  });
  if (error) throw new Error(error.message);
}

export async function deleteReview(id: string): Promise<void> {
  const supabase = getSupabase();
  const { error } = await supabase.from("reviews").delete().eq("id", id);
  if (error) throw new Error(error.message);
}

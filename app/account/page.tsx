"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useAuth } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { formatKRW } from "@/lib/products";

type OrderRow = {
  id: string;
  order_no: string;
  status: string;
  total_amount: number;
  created_at: string;
};

export default function AccountPage() {
  const router = useRouter();
  const { ready, user, profile, signOut } = useAuth();
  const [orders, setOrders] = useState<OrderRow[]>([]);

  useEffect(() => {
    if (ready && !user) router.replace("/login?next=/account");
  }, [ready, user, router]);

  useEffect(() => {
    if (!user) return;
    getSupabase()
      .from("orders")
      .select("id, order_no, status, total_amount, created_at")
      .order("created_at", { ascending: false })
      .then(({ data }) => setOrders((data as OrderRow[]) ?? []));
  }, [user]);

  if (!ready || !user) {
    return (
      <div className="mx-auto max-w-md px-5 pt-28 text-center text-mute sm:px-8">
        불러오는 중…
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl px-5 pb-24 pt-28 sm:px-8">
      <div className="flex items-end justify-between">
        <div>
          <p className="eyebrow text-gold-deep">My Page</p>
          <h1 className="mt-3 font-serif-kr text-[clamp(1.7rem,5vw,2.3rem)] font-medium text-ink">
            {profile?.name ?? "회원"}님
          </h1>
        </div>
        <button
          onClick={() => signOut().then(() => router.push("/"))}
          className="rounded-full border border-line px-4 py-2 text-[14px] text-ink-soft transition-colors hover:border-gold hover:text-gold"
        >
          로그아웃
        </button>
      </div>

      {profile && (
        <div className="mt-8 rounded-2xl border border-line bg-cream p-6 text-[14px] leading-relaxed text-ink-soft">
          <p>{profile.phone}</p>
          {profile.address && (
            <p className="mt-1 text-mute">
              ({profile.postcode}) {profile.address} {profile.address_detail}
            </p>
          )}
          {profile.is_admin && (
            <Link
              href="/admin"
              className="mt-4 inline-flex rounded-full bg-ink px-5 py-2.5 text-[14px] text-cream transition-colors hover:bg-gold-deep"
            >
              관리자 모드
            </Link>
          )}
        </div>
      )}

      <h2 className="mt-12 font-serif-kr text-lg text-ink">주문 내역</h2>
      {orders.length === 0 ? (
        <p className="mt-4 text-[14px] text-mute">
          아직 주문이 없습니다.{" "}
          <Link href="/#products" className="text-gold-deep underline">
            제품 보러 가기
          </Link>
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-line rounded-2xl border border-line bg-cream">
          {orders.map((o) => (
            <li key={o.id} className="flex items-center justify-between px-5 py-4">
              <div>
                <p className="text-[14px] tabular-nums text-ink">{o.order_no}</p>
                <p className="mt-0.5 text-[13px] text-mute">
                  {new Date(o.created_at).toLocaleDateString("ko-KR")}
                </p>
              </div>
              <div className="text-right">
                <p className="text-[13px] font-medium text-gold-deep">{o.status}</p>
                <p className="mt-0.5 text-[14px] tabular-nums text-ink">
                  {formatKRW(o.total_amount)}
                </p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

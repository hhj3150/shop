"use client";

// 관리자: 업계 소식 레이더 — 주 1회 자동 수집 + 검색·큐레이션.
//   종합관리 탭이 복잡해져 별도 섹션으로 분리했다(소식 전하기와 동일 패턴).
import { useEffect } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useAuth } from "@/lib/auth";
import { NewsRadarAdminFeed } from "@/components/NewsRadarAdminFeed";

export default function AdminNewsRadarPage() {
  const router = useRouter();
  const { ready, user, profile, profileLoaded } = useAuth();
  const isAdmin = Boolean(profile?.is_admin);

  useEffect(() => {
    if (ready && !user) router.replace("/login?next=/admin/news-radar");
  }, [ready, user, router]);

  if (!ready || (user && !profileLoaded)) {
    return <div className="mx-auto max-w-md px-5 pt-28 text-center text-mute">불러오는 중…</div>;
  }
  if (!user) return null;
  if (!isAdmin) {
    return (
      <div className="mx-auto max-w-md px-5 pt-28 text-center">
        <p className="font-serif-kr text-lg text-ink">관리자 전용 페이지입니다.</p>
        <p className="mt-2 text-[14px] text-mute">
          {profile === null ? "프로필이 아직 없습니다." : "접근 권한이 없습니다."}
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-5 pb-24 pt-28 sm:px-8">
      <div className="flex items-end justify-between">
        <div>
          <p className="eyebrow text-gold-deep">Admin · 소식 레이더</p>
          <h1 className="mt-2 font-serif-kr text-[clamp(1.6rem,4vw,2.2rem)] font-medium text-ink">
            업계 소식 레이더
          </h1>
        </div>
        <Link
          href="/admin"
          className="rounded-full border border-line px-4 py-2 text-[14px] text-ink-soft hover:border-gold hover:text-gold"
        >
          ← 물류 ERP
        </Link>
      </div>

      <div className="mt-8">
        <NewsRadarAdminFeed />
      </div>
    </div>
  );
}

"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import Image from "next/image";
import { useAuth } from "@/lib/auth";
import { getSupabase } from "@/lib/supabase";
import { formatBody, formatTitle, youtubeId, type NewsRow } from "@/lib/news";

type Draft = {
  id: string | null;
  title: string;
  body: string;
  cover_url: string | null;
  youtubeInput: string;
  published: boolean;
};

const EMPTY: Draft = {
  id: null,
  title: "",
  body: "",
  cover_url: null,
  youtubeInput: "",
  published: false,
};

function extFromName(name: string): string {
  const m = name.toLowerCase().match(/\.(jpe?g|png|webp|gif)$/);
  return m ? m[0] : ".jpg";
}

export default function AdminNewsPage() {
  const router = useRouter();
  const { ready, user, profile, profileLoaded } = useAuth();
  const isAdmin = Boolean(profile?.is_admin);

  const [rows, setRows] = useState<NewsRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    if (ready && !user) router.replace("/login?next=/admin/news");
  }, [ready, user, router]);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await getSupabase()
      .from("news")
      .select("*")
      .order("created_at", { ascending: false });
    setRows((data as NewsRow[]) ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    if (isAdmin) load();
  }, [isAdmin, load]);

  function editRow(r: NewsRow) {
    setDraft({
      id: r.id,
      title: r.title,
      body: r.body,
      cover_url: r.cover_url,
      youtubeInput: r.youtube_id ?? "",
      published: r.published,
    });
    setMsg(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function resetDraft() {
    setDraft(EMPTY);
    setMsg(null);
  }

  async function onUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    if (file.size > 8 * 1024 * 1024) {
      setMsg("이미지는 8MB 이하만 올릴 수 있습니다.");
      return;
    }
    setUploading(true);
    setMsg(null);
    const sb = getSupabase();
    const path = `${crypto.randomUUID()}${extFromName(file.name)}`;
    const { error } = await sb.storage.from("news").upload(path, file, {
      cacheControl: "3600",
      upsert: false,
    });
    if (error) {
      setMsg(`이미지 업로드 실패: ${error.message}`);
      setUploading(false);
      return;
    }
    const { data } = sb.storage.from("news").getPublicUrl(path);
    setDraft((d) => ({ ...d, cover_url: data.publicUrl }));
    setUploading(false);
  }

  async function save(publish: boolean) {
    const title = formatTitle(draft.title);
    const body = formatBody(draft.body);
    if (!title || !body) {
      setMsg("제목과 내용을 입력해 주세요.");
      return;
    }
    setSaving(true);
    setMsg(null);
    const sb = getSupabase();
    const payload = {
      title,
      body,
      cover_url: draft.cover_url,
      youtube_id: youtubeId(draft.youtubeInput),
      published: publish,
      updated_at: new Date().toISOString(),
    };
    const res = draft.id
      ? await sb.from("news").update(payload).eq("id", draft.id)
      : await sb.from("news").insert(payload);
    setSaving(false);
    if (res.error) {
      setMsg(`저장 실패: ${res.error.message}`);
      return;
    }
    setMsg(publish ? "게시했습니다." : "초안으로 저장했습니다.");
    resetDraft();
    await load();
  }

  async function togglePublish(r: NewsRow) {
    await getSupabase()
      .from("news")
      .update({ published: !r.published, updated_at: new Date().toISOString() })
      .eq("id", r.id);
    await load();
  }

  async function remove(r: NewsRow) {
    if (!window.confirm(`"${r.title}" 소식을 삭제할까요? 되돌릴 수 없습니다.`)) return;
    await getSupabase().from("news").delete().eq("id", r.id);
    await load();
  }

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

  const ytPreview = youtubeId(draft.youtubeInput);

  return (
    <div className="mx-auto max-w-3xl px-5 pb-24 pt-28 sm:px-8">
      <div className="flex items-end justify-between">
        <div>
          <p className="eyebrow text-gold-deep">Admin · 소식 전하기</p>
          <h1 className="mt-2 font-serif-kr text-[clamp(1.6rem,4vw,2.2rem)] font-medium text-ink">
            {draft.id ? "소식 수정" : "새 소식 작성"}
          </h1>
        </div>
        <Link
          href="/admin"
          className="rounded-full border border-line px-4 py-2 text-[14px] text-ink-soft hover:border-gold hover:text-gold"
        >
          ← 물류 ERP
        </Link>
      </div>

      {/* 편집 폼 */}
      <div className="mt-8 space-y-5 rounded-3xl border border-line bg-cream p-5 sm:p-7">
        <label className="block">
          <span className="text-[13px] uppercase tracking-[0.14em] text-mute">제목</span>
          <input
            value={draft.title}
            onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
            placeholder="예) 5월 셋째 주, 목장 소식"
            className="mt-2 w-full rounded-xl border border-line bg-paper px-4 py-3 text-[15px] text-ink outline-none focus:border-gold"
          />
        </label>

        <label className="block">
          <span className="text-[13px] uppercase tracking-[0.14em] text-mute">내용</span>
          <textarea
            value={draft.body}
            onChange={(e) => setDraft((d) => ({ ...d, body: e.target.value }))}
            rows={9}
            placeholder="줄바꿈으로 문단을 나눠 주세요. 게시 시 서식이 자동으로 정리됩니다."
            className="mt-2 w-full resize-y rounded-xl border border-line bg-paper px-4 py-3 text-[15px] leading-relaxed text-ink outline-none focus:border-gold"
          />
        </label>

        {/* 이미지 */}
        <div>
          <span className="text-[13px] uppercase tracking-[0.14em] text-mute">대표 사진</span>
          <div className="mt-2 flex items-center gap-4">
            {draft.cover_url ? (
              <div className="relative h-24 w-24 overflow-hidden rounded-xl border border-line bg-paper">
                <Image src={draft.cover_url} alt="" fill className="object-cover" sizes="96px" />
              </div>
            ) : null}
            <div className="flex flex-col gap-2">
              <label className="inline-flex cursor-pointer rounded-full border border-line px-4 py-2 text-[14px] text-ink-soft hover:border-gold hover:text-gold">
                {uploading ? "올리는 중…" : draft.cover_url ? "사진 변경" : "사진 올리기"}
                <input type="file" accept="image/*" onChange={onUpload} className="hidden" disabled={uploading} />
              </label>
              {draft.cover_url && (
                <button
                  type="button"
                  onClick={() => setDraft((d) => ({ ...d, cover_url: null }))}
                  className="text-left text-[13px] text-mute underline-offset-2 hover:underline"
                >
                  사진 제거
                </button>
              )}
            </div>
          </div>
        </div>

        {/* 유튜브 */}
        <label className="block">
          <span className="text-[13px] uppercase tracking-[0.14em] text-mute">유튜브 링크 (선택)</span>
          <input
            value={draft.youtubeInput}
            onChange={(e) => setDraft((d) => ({ ...d, youtubeInput: e.target.value }))}
            placeholder="https://youtu.be/..."
            className="mt-2 w-full rounded-xl border border-line bg-paper px-4 py-3 text-[14px] text-ink outline-none focus:border-gold"
          />
          {draft.youtubeInput && (
            <span className={`mt-1 block text-[13px] ${ytPreview ? "text-gold-deep" : "text-mute"}`}>
              {ytPreview ? `인식됨 · ${ytPreview}` : "유튜브 주소를 인식하지 못했습니다."}
            </span>
          )}
        </label>

        {msg && <p className="text-[14px] text-gold-deep">{msg}</p>}

        <div className="flex flex-wrap gap-2 pt-1">
          <button
            onClick={() => save(true)}
            disabled={saving || uploading}
            className="rounded-full bg-ink px-6 py-3 text-[14px] font-medium text-cream transition-transform hover:scale-[1.02] disabled:opacity-50"
          >
            {saving ? "저장 중…" : "홈에 게시"}
          </button>
          <button
            onClick={() => save(false)}
            disabled={saving || uploading}
            className="rounded-full border border-line px-6 py-3 text-[14px] text-ink-soft hover:border-gold hover:text-gold disabled:opacity-50"
          >
            초안 저장
          </button>
          {draft.id && (
            <button
              onClick={resetDraft}
              className="rounded-full px-4 py-3 text-[14px] text-mute hover:text-ink"
            >
              새 글로
            </button>
          )}
        </div>
      </div>

      {/* 목록 */}
      <h2 className="mt-12 font-serif-kr text-lg text-ink">게시된 소식</h2>
      {loading ? (
        <p className="mt-4 text-[14px] text-mute">불러오는 중…</p>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-[14px] text-mute">아직 작성한 소식이 없습니다.</p>
      ) : (
        <ul className="mt-4 divide-y divide-line border-y border-line">
          {rows.map((r, i) => (
            <li key={r.id} className="flex items-center gap-4 py-4">
              <span className="w-6 shrink-0 text-center text-[13px] font-semibold tabular-nums text-mute">
                {rows.length - i}
              </span>
              {r.cover_url ? (
                <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-lg border border-line bg-paper">
                  <Image src={r.cover_url} alt="" fill className="object-cover" sizes="56px" />
                </div>
              ) : (
                <div className="h-14 w-14 shrink-0 rounded-lg border border-line bg-paper" />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-[15px] text-ink">{r.title}</p>
                <p className="mt-0.5 text-[13px] text-mute">
                  {new Date(r.created_at).toLocaleDateString("ko-KR")}
                  {r.youtube_id ? " · 영상" : ""}
                  {" · "}
                  <span className={r.published ? "text-gold-deep" : "text-mute"}>
                    {r.published ? "게시됨" : "초안"}
                  </span>
                </p>
              </div>
              <div className="flex shrink-0 gap-1.5">
                <button
                  onClick={() => editRow(r)}
                  className="rounded-full border border-line px-3 py-1.5 text-[13px] text-ink-soft hover:border-gold hover:text-gold"
                >
                  수정
                </button>
                <button
                  onClick={() => togglePublish(r)}
                  className="rounded-full border border-line px-3 py-1.5 text-[13px] text-ink-soft hover:border-gold hover:text-gold"
                >
                  {r.published ? "숨기기" : "게시"}
                </button>
                <button
                  onClick={() => remove(r)}
                  className="rounded-full border border-line px-3 py-1.5 text-[13px] text-mute hover:border-red-300 hover:text-red-500"
                >
                  삭제
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

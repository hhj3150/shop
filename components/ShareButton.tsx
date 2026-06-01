"use client";

import { useState } from "react";
import { shareOrCopy, type SharePayload } from "@/lib/share";
import { SITE_URL } from "@/lib/site";

const PAYLOAD: SharePayload = {
  title: "송영신목장 · A2 저지 헤이밀크",
  text: "하루 500리터 한정, 선착순 500인 회원제. 송영신목장의 A2 저지 헤이밀크를 함께 받아요.",
  url: SITE_URL,
};

export function ShareButton() {
  const [toast, setToast] = useState<string | null>(null);

  async function onShare() {
    const nav =
      typeof navigator !== "undefined"
        ? navigator
        : (undefined as unknown as Navigator);
    const res = await shareOrCopy(
      {
        share: nav?.share ? (data) => nav.share(data) : undefined,
        writeText: (t) => nav.clipboard.writeText(t),
      },
      PAYLOAD
    );
    if (res === "copied") {
      setToast("링크가 복사됐어요. 카톡에 붙여넣어 보내보세요.");
      setTimeout(() => setToast(null), 3000);
    }
  }

  return (
    <div className="mt-8 rounded-2xl border border-line bg-cream p-6">
      <p className="text-[15px] font-medium text-ink">친구에게 송영신목장 알리기</p>
      <p className="mt-1 text-[13px] leading-relaxed text-mute">
        소중한 분께 한 잔의 정직함을 권해보세요. 남은 자리는 선착순입니다.
      </p>
      <button
        onClick={onShare}
        aria-label="송영신목장 사이트를 친구에게 공유하기"
        className="mt-4 inline-flex rounded-full bg-ink px-5 py-2.5 text-[14px] text-cream transition-colors hover:bg-gold-deep"
      >
        공유하기
      </button>
      {toast && (
        <p role="status" className="mt-3 text-[13px] text-gold-deep">
          {toast}
        </p>
      )}
    </div>
  );
}

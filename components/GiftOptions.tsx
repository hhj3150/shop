"use client";

import { useEffect, useState } from "react";
import { loadRecipients, type Recipient } from "@/lib/recipients";

// 체크아웃(정기·단품) 공통 선물 옵션. "나에게 받기 / 선물하기" 토글과
//   주소록에서 받는 분 선택, 선물 메시지 입력을 담당한다.
//   배송지 입력 필드 자체는 부모 페이지가 소유하며, 받는 분 선택 시
//   onSelectRecipient 로 그 값을 채운다.
export function GiftOptions({
  userId,
  isGift,
  giftMessage,
  onModeChange,
  onMessageChange,
  onSelectRecipient,
}: {
  userId: string;
  isGift: boolean;
  giftMessage: string;
  onModeChange: (isGift: boolean) => void;
  onMessageChange: (msg: string) => void;
  onSelectRecipient: (r: Recipient) => void;
}) {
  const [recipients, setRecipients] = useState<Recipient[]>([]);
  const [selectedId, setSelectedId] = useState("");

  useEffect(() => {
    if (!isGift) return;
    loadRecipients(userId)
      .then(setRecipients)
      .catch(() => setRecipients([]));
  }, [userId, isGift]);

  const tabClass = (active: boolean) =>
    `flex-1 rounded-full py-2.5 text-[14px] font-medium transition-colors ${
      active
        ? "bg-ink text-cream"
        : "bg-transparent text-ink-soft hover:text-ink"
    }`;

  return (
    <div className="rounded-2xl border border-line bg-paper-2 p-5">
      <div className="flex gap-1 rounded-full border border-line bg-cream p-1">
        <button type="button" onClick={() => onModeChange(false)} className={tabClass(!isGift)}>
          나에게 받기
        </button>
        <button type="button" onClick={() => onModeChange(true)} className={tabClass(isGift)}>
          선물하기
        </button>
      </div>

      {isGift && (
        <div className="mt-4 space-y-3">
          {recipients.length > 0 && (
            <label className="block text-[13px] font-medium text-ink-soft">
              주소록에서 받는 분 선택
              <select
                value={selectedId}
                onChange={(e) => {
                  const id = e.target.value;
                  setSelectedId(id);
                  const r = recipients.find((x) => x.id === id);
                  if (r) onSelectRecipient(r);
                }}
                className="mt-2 w-full rounded-xl border border-line bg-cream px-4 py-3 text-[16px] text-ink outline-none transition-colors focus:border-gold"
              >
                <option value="">직접 입력</option>
                {recipients.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                    {r.memo ? ` (${r.memo})` : ""}
                  </option>
                ))}
              </select>
            </label>
          )}
          <p className="text-[13px] leading-relaxed text-mute">
            받는 분 정보를 아래에 입력해 주세요. 자주 보내는 분은 마이페이지 주소록에
            저장해 두면 다음부터 선택만 하면 됩니다. 선물 안내 문자가 받는 분께
            발송됩니다.
          </p>
          <label className="block text-[13px] font-medium text-ink-soft">
            선물 메시지 (선택)
            <textarea
              value={giftMessage}
              onChange={(e) => onMessageChange(e.target.value)}
              rows={2}
              maxLength={80}
              placeholder="예: 건강하게 잘 드세요. — 할아버지가"
              className="mt-2 w-full rounded-xl border border-line bg-cream px-4 py-3 text-[16px] text-ink outline-none transition-colors placeholder:text-mute/60 focus:border-gold"
            />
          </label>
        </div>
      )}
    </div>
  );
}

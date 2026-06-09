"use client";

// Customer360 드로어 액션: CS 메모(관리자 내부 기록) + 단건 문자 발송.
//   문자는 정보성(거래·CS) 전용 — 광고성은 단체문자 (광고) 경로를 쓰도록 라벨로 안내한다.
//   저장/발송은 호출 측(page.tsx)의 핸들러에 위임한다.

import { useEffect, useState } from "react";

export function Customer360Actions({
  memo,
  onSaveMemo,
  onSendSms,
}: {
  memo: string;
  onSaveMemo: (memo: string) => Promise<void>;
  // 회원 연락처가 없으면 호출 측에서 undefined.
  onSendSms?: (message: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(memo);
  // memo 는 호출 측에서 비동기로 도착한다(드로어는 memo="" 로 먼저 마운트됨). 도착·갱신 시
  //   draft 에 반영하되, 관리자가 이미 입력을 시작했다면 30초 폴링 갱신이 편집분을 덮어쓰지
  //   않게 보존한다. 드로어가 회원별 key 로 remount 되므로 edited 는 회원 전환 시 초기화된다.
  const [edited, setEdited] = useState(false);
  useEffect(() => {
    if (!edited) setDraft(memo);
  }, [memo, edited]);
  const [savingMemo, setSavingMemo] = useState(false);
  const [memoNote, setMemoNote] = useState<string | null>(null);

  const [sms, setSms] = useState("");
  const [sending, setSending] = useState(false);
  const [smsNote, setSmsNote] = useState<string | null>(null);

  const memoDirty = draft !== memo;

  async function handleSaveMemo() {
    setSavingMemo(true);
    setMemoNote(null);
    try {
      await onSaveMemo(draft);
      // 저장 성공 후엔 서버값 = draft. 편집 플래그를 풀어 이후 폴링 갱신과 다시 동기화되게 한다.
      setEdited(false);
      setMemoNote("저장됨");
    } catch (e) {
      setMemoNote(e instanceof Error ? e.message : "저장 실패");
    } finally {
      setSavingMemo(false);
    }
  }

  async function handleSendSms() {
    const message = sms.trim();
    if (!message || !onSendSms) return;
    if (
      !window.confirm(
        "이 회원에게 정보성(주문·CS) 문자를 발송할까요?\n광고성 내용은 보낼 수 없습니다(단체문자 (광고) 발송을 사용하세요)."
      )
    )
      return;
    setSending(true);
    setSmsNote(null);
    try {
      await onSendSms(message);
      setSms("");
      setSmsNote("발송됨 — 복기 타임라인에 기록됩니다.");
    } catch (e) {
      setSmsNote(e instanceof Error ? e.message : "발송 실패");
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="mt-5 space-y-4">
      {/* CS 메모 — 관리자 내부 기록(고객 비노출) */}
      <div>
        <div className="flex items-center justify-between">
          <p className="eyebrow text-gold-deep">CS 메모 (내부)</p>
          {memoNote && <span className="text-[12px] text-mute">{memoNote}</span>}
        </div>
        <textarea
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setEdited(true);
            setMemoNote(null);
          }}
          rows={3}
          placeholder="고객 응대 특이사항(민원 이력·배송 요청 등). 고객에게는 보이지 않습니다."
          className="mt-2 w-full resize-y rounded-xl border border-line bg-paper px-3 py-2 text-[13px] text-ink placeholder:text-mute focus:border-gold focus:outline-none"
        />
        <div className="mt-1.5 flex justify-end">
          <button
            onClick={handleSaveMemo}
            disabled={!memoDirty || savingMemo}
            className="rounded-full bg-ink px-3.5 py-1.5 text-[13px] text-cream transition-colors hover:bg-gold-deep disabled:cursor-not-allowed disabled:opacity-40"
          >
            {savingMemo ? "저장 중…" : "메모 저장"}
          </button>
        </div>
      </div>

      {/* 단건 문자 — 정보성(거래·CS) 전용 */}
      {onSendSms && (
        <div>
          <div className="flex items-center justify-between">
            <p className="eyebrow text-gold-deep">문자 보내기</p>
            {smsNote && <span className="text-[12px] text-mute">{smsNote}</span>}
          </div>
          <p className="mt-1 text-[12px] text-mute">
            정보성(주문·CS) 안내만 — 광고성은 단체문자 (광고) 발송을 사용하세요.
          </p>
          <textarea
            value={sms}
            onChange={(e) => {
              setSms(e.target.value);
              setSmsNote(null);
            }}
            rows={3}
            placeholder="예: 입금이 확인되었습니다. 수요일에 발송 예정이에요."
            className="mt-2 w-full resize-y rounded-xl border border-line bg-paper px-3 py-2 text-[13px] text-ink placeholder:text-mute focus:border-gold focus:outline-none"
          />
          <div className="mt-1.5 flex justify-end">
            <button
              onClick={handleSendSms}
              disabled={!sms.trim() || sending}
              className="rounded-full border border-gold px-3.5 py-1.5 text-[13px] text-gold-deep transition-colors hover:bg-gold/10 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {sending ? "발송 중…" : "문자 발송"}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

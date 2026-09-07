"use client";

// 관리자 단체문자 공지/광고 발송 패널.
// 수신자를 필터(전체·구매고객·활성구독자·단품구매·요일별)로 고르고 개별 체크 해제하거나
// 직접 번호를 입력한다. 본문은 글자수(EUC-KR 바이트)로 SMS/LMS를 자동 판별한다.
// 실제 발송 시 광고성 법적 의무(광고 표기·수신거부·야간차단)는 서버에서 강제한다.
//
// ★ 「광고/홍보」 기본값은 꺼짐이다. 배송 일정·휴무 같은 공지는 광고가 아니며, 광고로 보내면
//   수신 미동의 고객이 명단에서 통째로 빠진다(2026-08-12 하절기 휴가 안내 미수신 사고).
//   광고를 켰을 때 몇 명이 제외되는지는 selectRecipients 가 돌려주는 adExcluded 로 항상 띄운다.

import { useMemo, useState } from "react";
import { getSupabase } from "@/lib/supabase";
import { DELIVERY_DAYS, DELIVERY_DAY_LABEL } from "@/lib/cart";
import { SMS_PRESETS, fillPreset } from "@/lib/admin-sms";
import {
  selectRecipients,
  type FilterKey,
  type RecipientOrder,
  type RecipientSlot,
} from "@/lib/broadcast-recipients";

type ProfileLite = { id: string; name: string; phone: string; marketing_consent?: boolean };
type SlotLite = RecipientSlot;
type OrderLite = RecipientOrder;

// EUC-KR 기준 바이트(한글 2바이트). 90바이트 초과 시 LMS.
function eucKrBytes(s: string): number {
  let n = 0;
  for (let i = 0; i < s.length; i++) n += s.charCodeAt(i) <= 0x7f ? 1 : 2;
  return n;
}

function normalizePhone(s: string): string {
  return s.replace(/[^0-9]/g, "");
}

export function BroadcastPanel({
  profiles,
  slots,
  orders,
}: {
  profiles: ProfileLite[];
  slots: SlotLite[];
  orders: OrderLite[];
}) {
  const [filters, setFilters] = useState<Set<FilterKey>>(new Set());
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [manual, setManual] = useState("");
  // 개별 회원 검색·선택(이름/번호로 1:1 발송). picked = 선택된 회원 id, presetName = 프리셋 {이름} 치환용.
  const [memberQuery, setMemberQuery] = useState("");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [presetName, setPresetName] = useState("");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  // 기본은 '공지'. 대부분의 단체문자는 배송·휴무 안내라 광고가 아니다.
  const [isAd, setIsAd] = useState(false);
  // 기본값을 비워 둔다 — "무료수신거부" 다섯 글자만 붙으면 서버의 비어있음 검사는 통과하지만
  //   수신거부 '방법'이 없어 법적으로는 미비다(2026-08-12 발송분이 이 상태로 나갔다).
  //   비워 두면 광고 발송 시 서버가 막아서, 실제 번호·방법을 적게 된다.
  const [optout, setOptout] = useState("");
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  // 필터 합집합으로 후보 회원 산출(번호 있는 회원만) — 순수 로직은 lib/broadcast-recipients.ts.
  //   adExcluded = 광고 동의가 없어 잘려나간 인원수. 0이 아니면 화면에 경고로 띄운다.
  const { candidates, adExcluded } = useMemo(
    () => selectRecipients({ profiles, slots, orders, filters, isAd }),
    [profiles, slots, orders, filters, isAd]
  );

  const selectedProfiles = useMemo(
    () => candidates.filter((p) => !excluded.has(p.id)),
    [candidates, excluded]
  );

  const manualNumbers = useMemo(
    () =>
      manual
        .split(/[\s,;]+/)
        .map(normalizePhone)
        .filter((n) => n.length >= 9 && n.length <= 11),
    [manual]
  );

  // 개별 회원 검색: 이름 또는 번호로 매칭(번호 있는 회원, 최대 8명).
  const memberMatches = useMemo(() => {
    const q = memberQuery.trim().toLowerCase();
    if (!q) return [] as ProfileLite[];
    const qDigits = q.replace(/[^0-9]/g, "");
    return profiles
      .filter((p) => p.phone)
      .filter(
        (p) =>
          (p.name ?? "").toLowerCase().includes(q) ||
          (qDigits.length >= 2 && normalizePhone(p.phone).includes(qDigits))
      )
      .slice(0, 8);
  }, [memberQuery, profiles]);

  const pickedProfiles = useMemo(
    () => profiles.filter((p) => picked.has(p.id)),
    [profiles, picked]
  );

  // 최종 수신번호(중복 제거): 필터 명단 + 개별 선택 회원 + 직접 입력.
  const finalPhones = useMemo(() => {
    const set = new Set<string>();
    for (const p of [...selectedProfiles, ...pickedProfiles]) {
      const n = normalizePhone(p.phone);
      if (n.length >= 9 && n.length <= 11) set.add(n);
    }
    for (const n of manualNumbers) set.add(n);
    return Array.from(set);
  }, [selectedProfiles, pickedProfiles, manualNumbers]);

  // 발송될 최종 본문(광고면 (광고) + 수신거부 안내 포함) 미리보기 — 글자수 판정용.
  const preview = useMemo(() => {
    const trimmed = body.trim();
    if (!isAd || !trimmed) return trimmed;
    const head = /^\(광고\)/.test(trimmed) ? "" : "(광고) ";
    return `${head}${trimmed}\n${optout.trim()}`;
  }, [body, isAd, optout]);

  const bytes = eucKrBytes(preview);
  const msgType = bytes > 90 ? "LMS" : "SMS";
  // 대략적 비용 안내(요금제에 따라 다름): SMS 약 20원, LMS 약 50원.
  const estCost = finalPhones.length * (msgType === "LMS" ? 50 : 20);

  function toggleFilter(k: FilterKey) {
    setFilters((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
    setExcluded(new Set());
  }

  function toggleExclude(id: string) {
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  // 개별 회원 선택 토글. 선택 시 프리셋 {이름} 치환용 이름도 갱신.
  function togglePick(p: ProfileLite) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(p.id)) next.delete(p.id);
      else next.add(p.id);
      return next;
    });
    setPresetName(p.name ?? "");
  }

  async function send() {
    if (sending) return;
    const text = body.trim();
    if (!text) {
      setResult("본문을 입력해 주세요.");
      return;
    }
    if (finalPhones.length === 0) {
      setResult("수신자를 한 명 이상 선택하거나 번호를 입력해 주세요.");
      return;
    }
    if (isAd && !optout.trim()) {
      setResult("광고성 문자는 무료수신거부 안내가 필요합니다.");
      return;
    }
    const ok = window.confirm(
      `${finalPhones.length}명에게 ${msgType} 문자를 발송합니다.\n` +
        (isAd ? "(광고성: (광고) 표기·수신거부 안내가 자동 포함됩니다)\n" : "") +
        (isAd && adExcluded > 0
          ? `\n⚠ 광고 수신 미동의로 ${adExcluded}명이 명단에서 제외된 상태입니다.\n` +
            `배송·휴무 공지라면 취소하고 「광고/홍보 문자」 체크를 꺼주세요.\n`
          : "") +
        "발송 후에는 취소할 수 없습니다. 계속할까요?"
    );
    if (!ok) return;

    setSending(true);
    setResult(null);
    try {
      const { data } = await getSupabase().auth.getSession();
      const token = data.session?.access_token;
      if (!token) {
        setResult("로그인 세션이 만료되었습니다. 다시 로그인해 주세요.");
        return;
      }
      const res = await fetch("/api/broadcast", {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          message: text,
          subject: subject.trim(),
          recipients: finalPhones,
          isAd,
          optout: optout.trim(),
        }),
      });
      const r = (await res.json()) as {
        ok: boolean;
        total?: number;
        failed?: number;
        reason?: string;
      };
      if (r.ok) {
        setResult(`발송 완료 · ${r.total ?? finalPhones.length}건 접수${r.failed ? ` (실패 ${r.failed})` : ""}`);
        setBody("");
        setSubject("");
      } else if (r.reason === "not_configured") {
        setResult("Solapi 환경변수가 설정되지 않았습니다. (네틀리파이 환경변수 확인)");
      } else {
        setResult(`발송 실패: ${r.reason ?? "알 수 없는 오류"}${r.failed ? ` (실패 ${r.failed}/${r.total})` : ""}`);
      }
    } catch {
      setResult("네트워크 오류로 발송하지 못했습니다.");
    } finally {
      setSending(false);
    }
  }

  const filterChips: { key: FilterKey; label: string }[] = [
    { key: "all", label: "전체 회원" },
    { key: "customer", label: "구매 고객 전체" },
    { key: "active", label: "활성 구독자" },
    { key: "once", label: "단품 구매 고객" },
    { key: "nosub", label: "미구독 회원" },
    ...DELIVERY_DAYS.map((d) => ({ key: d as FilterKey, label: `${DELIVERY_DAY_LABEL[d]} 배송` })),
  ];

  return (
    <div className="mt-12 no-print">
      <h2 className="font-serif-kr text-lg text-ink">단체문자 발송</h2>
      <p className="mt-1 text-[13px] text-mute">
        수신자를 필터로 고르고 개별 해제할 수 있습니다. 광고/홍보는 법에 따라 (광고) 표기·무료수신거부 안내가
        자동 포함되며, 야간(21~08시)에는 발송되지 않습니다.
      </p>

      {/* 1. 수신자 필터 */}
      <div className="mt-4 flex flex-wrap gap-2">
        {filterChips.map((c) => (
          <button
            key={c.key}
            onClick={() => toggleFilter(c.key)}
            className={`rounded-full border px-3.5 py-1.5 text-[13px] transition-colors ${
              filters.has(c.key)
                ? "border-gold bg-gold/15 text-gold-deep"
                : "border-line text-ink-soft hover:border-gold"
            }`}
          >
            {c.label}
          </button>
        ))}
      </div>

      {/* 2. 후보 명단(개별 체크 해제) */}
      {candidates.length > 0 && (
        <div className="mt-3 max-h-56 overflow-y-auto rounded-2xl border border-line bg-cream p-3">
          <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-3">
            {candidates.map((p) => (
              <label
                key={p.id}
                className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1 text-[13px] text-ink-soft hover:bg-gold/5"
              >
                <input
                  type="checkbox"
                  checked={!excluded.has(p.id)}
                  onChange={() => toggleExclude(p.id)}
                  className="accent-gold-deep"
                />
                <span className="truncate">
                  {p.name} <span className="tabular-nums text-mute">{p.phone}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}

      {/* 3. 직접 번호 입력 */}
      <div className="mt-3">
        <label className="text-[13px] text-mute">직접 번호 추가 (쉼표·줄바꿈으로 구분)</label>
        <textarea
          value={manual}
          onChange={(e) => setManual(e.target.value)}
          rows={2}
          placeholder="010-1234-5678, 010-2345-6789"
          className="mt-1 w-full rounded-xl border border-line bg-cream px-3 py-2 text-[14px] text-ink"
        />
      </div>

      {/* 3-1. 개별 회원 검색(이름·번호로 1:1 발송) */}
      <div className="mt-3">
        <label className="text-[13px] text-mute">개별 회원 검색 (이름·번호로 콕 집어 보내기)</label>
        <input
          type="search"
          value={memberQuery}
          onChange={(e) => setMemberQuery(e.target.value)}
          placeholder="예: 우혜원 또는 5678"
          className="mt-1 w-full rounded-xl border border-line bg-cream px-3 py-2 text-[14px] text-ink"
        />
        {memberMatches.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {memberMatches.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => togglePick(p)}
                className={`rounded-full border px-3 py-1 text-[13px] transition-colors ${
                  picked.has(p.id)
                    ? "border-gold bg-gold/15 text-gold-deep"
                    : "border-line text-ink-soft hover:border-gold"
                }`}
              >
                {p.name} <span className="tabular-nums text-mute">{p.phone}</span>
              </button>
            ))}
          </div>
        )}
        {pickedProfiles.length > 0 && (
          <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[13px]">
            <span className="text-mute">선택됨:</span>
            {pickedProfiles.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => togglePick(p)}
                title="클릭하면 제외"
                className="rounded-full bg-gold/15 px-3 py-1 text-gold-deep"
              >
                {p.name} ✕
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 4. 메시지 작성 */}
      <div className="mt-4 space-y-3">
        <label className="flex items-center gap-2 text-[14px] text-ink-soft">
          <input type="checkbox" checked={isAd} onChange={(e) => setIsAd(e.target.checked)} className="accent-gold-deep" />
          광고/홍보 문자 (할인·이벤트 등)
        </label>
        <p className="text-[12px] leading-relaxed text-mute">
          배송·휴무·입금 안내 등 <span className="text-ink-soft">공지는 광고가 아닙니다</span> — 체크를 끈 채로 보내야
          수신 미동의 고객까지 전원에게 전달됩니다.
        </p>
        {/* 광고로 보낼 때 명단에서 조용히 빠지는 인원을 발송 전에 반드시 보여준다. */}
        {isAd && adExcluded > 0 && (
          <p
            role="alert"
            className="rounded-xl border border-gold/50 bg-gold/10 px-3 py-2 text-[13px] leading-relaxed text-gold-deep"
          >
            ⚠ 필터에 걸린 {adExcluded + candidates.length}명 중{" "}
            <strong className="font-medium">{adExcluded}명이 광고 수신 미동의로 제외</strong>되어{" "}
            {candidates.length}명에게만 발송됩니다. 공지 성격이라면 위 「광고/홍보 문자」 체크를 꺼주세요.
          </p>
        )}
        {isAd && (
          <>
            <input
              type="text"
              value={optout}
              onChange={(e) => setOptout(e.target.value)}
              placeholder="무료수신거부 080-XXX-XXXX (또는 수신거부 방법)"
              className="w-full rounded-xl border border-line bg-cream px-3 py-2 text-[14px] text-ink"
            />
            <p className="text-[12px] leading-relaxed text-mute">
              광고 문자는 <span className="text-ink-soft">광고 수신에 동의한 회원</span>에게만 발송됩니다(동의 안 한 회원은 명단에서 자동 제외). 직접 입력한 번호는 동의 여부를 확인할 수 없으니, 동의받은 번호만 입력하세요.
            </p>
          </>
        )}
        <input
          type="text"
          value={subject}
          onChange={(e) => setSubject(e.target.value)}
          placeholder="제목 (LMS일 때만 사용, 선택)"
          className="w-full rounded-xl border border-line bg-cream px-3 py-2 text-[14px] text-ink"
        />
        <div className="flex flex-wrap gap-1.5">
          {SMS_PRESETS.map((p) => (
            <button
              key={p.key}
              type="button"
              onClick={() => setBody(fillPreset(p.key, presetName))}
              className="rounded-full border border-line px-3 py-1 text-[13px] text-ink-soft transition-colors hover:border-gold hover:text-gold-deep"
            >
              {p.label}
            </button>
          ))}
        </div>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={5}
          placeholder="문자 내용을 입력하세요. (위 프리셋을 누르면 자동으로 채워집니다)"
          className="w-full rounded-xl border border-line bg-cream px-3 py-2 text-[14px] text-ink"
        />
      </div>

      {/* 5. 요약 + 발송 */}
      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-mute">
        <span>
          수신자 <span className="tabular-nums text-ink">{finalPhones.length}</span>명
        </span>
        <span>
          {bytes}바이트 ·{" "}
          <span className={msgType === "LMS" ? "text-gold-deep" : "text-ink-soft"}>{msgType}</span>
        </span>
        <span>
          예상 약 <span className="tabular-nums text-ink-soft">{estCost.toLocaleString("ko-KR")}원</span>
        </span>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <button
          onClick={send}
          disabled={sending || finalPhones.length === 0 || !body.trim()}
          className="rounded-full bg-ink px-5 py-2.5 text-[14px] text-cream transition-colors hover:bg-gold-deep disabled:opacity-30"
        >
          {sending ? "발송 중…" : `${finalPhones.length}명에게 발송`}
        </button>
        {result && <span className="text-[13px] text-ink-soft">{result}</span>}
      </div>
    </div>
  );
}

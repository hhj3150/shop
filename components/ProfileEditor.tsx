"use client";

import { useId, useState, type FormEvent } from "react";
import { Field } from "@/components/Field";
import { AddressSearch } from "@/components/AddressSearch";
import { formatPhoneKR } from "@/lib/signup-format";

// 회원 기준 정보(이름·연락처·주소) 수정 폼. 회원 본인(마이페이지)과
//   관리자(회원 모달) 양쪽에서 같은 UI로 쓴다. 저장 로직은 onSave 로 위임한다 —
//   회원은 본인 프로필을, 관리자는 대상 회원 프로필을 갱신한다(RLS가 권한을 가른다).
export type ProfileEditValues = {
  name: string;
  phone: string;
  postcode: string;
  address: string;
  address_detail: string;
};

export function ProfileEditor({
  initial,
  onSave,
  onCancel,
  saveLabel = "저장",
}: {
  initial: ProfileEditValues;
  // 정제된 값을 받아 저장한다. 실패 시 throw 하면 폼이 오류를 표시한다.
  onSave: (values: ProfileEditValues) => Promise<void>;
  onCancel?: () => void;
  saveLabel?: string;
}) {
  const [name, setName] = useState(initial.name ?? "");
  const [phone, setPhone] = useState(formatPhoneKR(initial.phone ?? ""));
  const [postcode, setPostcode] = useState(initial.postcode ?? "");
  const [address, setAddress] = useState(initial.address ?? "");
  const [addressDetail, setAddressDetail] = useState(initial.address_detail ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 같은 화면에 폼이 둘 이상 떠도(예: 관리자 회원 모달 + 주문 배송지) id가 겹치지 않게 한다.
  const uid = useId();

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    const trimmedName = name.trim();
    const digits = phone.replace(/[^0-9]/g, "");
    if (!trimmedName) {
      setError("이름을 입력해 주세요.");
      return;
    }
    if (digits.length < 10) {
      setError("연락처를 정확히 입력해 주세요.");
      return;
    }
    setBusy(true);
    try {
      await onSave({
        name: trimmedName,
        phone: digits,
        postcode: postcode.trim(),
        address: address.trim(),
        address_detail: addressDetail.trim(),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : "저장에 실패했습니다.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="space-y-4">
      <Field
        id={`${uid}-name`}
        label="이름"
        autoComplete="name"
        value={name}
        onChange={(e) => setName(e.target.value)}
      />
      <Field
        id={`${uid}-phone`}
        label="연락처"
        hint="입금 확인·발송 안내 문자를 받는 번호입니다."
        inputMode="numeric"
        autoComplete="tel"
        placeholder="010-1234-5678"
        value={phone}
        onChange={(e) => setPhone(formatPhoneKR(e.target.value))}
      />
      <div className="flex items-end gap-3">
        <div className="flex-1">
          <Field
            id={`${uid}-postcode`}
            label="우편번호"
            inputMode="numeric"
            value={postcode}
            onChange={(e) => setPostcode(e.target.value)}
          />
        </div>
        <div className="pb-1">
          <AddressSearch
            onSelect={(pc, addr) => {
              setPostcode(pc);
              setAddress(addr);
            }}
          />
        </div>
      </div>
      <Field
        id={`${uid}-address`}
        label="주소"
        autoComplete="street-address"
        value={address}
        onChange={(e) => setAddress(e.target.value)}
      />
      <Field
        id={`${uid}-address-detail`}
        label="상세 주소"
        value={addressDetail}
        onChange={(e) => setAddressDetail(e.target.value)}
      />

      {error && (
        <p className="rounded-xl border border-red-300 bg-red-50 px-4 py-3 text-[14px] text-red-700">
          {error}
        </p>
      )}

      <div className="flex gap-2">
        <button
          type="submit"
          disabled={busy}
          className="flex-1 rounded-full bg-ink py-3 text-[14px] font-medium text-cream transition-colors hover:bg-gold-deep disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy ? "저장 중…" : saveLabel}
        </button>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-full border border-line px-5 py-3 text-[14px] text-ink-soft transition-colors hover:border-gold hover:text-gold disabled:opacity-50"
          >
            취소
          </button>
        )}
      </div>
    </form>
  );
}

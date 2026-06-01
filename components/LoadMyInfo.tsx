"use client";

import type { Profile } from "@/lib/auth";

// 회원이 주문(단품/정기구독) 시 회원가입 정보를 한 번에 불러오는 단추.
//   재구매가 잦은 회원의 편의를 위해 이름·연락처·주소·입금자명을 즉시 채운다.
//   - 본인 배송일 때만 노출(선물하기는 받는 분 정보라 비노출).
//   - 클릭 시 기존 입력값을 회원정보로 덮어쓴다(명시적 액션).

export type MyInfoFields = {
  name: string;
  phone: string;
  postcode: string;
  address: string;
  addressDetail: string;
  depositorName: string;
};

// 프로필 → 배송지 필드 매핑. null 컬럼은 빈 문자열로 정규화한다.
export function profileToFields(profile: Profile): MyInfoFields {
  return {
    name: profile.name,
    phone: profile.phone,
    postcode: profile.postcode ?? "",
    address: profile.address ?? "",
    addressDetail: profile.address_detail ?? "",
    depositorName: profile.name,
  };
}

export function LoadMyInfoButton({
  profile,
  onLoad,
  disabled,
}: {
  profile: Profile | null;
  onLoad: (fields: MyInfoFields) => void;
  disabled?: boolean;
}) {
  if (!profile) return null;
  return (
    <div className="flex items-center justify-between rounded-2xl border border-gold/30 bg-gold/5 px-4 py-3">
      <p className="text-[13px] leading-snug text-ink-soft">
        회원이세요? 가입하신 정보로 배송지를 채워 드려요.
      </p>
      <button
        type="button"
        onClick={() => onLoad(profileToFields(profile))}
        disabled={disabled}
        className="ml-3 shrink-0 rounded-full border border-gold/50 bg-cream px-4 py-2 text-[13px] font-medium text-gold-deep transition-colors hover:border-gold hover:bg-gold/10 disabled:opacity-50"
      >
        회원정보 불러오기
      </button>
    </div>
  );
}

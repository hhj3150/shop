// 회원 프로필 자동 보완(backfill).
//   회원이 본인 주소로 주문하면, 프로필에서 '비어 있던' 배송 칸(연락처·주소)을
//   주문서에 입력한 값으로 채워 둔다. 다음 주문부터 자동으로 따라오게 하기 위함.
//   ★ 기존 값은 절대 덮어쓰지 않는다(회원의 기준 정보 보존). 선물 주문에는 적용하지 않는다.
import { getSupabase } from "@/lib/supabase";
import type { Profile } from "@/lib/auth";

export type ShippingFields = {
  phone: string;
  postcode: string;
  address: string;
  addressDetail: string;
};

type ProfileShipping = Pick<
  Profile,
  "phone" | "postcode" | "address" | "address_detail"
>;

// 비어 있는 프로필 칸만 골라 채울 패치를 만든다(순수 함수 — 테스트 대상).
export function profileBackfillPatch(
  profile: ProfileShipping,
  ship: ShippingFields
): Record<string, string> {
  const patch: Record<string, string> = {};
  const phone = ship.phone.replace(/[^0-9]/g, "");
  if (!profile.phone && phone) patch.phone = phone;
  if (!profile.postcode && ship.postcode.trim()) patch.postcode = ship.postcode.trim();
  if (!profile.address && ship.address.trim()) patch.address = ship.address.trim();
  if (!profile.address_detail && ship.addressDetail.trim()) {
    patch.address_detail = ship.addressDetail.trim();
  }
  return patch;
}

// 프로필의 빈 배송 칸을 주문서 값으로 보완한다. 실패는 흡수(보조 기능 — 주문엔 영향 없음).
export async function backfillProfileShipping(
  profile: Profile,
  ship: ShippingFields
): Promise<void> {
  const patch = profileBackfillPatch(profile, ship);
  if (Object.keys(patch).length === 0) return;
  const { error } = await getSupabase().from("profiles").update(patch).eq("id", profile.id);
  if (error) console.error("프로필 자동 보완 실패:", error.message);
}

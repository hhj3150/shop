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

// 배송정보 동기화용 — 고객(회원) 기준 정보를 orders.ship_* 스냅샷 패치로 변환(순수 함수, 테스트 대상).
//   '고객정보'를 바꾸면 그 회원의 진행 중인 주문 '배송정보'도 같은 값으로 맞춘다 —
//   이름·연락처·주소를 모두 동기화해 두 화면이 어긋나지 않게 한다(이사·오기재 정정).
//   주소가 비면 null 을 반환해 '동기화 안 함'을 알린다 — 빈 주소로 기존 배송지를 덮어써
//   배송지를 지우는 사고를 막는다. 선물 주문(받는 분 주소가 따로)은 호출 측에서 제외한다.
export type ProfileShipFields = {
  name: string;
  phone: string;
  postcode: string;
  address: string;
  addressDetail: string;
};

export function profileShipPatch(fields: ProfileShipFields): {
  ship_name: string;
  ship_phone: string;
  ship_postcode: string | null;
  ship_address: string;
  ship_address_detail: string | null;
} | null {
  const address = fields.address.trim();
  if (!address) return null;
  return {
    ship_name: fields.name.trim(),
    ship_phone: fields.phone.replace(/[^0-9]/g, ""),
    ship_postcode: fields.postcode.trim() || null,
    ship_address: address,
    ship_address_detail: fields.addressDetail.trim() || null,
  };
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

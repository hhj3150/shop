// 받는 사람 주소록 — 회원이 자녀·손주 등 선물 받을 분의 주소를 저장해 두고,
//   정기구독·단품 주문 시 선택해 선물 발송한다. RLS로 회원 본인 것만 접근.
import { getSupabase } from "@/lib/supabase";

// 받는 사람 1명 (recipients 1행).
export type Recipient = {
  id: string;
  name: string;
  phone: string;
  postcode: string | null;
  address: string;
  addressDetail: string | null;
  memo: string | null;
};

// 새 받는 사람 입력값(저장 전).
export type RecipientInput = {
  name: string;
  phone: string;
  postcode?: string;
  address: string;
  addressDetail?: string;
  memo?: string;
};

type RecipientRow = {
  id: string;
  name: string;
  phone: string;
  postcode: string | null;
  address: string;
  address_detail: string | null;
  memo: string | null;
};

function toRecipient(row: RecipientRow): Recipient {
  return {
    id: row.id,
    name: row.name,
    phone: row.phone,
    postcode: row.postcode,
    address: row.address,
    addressDetail: row.address_detail,
    memo: row.memo,
  };
}

const COLUMNS = "id, name, phone, postcode, address, address_detail, memo";

// 입력값을 검증하고 DB 행 형태로 변환. 이름·전화·주소는 필수.
function toRow(input: RecipientInput) {
  const name = input.name.trim();
  const phone = input.phone.replace(/[^0-9]/g, "");
  const address = input.address.trim();
  if (!name) throw new Error("받는 분 이름을 입력해 주세요.");
  if (phone.length < 10) throw new Error("받는 분 휴대폰 번호를 정확히 입력해 주세요.");
  if (!address) throw new Error("받는 분 주소를 입력해 주세요.");
  return {
    name,
    phone,
    postcode: input.postcode?.trim() || null,
    address,
    address_detail: input.addressDetail?.trim() || null,
    memo: input.memo?.trim() || null,
  };
}

// 본인 주소록을 최근 등록순으로 조회.
export async function loadRecipients(userId: string): Promise<Recipient[]> {
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("recipients")
      .select(COLUMNS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error) throw error;
    return ((data as RecipientRow[]) ?? []).map(toRecipient);
  } catch (error) {
    console.error("주소록 조회 실패:", error);
    throw new Error("받는 사람 주소록을 불러오지 못했습니다.");
  }
}

// 받는 사람 등록.
export async function addRecipient(
  userId: string,
  input: RecipientInput
): Promise<Recipient> {
  const row = toRow(input);
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("recipients")
      .insert({ user_id: userId, ...row })
      .select(COLUMNS)
      .single();
    if (error) throw error;
    return toRecipient(data as RecipientRow);
  } catch (error) {
    console.error("주소록 등록 실패:", error);
    throw new Error(
      error instanceof Error && error.message.startsWith("받는 분")
        ? error.message
        : "받는 사람 등록에 실패했습니다."
    );
  }
}

// 받는 사람 수정. RLS로 본인 행만 갱신된다.
export async function updateRecipient(
  id: string,
  input: RecipientInput
): Promise<Recipient> {
  const row = toRow(input);
  try {
    const sb = getSupabase();
    const { data, error } = await sb
      .from("recipients")
      .update(row)
      .eq("id", id)
      .select(COLUMNS)
      .single();
    if (error) throw error;
    return toRecipient(data as RecipientRow);
  } catch (error) {
    console.error("주소록 수정 실패:", error);
    throw new Error(
      error instanceof Error && error.message.startsWith("받는 분")
        ? error.message
        : "받는 사람 정보를 수정하지 못했습니다."
    );
  }
}

// 받는 사람 삭제.
export async function deleteRecipient(id: string): Promise<void> {
  try {
    const sb = getSupabase();
    const { error } = await sb.from("recipients").delete().eq("id", id);
    if (error) throw error;
  } catch (error) {
    console.error("주소록 삭제 실패:", error);
    throw new Error("받는 사람을 삭제하지 못했습니다.");
  }
}

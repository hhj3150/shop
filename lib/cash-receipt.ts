// 현금영수증 — 무통장입금 결제의 수기 발행 정보.
// 주문 시 고객이 발행 방식과 식별번호를 선택하고, 관리자가 홈택스에서 직접 발행한다.

export type CashReceiptType = "소득공제" | "지출증빙" | "발행안함";

export const CASH_RECEIPT_TYPES: CashReceiptType[] = ["소득공제", "지출증빙", "발행안함"];

export const DEFAULT_CASH_RECEIPT: CashReceiptType = "소득공제";

type CashReceiptOption = {
  value: CashReceiptType;
  label: string;
  hint: string; // 선택 시 안내
  idLabel: string; // 식별번호 입력칸 라벨 (발행안함은 빈 문자열)
  placeholder: string;
};

export const CASH_RECEIPT_OPTIONS: CashReceiptOption[] = [
  {
    value: "소득공제",
    label: "소득공제용",
    hint: "개인 연말정산용으로 휴대폰 번호로 발행합니다.",
    idLabel: "휴대폰 번호",
    placeholder: "01012345678",
  },
  {
    value: "지출증빙",
    label: "지출증빙용",
    hint: "사업자 경비처리용으로 사업자등록번호로 발행합니다.",
    idLabel: "사업자등록번호",
    placeholder: "1234567890",
  },
  {
    value: "발행안함",
    label: "발행 안 함",
    hint: "현금영수증을 발행하지 않습니다.",
    idLabel: "",
    placeholder: "",
  },
];

export function cashReceiptOption(type: CashReceiptType): CashReceiptOption {
  return CASH_RECEIPT_OPTIONS.find((o) => o.value === type) ?? CASH_RECEIPT_OPTIONS[0];
}

// 숫자만 남긴다(하이픈·공백 제거).
export function digitsOnly(value: string): string {
  return value.replace(/[^0-9]/g, "");
}

// 발행 방식별 식별번호 검증. 통과하면 null, 실패하면 안내 문구를 돌려준다.
export function validateCashReceipt(type: CashReceiptType, id: string): string | null {
  if (type === "발행안함") return null;
  const d = digitsOnly(id);
  if (type === "소득공제") {
    if (d.length < 10 || d.length > 11) {
      return "소득공제용 휴대폰 번호를 정확히 입력해 주세요.";
    }
  } else if (type === "지출증빙") {
    if (d.length !== 10) {
      return "지출증빙용 사업자등록번호 10자리를 정확히 입력해 주세요.";
    }
  }
  return null;
}

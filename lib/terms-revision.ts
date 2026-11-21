// 이용약관 개정 — 공지일과 시행일(약관 제3조: 적용일자 7일 전부터 공지).
//   시행일이 되면 /terms 가 개정문으로 저절로 바뀐다(페이지는 1시간마다 다시 만들어진다).
//   ★ 다음 개정 때: 아래 값을 새로 쓰고, app/terms/page.tsx 의 조항 문구를 함께 바꾼다.
//     이용자에게 불리한 개정이면 30일 전 공지가 필요하다(전자상거래 표준약관).
export const TERMS_REVISION = {
  /** 개정 전 시행일(현행) — 2026-11-19 개정(비회원 단품 구매)이 현행이다. */
  previousEffective: "2026-11-19",
  /** 개정 공지일. */
  announced: "2026-11-21",
  /** 개정 시행일 — 공지일 + 7일(이용자에게 불리하지 않은 개정: 결제수단 추가). */
  effective: "2026-11-28",
  reason:
    "무통장입금 외에 신용·체크카드 및 간편결제로도 결제할 수 있도록 결제수단과 환불 방법을 정비하고, 호스팅서비스 제공자를 표시합니다.",
} as const;

/** 오늘(KST, YYYY-MM-DD)에 개정 약관이 시행 중인가. */
export function revisedTermsInEffect(todayYmd: string): boolean {
  return todayYmd >= TERMS_REVISION.effective;
}

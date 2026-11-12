// 이용약관 개정 — 공지일과 시행일(약관 제3조: 적용일자 7일 전부터 공지).
//   시행일이 되면 /terms 가 개정문으로 저절로 바뀐다(페이지는 1시간마다 다시 만들어진다).
//   ★ 다음 개정 때: 아래 값을 새로 쓰고, app/terms/page.tsx 의 조항 문구를 함께 바꾼다.
//     이용자에게 불리한 개정이면 30일 전 공지가 필요하다(전자상거래 표준약관).
export const TERMS_REVISION = {
  /** 개정 전 시행일(현행). */
  previousEffective: "2026-06-06",
  /** 개정 공지일. */
  announced: "2026-11-12",
  /** 개정 시행일 — 공지일 + 7일. */
  effective: "2026-11-19",
  reason:
    "정기구독과 별도로 운영 중인 단품(1회) 구매를 회원가입 없이도 할 수 있도록, 실제 판매 방식에 맞추어 '이용자'의 정의와 판매 대상을 고칩니다.",
} as const;

/** 오늘(KST, YYYY-MM-DD)에 개정 약관이 시행 중인가. */
export function revisedTermsInEffect(todayYmd: string): boolean {
  return todayYmd >= TERMS_REVISION.effective;
}

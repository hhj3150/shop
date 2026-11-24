// 관리자 '구독 시작일 변경'을 지금 열어 줘도 되는지 — 안 되면 그 이유(화면에 그대로 쓴다).
//
//   ★ 왜 막는가 (2026-11-19 윤화영 거래처)
//     시작일(started_at)은 원주문과 연장주문이 함께 쓰는 '구독 슬롯 하나'의 앵커다. 연장 주문 행을
//     펼쳐 연장분이 언제 시작할지 정하려고 이 버튼을 눌렀더니, 앵커가 11/30 이후로 밀리면서
//     지금 기간(12회 중 12번째)이 통째로 뒤로 밀려 11/23 명단에서 빠졌고 회차는 1/36 부터 다시 셌다.
//
//   규칙(서버 admin_set_slot_start 와 같다 — 여기는 버튼을 미리 감추는 용도, 최종 판정은 서버)
//   · 연장 주문 행에서는 열지 않는다. 연장분은 날짜가 아니라 '앞 기간이 끝난 다음 회차'부터 이어진다.
//   · 한 번이라도 나갔거나(출고 기록) 회차를 확정한 구독은 바꿀 수 없다 — 지난 회차까지 다시 세어진다.
//   · 방문수령은 출고 기록이 남지 않으므로, 시작일이 오늘 이전이면 이미 시작된 것으로 본다.
export type StartLockInput = {
  isRenewalRow: boolean;
  shippedCount: number; // 슬롯 체인(원주문+연장)의 출고 기록 날짜 수
  confirmedCount: number | null; // 관리자가 확정한 회차(없으면 null)
  deliveryMethod: string | null; // 원주문의 '택배' | '방문수령'
  startedAt: string | null; // YYYY-MM-DD
  todayISO: string;
};

export function startChangeLock(input: StartLockInput): string | null {
  if (input.isRenewalRow) {
    return "연장분은 시작일을 따로 정하지 않습니다. 지금 기간이 끝나면 다음 회차부터 저절로 이어집니다.";
  }
  const sent = Math.max(input.shippedCount, input.confirmedCount ?? 0);
  if (sent > 0 || input.confirmedCount != null) {
    return `이미 ${sent}회 나간 구독이라 시작일은 바꿀 수 없습니다. 쉬어 가기는 일시정지, 요일은 요일 변경, 회차가 틀리면 회차 확정을 쓰세요.`;
  }
  if (
    input.deliveryMethod === "방문수령" &&
    input.startedAt != null &&
    input.startedAt.slice(0, 10) <= input.todayISO
  ) {
    return "이미 시작된 방문수령 구독이라 시작일은 바꿀 수 없습니다. 쉬어 가기는 일시정지, 요일은 요일 변경을 쓰세요.";
  }
  return null;
}

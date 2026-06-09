// Customer360 단건 문자 발송 payload 빌더(순수 함수).
//   법적 불변식: 단건 회원 발송은 항상 정보성(거래·CS) → isAd:false.
//   광고성(야간차단·(광고)·동의필터)은 단체문자 패널의 (광고) 경로만 사용한다.
//   이 함수가 isAd 를 강제해, 단건 발송이 실수로 광고 규제를 우회하지 못하게 한다.

export type MemberSmsPayload = {
  message: string;
  recipients: [string];
  isAd: false;
};

export function buildMemberSmsPayload(phone: string, message: string): MemberSmsPayload {
  return {
    message: message.trim(),
    recipients: [phone],
    isAd: false,
  };
}

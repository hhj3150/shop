// 가입 폼의 필드별 검증(순수 함수). 빈 객체면 유효, 그렇지 않으면 field→메시지.
// UI는 이 결과로 각 입력 아래에 인라인 오류를 표시한다.

export type SignupInput = {
  name: string;
  phone: string;
  email: string;
  password: string;
  postcode: string;
  address: string;
};

// 과도하게 엄격한 정규식은 정상 사용자를 막아 전환을 떨어뜨린다. 최소 형태만 확인.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MIN_PHONE_DIGITS = 10;
const MIN_PASSWORD = 6;

export function validateSignup(
  input: SignupInput,
  agree: boolean
): Record<string, string> {
  const errors: Record<string, string> = {};

  if (!input.name.trim()) {
    errors.name = "이름을 입력해 주세요.";
  }
  if (input.phone.replace(/\D/g, "").length < MIN_PHONE_DIGITS) {
    errors.phone = "발송 안내를 받을 휴대폰 번호를 정확히 입력해 주세요.";
  }
  if (!EMAIL_RE.test(input.email.trim())) {
    errors.email = "올바른 이메일 주소를 입력해 주세요.";
  }
  if (input.password.length < MIN_PASSWORD) {
    errors.password = `비밀번호는 ${MIN_PASSWORD}자 이상이어야 합니다.`;
  }
  if (!input.postcode.trim()) {
    errors.postcode = "우편번호가 필요합니다.";
  }
  if (!input.address.trim()) {
    errors.address = "‘주소 검색’으로 주소를 채워 주세요.";
  }
  if (!agree) {
    errors.agree = "이용약관과 개인정보처리방침에 동의해 주세요.";
  }

  return errors;
}

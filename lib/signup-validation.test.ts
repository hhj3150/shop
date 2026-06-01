import { describe, it, expect } from "vitest";
import { validateSignup, type SignupInput } from "./signup-validation";

const valid: SignupInput = {
  name: "송영신",
  phone: "010-1234-5678",
  email: "milk@example.com",
  password: "secret1",
  postcode: "17564",
  address: "경기도 안성시 미양면 미양로 466",
};

describe("validateSignup", () => {
  it("유효한 입력 + 동의면 오류가 없다", () => {
    expect(validateSignup(valid, true)).toEqual({});
  });

  it("미동의면 agree 오류", () => {
    expect(validateSignup(valid, false)).toHaveProperty("agree");
  });

  it("하이픈 포함 11자리 전화는 유효(하이픈 제거 후 길이 판정)", () => {
    expect(validateSignup(valid, true).phone).toBeUndefined();
  });

  it("자릿수 부족 전화는 phone 오류", () => {
    expect(validateSignup({ ...valid, phone: "010-1234" }, true)).toHaveProperty(
      "phone"
    );
  });

  it("형식이 틀린 이메일은 email 오류", () => {
    expect(validateSignup({ ...valid, email: "nope" }, true)).toHaveProperty(
      "email"
    );
  });

  it("6자 미만 비밀번호는 password 오류", () => {
    expect(validateSignup({ ...valid, password: "12345" }, true)).toHaveProperty(
      "password"
    );
  });

  it("이름·우편번호·주소가 비면 각 필드 오류", () => {
    const errs = validateSignup(
      { ...valid, name: "  ", postcode: "", address: "" },
      true
    );
    expect(errs).toHaveProperty("name");
    expect(errs).toHaveProperty("postcode");
    expect(errs).toHaveProperty("address");
  });
});

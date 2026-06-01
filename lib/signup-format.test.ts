import { describe, it, expect } from "vitest";
import { formatPhoneKR } from "./signup-format";

describe("formatPhoneKR", () => {
  it("11자리 휴대폰을 3-4-4로 하이픈 처리한다", () => {
    expect(formatPhoneKR("01012345678")).toBe("010-1234-5678");
  });

  it("입력 중(부분)에도 점진적으로 하이픈을 넣는다", () => {
    expect(formatPhoneKR("010")).toBe("010");
    expect(formatPhoneKR("0101234")).toBe("010-1234");
    expect(formatPhoneKR("010123456")).toBe("010-1234-56");
  });

  it("숫자가 아닌 문자는 제거한다", () => {
    expect(formatPhoneKR("010 1234 5678")).toBe("010-1234-5678");
  });

  it("이미 하이픈이 있어도 동일 결과(멱등)", () => {
    expect(formatPhoneKR("010-1234-5678")).toBe("010-1234-5678");
  });

  it("11자리를 넘으면 잘라낸다", () => {
    expect(formatPhoneKR("010123456789999")).toBe("010-1234-5678");
  });
});

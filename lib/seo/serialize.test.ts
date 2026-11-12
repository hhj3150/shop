import { describe, it, expect } from "vitest";
import { serializeJsonLd } from "./serialize";

describe("serializeJsonLd — <script> 탈출 방지", () => {
  it("값 안의 </script> 가 태그를 닫지 못한다", () => {
    const out = serializeJsonLd({ name: "</script><script>alert(1)</script>" });
    expect(out).not.toContain("</script>");
    expect(out).not.toContain("<");
  });

  it("이스케이프해도 JSON 의미는 같다", () => {
    const data = { a: "<b>&\u2028\u2029", n: 1, arr: ["x<y"] };
    expect(JSON.parse(serializeJsonLd(data))).toEqual(data);
  });
});

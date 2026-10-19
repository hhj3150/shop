// 확정 화면의 '다시 넣을 수 있다'는 성질을 지킨다.
//
//   한 번 확정하면 입력칸이 사라지던 때가 있었다. 목장은 수기 장부로 정확히 세고 있어서
//   그 숫자를 언제든 다시 넣어야 하는데, 닫혀 있으면 오타 하나도 못 고치고 몇 주 뒤
//   장부와 어긋나도 손쓸 방법이 없다. 조용히 되돌아가기 쉬운 성질이라 못박는다.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const src = readFileSync(
  fileURLToPath(new URL("../components/RoundConfirmPanel.tsx", import.meta.url)),
  "utf8"
);

describe("RoundConfirmPanel", () => {
  it("확정된 구독도 다시 넣을 수 있다", () => {
    // 이 라벨은 '확정 뒤에도 입력칸이 살아 있는' 경로에만 존재한다.
    expect(src).toMatch(/다시 확정/);
  });

  // 입력칸을 confirmed 분기 안에 가두면 예전 상태로 돌아간 것이다.
  it("입력칸을 확정 여부로 감추지 않는다", () => {
    expect(
      /confirmedAt != null \?[\s\S]{0,400}\) : \([\s\S]{0,200}<input/.test(src),
      "확정되면 입력칸이 사라지는 분기가 돌아왔다"
    ).toBe(false);
  });

  // 확정 뒤에는 '지금 값'이 기본값이어야 장부와 같은 숫자를 그대로 두고 넘어갈 수 있다.
  it("확정된 줄의 기본값은 지금 값이다", () => {
    expect(src).toMatch(/confirmed\s*\?\s*\(r\.shippedNow \?\? r\.confirmedCount \?\? 0\)/);
  });

  // 확정 이후 쌓인 출고분을 보여줘야 사장님이 '내 장부와 몇 차이인지'를 안다.
  it("확정 이후 출고분을 따로 보여준다", () => {
    expect(src).toMatch(/이후 \$\{sinceConfirm\}회/);
  });
});

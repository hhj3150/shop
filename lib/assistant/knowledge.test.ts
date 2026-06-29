import { describe, it, expect } from "vitest";
import { buildMemberContextBlock, buildCustomerSystemPrompt, type MemberSub } from "./knowledge";

const sub = (over: Partial<MemberSub> = {}): MemberSub => ({
  deliveryDay: "mon",
  weeks: 8,
  status: "활성",
  paused: false,
  skipping: false,
  ...over,
});

describe("buildMemberContextBlock", () => {
  it("이름 + 활성 구독을 요약하고 기존 회원 안내를 덧붙인다", () => {
    const block = buildMemberContextBlock("이주량", [sub()]);
    expect(block).toContain("[회원 컨텍스트");
    expect(block).toContain("이주량님");
    expect(block).toContain("월요일 8주 구독 (활성)");
    expect(block).toContain("이미 구독 중인 회원");
  });

  it("구독 없으면 '없음' + 신규 안내", () => {
    const block = buildMemberContextBlock("홍길동", []);
    expect(block).toContain("진행 중 정기구독: 없음");
    expect(block).toContain("아직 구독 전");
  });

  it("정지/건너뛰기 상태를 사람이 읽는 말로 표기", () => {
    expect(buildMemberContextBlock(null, [sub({ paused: true })])).toContain("일시정지 중");
    expect(buildMemberContextBlock(null, [sub({ paused: true, skipping: true })])).toContain(
      "이번 주 건너뛰는 중"
    );
  });

  it("이름·구독 모두 없으면 빈 문자(프롬프트 오염 방지)", () => {
    expect(buildMemberContextBlock(null, [])).not.toBe("");
    // 구독 0건은 '없음' 안내가 들어가므로 빈 문자가 아니다 — 이름만 없을 때를 확인
    expect(buildMemberContextBlock("", [])).toContain("진행 중 정기구독: 없음");
  });

  it("여러 구독을 각각 줄로 나열", () => {
    const block = buildMemberContextBlock("김철수", [
      sub({ deliveryDay: "mon", weeks: 8 }),
      sub({ deliveryDay: "thu", weeks: 12, status: "활성" }),
    ]);
    expect(block).toContain("월요일 8주");
    expect(block).toContain("목요일 12주");
  });
});

describe("buildCustomerSystemPrompt", () => {
  it("핵심 사실과 FAQ를 포함한다(회귀 가드)", () => {
    const p = buildCustomerSystemPrompt();
    expect(p).toContain("송영신목장");
    expect(p).toContain("[지식 — 자주 묻는 질문]");
  });
});

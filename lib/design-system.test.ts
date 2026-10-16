// 디자인 시스템의 '되돌아가면 안 되는 선'.
//
//   이 파일은 스타일 취향을 검사하지 않는다. 한 번 고친 뒤 조용히 되돌아가면
//   아무도 못 알아채는데 화면은 확실히 싸 보이게 되는 것들만 지킨다.
//   (취향은 사람이 고치고, 이 테스트는 사람이 못 보는 퇴행만 막는다)
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("..", import.meta.url));
const css = readFileSync(join(root, "app/globals.css"), "utf8");

/** 선택자 하나의 선언 블록만 떼어 온다. 다른 규칙의 값에 속지 않기 위해서다. */
function block(selector: string): string {
  const i = css.indexOf(selector + " {");
  expect(i, `${selector} 규칙이 없다`).toBeGreaterThan(-1);
  return css.slice(i, css.indexOf("}", i));
}

describe("숫자 — 브랜드 이름이 걸린 문제", () => {
  // Cormorant 의 기본 숫자는 올드스타일이라 2·5·7 이 x-height 로 내려앉는다.
  //   그대로 두면 제품명 'A2' 가 'A₂' 로, '750mL' 가 '₇₅₀mL' 로 읽힌다.
  //   A2 가 제품의 정체인 브랜드에서 이건 오타와 같은 급의 사고다.
  it("디스플레이 서체는 숫자를 대문자 높이로 세운다", () => {
    const b = block(".font-display");
    expect(b).toMatch(/font-variant-numeric:[^;]*lining-nums/);
    expect(b).toMatch(/font-feature-settings:[^;]*"lnum"\s*1/);
  });

  it("금액·수량 계층은 세로획이 가지런하고 숫자가 대문자 높이다", () => {
    const b = block(".t-num");
    expect(b).toMatch(/font-variant-numeric:[^;]*tabular-nums/);
    expect(b).toMatch(/font-variant-numeric:[^;]*lining-nums/);
  });
});

describe("자간 — 한글이 섞여도 무너지지 않게", () => {
  // 0.42em 은 라틴을 대문자처럼 벌릴 때의 값이다. 한글에 그대로 걸면
  //   '창 립 5 0 0 인 특 권' 으로 흩어져 단어가 아니라 낱글자로 읽힌다.
  it("eyebrow 자간은 한글이 버티는 선을 넘지 않는다", () => {
    const m = block(".eyebrow").match(/letter-spacing:\s*([0-9.]+)em/);
    expect(m, "eyebrow 에 letter-spacing 이 없다").not.toBeNull();
    expect(Number(m![1])).toBeLessThanOrEqual(0.28);
  });

  // 자간은 마지막 글자 뒤에도 붙는다 — 걷어내지 않으면 가운데정렬이 왼쪽으로 밀린다.
  it("벌린 자간의 꼬리를 걷어낸다", () => {
    expect(block(".eyebrow")).toMatch(/margin-right:\s*-/);
  });
});

describe("제품컷이 종이에서 뜨지 않게", () => {
  // 촬영 배경(247~251,240~242,231~235)은 종이색(250,246,238)보다 노랗다.
  //   타일 바탕을 종이색으로 두면 둥근 카드 안에 사진의 사각형이 비친다.
  it("스튜디오 배경 토큰이 있다", () => {
    expect(css).toMatch(/--color-studio:\s*#f9f1e9/i);
  });

  it("제품 사진 타일은 종이색이 아니라 스튜디오 배경을 쓴다", () => {
    const files = [
      "app/products/[id]/page.tsx",
      "components/ProductGallery.tsx",
      "components/ProductShowcase.tsx",
    ];
    for (const f of files) {
      const src = readFileSync(join(root, f), "utf8");
      // 사진을 담는 상자(overflow-hidden + 고정 비율/높이)에 bg-paper 가 남아 있으면 안 된다.
      const offenders = src
        .split("\n")
        .filter((l) => /overflow-hidden/.test(l) && /bg-paper\b/.test(l));
      expect(offenders, `${f}: 사진 타일에 bg-paper 가 남아 있다`).toEqual([]);
    }
  });

  // 히어로 제품컷은 흰 배경(실측 253~255)이라 곱셈으로 녹인다. 다만 254 는 255 가
  //   아니어서, 밝기를 먼저 올리지 않으면 종이보다 0.4% 어두운 직사각형이 남는다.
  it("곱셈 합성 전에 배경을 순백으로 올린다", () => {
    const b = block(".media-plate");
    expect(b).toMatch(/mix-blend-mode:\s*multiply/);
    const m = b.match(/brightness\(([0-9.]+)\)/);
    expect(m, "brightness 보정이 없다 — 사각형이 남는다").not.toBeNull();
    expect(Number(m![1])).toBeGreaterThanOrEqual(1.008); // 255/253
  });

  it("히어로는 흰 밴드가 아니라 종이색이다", () => {
    const hero = readFileSync(join(root, "components/Hero.tsx"), "utf8");
    expect(hero).toMatch(/<section className="[^"]*bg-paper/);
    expect(hero).toMatch(/className="media-plate/);
  });
});

describe("줄바꿈 — 마지막 줄의 외톨이 어절", () => {
  // ★ 클래스가 아니라 요소에 걸어야 한다. 이 저장소의 제목 계층(.t-title1 등)은
  //   실제 사용처가 0 곳이라, 거기에만 걸면 어느 화면에서도 효과가 없다.
  it("제목은 클래스와 무관하게 줄길이를 고르게 나눈다", () => {
    const m = css.match(/:where\(([^)]*h1[^)]*)\)\s*\{\s*text-wrap:\s*balance/);
    expect(m, "h1 을 포함한 요소 선택자에 balance 가 걸려 있지 않다").not.toBeNull();
    for (const tag of ["h1", "h2", "h3"]) expect(m![1]).toContain(tag);
  });

  // 긴 문단에 balance 를 걸면 줄길이가 들쭉날쭉해진다 — 마지막 줄만 손본다.
  it("문단은 balance 가 아니라 pretty 다", () => {
    const m = css.match(/:where\(([^)]*\bp\b[^)]*)\)\s*\{\s*text-wrap:\s*pretty/);
    expect(m, "p 를 포함한 요소 선택자에 pretty 가 걸려 있지 않다").not.toBeNull();
  });
});

describe("계층이 다시 흩어지지 않게 — 톱니바퀴(ratchet)", () => {
  // 이 저장소에는 t-display~t-caption 계층이 이미 있는데도 화면마다 text-[13px]
  //   같은 임의 크기를 골라 쓴 자리가 1,118 곳 있다. 그래서 같은 '보조 설명'이
  //   화면마다 다른 크기로 나오고, 모바일 가독성을 맞추려 px 값마다 +1px 하는
  //   보정표까지 생겼다(globals.css 아래쪽).
  //
  //   한 번에 다 고칠 수는 없다. 대신 '늘어나지만 않게' 막는다 — 고칠 때마다
  //   이 숫자를 내려 적으면 된다. 올리는 방향으로는 테스트가 막는다.
  const BASELINE = 1118;

  function walk(dir: string, out: string[] = []): string[] {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full, out);
      else if (name.endsWith(".tsx")) out.push(full);
    }
    return out;
  }

  it(`임의 글자크기는 ${BASELINE}곳을 넘지 않는다`, () => {
    const files = [...walk(join(root, "app")), ...walk(join(root, "components"))];
    let count = 0;
    for (const f of files) {
      count += (readFileSync(f, "utf8").match(/text-\[[0-9.]+px\]/g) ?? []).length;
    }
    expect(
      count,
      `임의 글자크기가 ${count}곳으로 늘었다. t-body·t-footnote 같은 계층을 쓰고, ` +
        `줄였으면 이 테스트의 BASELINE 을 ${count} 로 내려 적는다.`
    ).toBeLessThanOrEqual(BASELINE);
  });
});

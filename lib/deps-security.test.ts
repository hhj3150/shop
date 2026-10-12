// 보안 하한선 고정 — 취약한 버전으로 되돌아가지 않게 막는다.
//
//   2026-09 외부 점검: next 16.2.6 이 GHSA 다수에 걸려 있었다. 우리에게 실제로 해당하는 건
//   이미지 최적화 API 두 건이다(AVIF 원격코드실행 GHSA-2xp9-vwfh-vxw4 · SVG 서비스거부
//   GHSA-q8wf-6r8g-63ch). next/image 를 18개 파일에서 쓰고 next.config 의 remotePatterns 로
//   Supabase 스토리지 이미지를 최적화해 내보내므로 노출 경로가 살아 있다.
//   (미들웨어·서버액션·Turbopack 미사용, 호스팅은 리눅스 → 나머지 권고는 해당 없음.)
//
//   package.json 을 직접 읽는다 — 설치된 node_modules 가 아니라 '무엇을 설치하기로 했는가'가
//   배포에 반영되는 값이기 때문이다(락파일은 CI 의 npm ci 가 강제한다).
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

type Pkg = {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
};

const pkg: Pkg = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8")
);

/** "16.3.6" → [16, 3, 6]. 범위 지정자(^ ~ >=)는 떼고 본다. */
function parseVersion(spec: string): [number, number, number] {
  const m = /(\d+)\.(\d+)\.(\d+)/.exec(spec);
  if (!m) throw new Error(`버전을 읽을 수 없습니다: ${spec}`);
  return [Number(m[1]), Number(m[2]), Number(m[3])];
}

function gte(spec: string, min: [number, number, number]): boolean {
  const v = parseVersion(spec);
  for (let i = 0; i < 3; i++) {
    if (v[i] > min[i]) return true;
    if (v[i] < min[i]) return false;
  }
  return true;
}

// 이미지 최적화 API 권고가 패치된 첫 버전.
const NEXT_MIN: [number, number, number] = [16, 3, 6];

describe("의존성 보안 하한선", () => {
  it(`next 는 ${NEXT_MIN.join(".")} 이상이어야 한다`, () => {
    expect(gte(pkg.dependencies.next, NEXT_MIN)).toBe(true);
  });

  it("eslint-config-next 는 next 와 같은 버전이어야 한다", () => {
    // 버전이 어긋나면 lint 규칙이 실제 빌드하는 next 와 달라진다.
    expect(parseVersion(pkg.devDependencies["eslint-config-next"])).toEqual(
      parseVersion(pkg.dependencies.next)
    );
  });

  it("next 는 정확한 버전으로 고정한다(범위 지정자 금지)", () => {
    // ^ 로 두면 락파일 없이 설치하는 환경에서 조용히 버전이 갈린다.
    expect(pkg.dependencies.next).toMatch(/^\d+\.\d+\.\d+$/);
  });
});

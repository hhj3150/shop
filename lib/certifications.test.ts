// 인증 표시는 '사실'의 영역이다 — 틀리면 표시광고 문제가 된다. 그래서 값이 아니라 규칙을 지킨다.
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CERTIFICATIONS, activeCertifications, certValidityLabel } from "./certifications";

const root = fileURLToPath(new URL("..", import.meta.url));

describe("인증 목록의 형식", () => {
  it("모든 인증은 명칭·발급기관·번호·범위·시작일을 갖는다", () => {
    for (const c of CERTIFICATIONS) {
      for (const k of ["name", "issuer", "number", "scope"] as const) {
        expect(c[k].trim().length, `${c.id}.${k}`).toBeGreaterThan(0);
      }
      expect(c.validFrom).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      if (c.validUntil) {
        expect(c.validUntil).toMatch(/^\d{4}-\d{2}-\d{2}$/);
        expect(c.validUntil > c.validFrom, `${c.id}: 기간이 거꾸로다`).toBe(true);
      }
    }
  });

  it("유기(유기농) 인증은 없다 — 보유하지 않은 인증을 목록에 넣지 않는다", () => {
    for (const c of CERTIFICATIONS) expect(c.name).not.toMatch(/유기|organic/i);
  });

  // 인증서에는 생년월일·사업자등록번호가 함께 적혀 있다. 번호 칸에 잘못 옮겨 적는 사고를 막는다.
  it("개인정보(생년월일·사업자등록번호 모양)가 섞여 있지 않다", () => {
    const text = JSON.stringify(CERTIFICATIONS);
    expect(text).not.toMatch(/\d{3}-\d{2}-\d{5}/); // 사업자등록번호
    expect(text).not.toMatch(/19\d{2}[.-]\s?\d{1,2}[.-]\s?\d{1,2}/); // 19xx 년생 생년월일
  });
});

describe("유효기간 — 지난 인증은 화면에서 빠진다", () => {
  it("끝나는 날 당일까지는 나오고, 다음 날부터 빠진다", () => {
    const ids = (d: string) => activeCertifications(d).map((c) => c.id);
    expect(ids("2026-04-18")).toContain("clean-farm");
    expect(ids("2026-04-19")).not.toContain("clean-farm");
    expect(ids("2027-10-09")).toContain("low-carbon");
    expect(ids("2027-10-10")).not.toContain("low-carbon");
  });

  it("시작 전에는 나오지 않는다", () => {
    expect(activeCertifications("2026-04-27").map((c) => c.id)).not.toContain("animal-welfare");
  });

  it("2026-11-11 기준: 동물복지·저탄소·HACCP·가축행복농장 넷", () => {
    expect(activeCertifications("2026-11-11").map((c) => c.id)).toEqual([
      "animal-welfare",
      "low-carbon",
      "haccp-farm",
      "gyeonggi-happy-farm",
    ]);
  });

  it("유효기간이 없는 인증은 인증 시점을 적는다", () => {
    const g = CERTIFICATIONS.find((c) => c.id === "gyeonggi-happy-farm")!;
    expect(certValidityLabel(g)).toBe("2019년 11월 인증");
    const a = CERTIFICATIONS.find((c) => c.id === "animal-welfare")!;
    expect(certValidityLabel(a)).toBe("2029년 4월 27일까지");
  });
});

describe("인증 문구는 이 목록에서만 나온다", () => {
  // 화면 파일에 인증 이름을 손으로 적어 두면, 기간이 지나도 그 문장은 남는다.
  //   (실제로 Provenance 에 '깨끗한목장 인증'이 유효기간이 지난 채로 걸려 있었다.)
  it("고객 화면 소스에 인증 이름을 직접 적은 곳이 없다", () => {
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const p = join(dir, name);
        if (statSync(p).isDirectory()) {
          if (name === "admin" || name === "api") continue;
          walk(p);
        } else if (/\.tsx$/.test(name) && !/^Admin|Panel\.tsx$/.test(name)) {
          const src = readFileSync(p, "utf8");
          src.split("\n").forEach((line, i) => {
            if (/^\s*(\/\/|\*|\{\/\*)/.test(line)) return; // 주석
            if (/(저탄소|동물복지|HACCP|가축행복농장|깨끗한\s?(목장|축산농장))[^"'`]*(인증|지정)/.test(line))
              offenders.push(`${p.replace(root, "")}:${i + 1}`);
          });
        }
      }
    };
    walk(join(root, "app"));
    walk(join(root, "components"));
    expect(offenders).toEqual([]);
  });
});

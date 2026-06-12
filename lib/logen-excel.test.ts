import { describe, it, expect } from "vitest";
import { parseLogenSheet } from "./logen-excel";

function sample(): string[][] {
  const r: string[][] = [];
  r[0] = ["주문실적조회"];
  r[1] = [];
  const h1: string[] = [];
  h1[0] = "No."; h1[7] = "주문번호"; h1[8] = "운송장번호"; h1[12] = "수하인"; h1[16] = "휴대폰";
  r[2] = h1;
  r[3] = [];
  const d = (no: string, order: string, track: string, name: string, phone: string) => {
    const a: string[] = [];
    a[0] = no; a[7] = order; a[8] = track; a[12] = name; a[16] = phone;
    return a;
  };
  r[4] = d("1", "", "445-3834-1186", "김태연", "010-7663-****");
  r[5] = d("2", "", "445-3834-1190", "윤화영", "010-6408-****");
  r[6] = d("", "", "", "", "");
  return r;
}

describe("parseLogenSheet", () => {
  it("데이터행만 파싱, 송장 숫자화, 휴대폰7 추출", () => {
    const out = parseLogenSheet(sample());
    expect(out).toHaveLength(2);
    expect(out[0]).toEqual({ tracking: "44538341186", recipientName: "김태연", phone7: "0107663", orderNo: "" });
    expect(out[1].tracking).toBe("44538341190");
    expect(out[1].phone7).toBe("0106408");
  });
  it("운송장번호 헤더 없으면 빈 배열", () => {
    expect(parseLogenSheet([["엉뚱"], ["a", "b"]])).toEqual([]);
  });
  it("col8 주문번호가 있으면 보존", () => {
    const rows = sample();
    rows[4][7] = "SY-20260608-001";
    expect(parseLogenSheet(rows)[0].orderNo).toBe("SY-20260608-001");
  });
  it("휴대폰 라벨이 둘째 헤더행(병합)에 있어도 열 인덱스로 탐지·데이터행 정확", () => {
    const r: string[][] = [];
    r[0] = ["주문실적조회"]; r[1] = [];
    const h1: string[] = []; h1[8] = "운송장번호"; h1[12] = "수하인"; r[2] = h1;
    const h2: string[] = []; h2[16] = "휴대폰"; r[3] = h2;
    const d: string[] = []; d[8] = "445-3834-1186"; d[12] = "김태연"; d[16] = "010-7663-****"; r[4] = d;
    const out = parseLogenSheet(r);
    expect(out).toHaveLength(1);
    expect(out[0]).toEqual({ tracking: "44538341186", recipientName: "김태연", phone7: "0107663", orderNo: "" });
  });
});

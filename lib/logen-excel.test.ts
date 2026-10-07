import { describe, it, expect } from "vitest";
import { parseLogenSheet } from "./logen-excel";

function sample(): string[][] {
  const r: string[][] = [];
  r[0] = ["주문실적조회"];
  r[1] = [];
  const h1: string[] = [];
  h1[0] = "No."; h1[2] = "접수일자"; h1[7] = "주문번호"; h1[8] = "운송장번호"; h1[12] = "수하인"; h1[16] = "휴대폰";
  r[2] = h1;
  r[3] = [];
  const d = (no: string, order: string, track: string, name: string, phone: string, date = "2026-06-29") => {
    const a: string[] = [];
    a[0] = no; a[2] = date; a[7] = order; a[8] = track; a[12] = name; a[16] = phone;
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
    expect(out[0]).toEqual({
      tracking: "44538341186", recipientName: "김태연", phone7: "0107663",
      orderNo: "", shipDate: "2026-06-29",
    });
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
    // 접수일자 열이 없는 시트 → shipDate 는 빈값(소급 입력에서 제외된다).
    expect(out[0]).toEqual({
      tracking: "44538341186", recipientName: "김태연", phone7: "0107663",
      orderNo: "", shipDate: "",
    });
  });

  // ─ 접수일자 ─ 소급 입력(과거 회차 복구)의 전제.
  //   '배송일자'가 아니라 '접수일자' 를 쓴다 — 배송일자는 보통 하루 뒤라 회차가 밀려 보인다.
  it("접수일자를 YYYY-MM-DD 로 읽는다", () => {
    expect(parseLogenSheet(sample())[0].shipDate).toBe("2026-06-29");
  });

  it("구분자가 / . 여도 읽는다", () => {
    const r1 = sample(); r1[4][2] = "2026/07/13";
    expect(parseLogenSheet(r1)[0].shipDate).toBe("2026-07-13");
    const r2 = sample(); r2[4][2] = "2026.8.3";
    expect(parseLogenSheet(r2)[0].shipDate).toBe("2026-08-03");
  });

  it("시각이 붙어 있어도 날짜만 취한다", () => {
    const r = sample(); r[4][2] = "2026-09-29 14:22:01";
    expect(parseLogenSheet(r)[0].shipDate).toBe("2026-09-29");
  });

  it("읽을 수 없는 날짜는 빈값 — 추측하지 않는다", () => {
    const r = sample(); r[4][2] = "6월 29일";
    expect(parseLogenSheet(r)[0].shipDate).toBe("");
  });

  // ★ 배송일자를 '접수일자보다 앞 열'에 둔다 — 라벨을 느슨하게('일자') 찾으면 이 열이
  //   먼저 걸려 하루 밀린 날짜를 쓰게 된다. 열 순서에 기대지 않고 라벨을 검증하는 테스트다.
  it("'배송일자'가 앞 열에 있어도 '접수일자'를 고른다", () => {
    const r: string[][] = [];
    r[0] = ["주문실적조회"]; r[1] = [];
    const h: string[] = [];
    h[1] = "배송일자"; h[2] = "접수일자"; h[8] = "운송장번호"; h[12] = "수하인"; h[16] = "휴대폰";
    r[2] = h;
    const d: string[] = [];
    d[1] = "2026-06-30";  // 배송일자(하루 뒤)
    d[2] = "2026-06-29";  // 접수일자 ← 이걸 써야 한다
    d[8] = "445-3834-1186"; d[12] = "김태연"; d[16] = "010-7663-****";
    r[3] = d;
    expect(parseLogenSheet(r)[0].shipDate).toBe("2026-06-29");
  });
});

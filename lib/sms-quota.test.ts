import { describe, it, expect, afterEach } from "vitest";
import { dailyCap, DEFAULT_SMS_DAILY_CAP } from "./sms-quota";

const KEY = "SMS_DAILY_CAP_PER_PHONE";
const original = process.env[KEY];

afterEach(() => {
  if (original === undefined) delete process.env[KEY];
  else process.env[KEY] = original;
});

describe("dailyCap", () => {
  it("미설정이면 기본값 10 — 운영 이력 최대치(하루 4통)의 2.5배라 실제 손님을 막지 않는다", () => {
    delete process.env[KEY];
    expect(dailyCap()).toBe(DEFAULT_SMS_DAILY_CAP);
    expect(DEFAULT_SMS_DAILY_CAP).toBe(10);
  });

  it("환경변수로 배포 없이 조절한다", () => {
    process.env[KEY] = "25";
    expect(dailyCap()).toBe(25);
  });

  // 잘못 넣은 값 때문에 문자가 통째로 막히면 안 된다 → 전부 기본값으로 떨어진다.
  it.each(["0", "-3", "abc", "", "3.5", " "])("잘못된 값 %j 는 기본값으로", (raw) => {
    process.env[KEY] = raw;
    expect(dailyCap()).toBe(DEFAULT_SMS_DAILY_CAP);
  });
});

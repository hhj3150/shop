// 송영신목장이 보유한 인증·지정 — 화면에 '인증'이라고 적는 유일한 근거.
//
//   ★ 여기 없는 인증은 사이트 어디에도 적지 않는다. 한 줄 한 줄이 2026-11-11 에 받은
//     인증서 원본(스캔)과 대조한 값이다: 명칭·발급기관·번호·유효기간 그대로.
//   ★ 유효기간이 지난 인증은 화면에서 저절로 빠진다(activeCertifications). 갱신되면
//     validFrom/validUntil 과 번호만 고치면 다시 나온다 — 지우지 않고 남겨 두는 이유다.
//   ★ 인증서에는 대표자 생년월일·자택 주소·사업자등록번호가 함께 적혀 있다.
//     그 정보는 여기에도, 저장소 어디에도 옮기지 않는다. 인증서 파일도 올리지 않는다.
//   ★ 유기(유기농) 인증은 보유하고 있지 않다. '유기농'이라는 말을 인증처럼 쓰지 않는다.
//   ★ 모두 '농장(젖소 사육·착유 단계)'에 대한 인증이다. 가공 제품에 대한 인증처럼
//     읽히게 쓰지 않는다(예: 'HACCP 인증 우유' ✕ → 'HACCP 인증 농장' ○).

export type Certification = {
  id: string;
  /** 인증서에 적힌 공식 명칭 */
  name: string;
  /** 발급기관(인증서의 직인 주체) */
  issuer: string;
  /** 인증·지정번호 */
  number: string;
  /** 무엇에 대한 인증인지 — 손님이 오해하지 않게 한 줄로 */
  scope: string;
  /** 유효기간 시작(없으면 최초 인증일). YYYY-MM-DD */
  validFrom: string;
  /** 유효기간 끝. 인증서에 유효기간이 없으면 null */
  validUntil: string | null;
};

export const CERTIFICATIONS: readonly Certification[] = [
  {
    id: "animal-welfare",
    name: "동물복지축산농장 인증",
    issuer: "축산환경관리원",
    number: "동물복지-10-30-6-1호",
    // 인증서의 '자유방목 기준 충족 여부'는 '부'다 — 방목·자유방목이라는 말을 붙이지 않는다.
    scope: "젖소 사육 농장",
    validFrom: "2026-04-28",
    validUntil: "2029-04-27",
  },
  {
    id: "low-carbon",
    name: "저탄소 축산물 농장 인증",
    issuer: "축산물품질평가원",
    number: "제2024-2-068호",
    scope: "젖소 사육 농장",
    validFrom: "2024-10-10",
    validUntil: "2027-10-09",
  },
  {
    id: "haccp-farm",
    name: "안전관리인증(HACCP) 농장",
    issuer: "한국식품안전관리인증원",
    number: "제2016-0-0718호",
    scope: "가축사육업(젖소) · 착유·원유 보관·출하",
    validFrom: "2025-12-29",
    validUntil: "2028-12-28",
  },
  {
    id: "gyeonggi-happy-farm",
    name: "경기도 가축행복농장 인증",
    issuer: "경기도",
    number: "가축행복-23-2-2호",
    scope: "젖소 사육 농장",
    validFrom: "2019-11-08",
    validUntil: null, // 인증서에 유효기간이 적혀 있지 않다
  },
  {
    id: "clean-farm",
    name: "깨끗한 축산농장 지정",
    issuer: "농림축산식품부",
    number: "001-21-2-3641",
    scope: "낙농 농장",
    validFrom: "2021-04-19",
    // 받은 지정서의 유효기간은 2026-04-18 까지다 → 지금은 화면에 나오지 않는다.
    //   재지정서를 받으면 번호와 기간을 갱신한다.
    validUntil: "2026-04-18",
  },
];

/** 오늘(YYYY-MM-DD, KST) 기준으로 유효한 인증만. 끝나는 날 당일까지는 유효하다. */
export function activeCertifications(todayISO: string): Certification[] {
  return CERTIFICATIONS.filter(
    (c) => c.validFrom <= todayISO && (c.validUntil === null || todayISO <= c.validUntil)
  );
}

/** "2029년 4월 27일까지" / 유효기간이 없으면 "2019년 11월 인증" */
export function certValidityLabel(c: Certification): string {
  if (c.validUntil) {
    const [y, m, d] = c.validUntil.split("-").map(Number);
    return `${y}년 ${m}월 ${d}일까지`;
  }
  const [y, m] = c.validFrom.split("-").map(Number);
  return `${y}년 ${m}월 인증`;
}

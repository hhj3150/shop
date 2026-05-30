// 배송 추적: 택배사 목록 + 송장번호 조회 링크 생성.
// 무통장입금·수동 운영에 맞춰, 관리자가 택배사/송장번호를 직접 입력하면
// 고객 화면에서 해당 택배사 조회 페이지로 연결한다(외부 API 미사용).

export type CourierId =
  | "cj"
  | "epost"
  | "hanjin"
  | "lotte"
  | "logen"
  | "etc";

type CourierDef = {
  label: string;
  track: ((no: string) => string) | null; // null = 조회 링크 없음(직접 안내)
};

export const COURIERS: Record<CourierId, CourierDef> = {
  cj: {
    label: "CJ대한통운",
    track: (no) => `https://trace.cjlogistics.com/next/tracking.html?wblNo=${no}`,
  },
  epost: {
    label: "우체국택배",
    track: (no) =>
      `https://service.epost.go.kr/trace.RetrieveDomRigiTraceList.comm?sid1=${no}`,
  },
  hanjin: {
    label: "한진택배",
    track: (no) =>
      `https://www.hanjin.com/kor/CMS/DeliveryMgr/WaybillResult.do?mCode=MN038&schLang=KR&wblnumText2=${no}`,
  },
  lotte: {
    label: "롯데택배",
    track: (no) =>
      `https://www.lotteglogis.com/home/reservation/tracking/linkView?InvNo=${no}`,
  },
  logen: {
    label: "로젠택배",
    track: (no) => `https://www.ilogen.com/web/personal/trace/${no}`,
  },
  etc: {
    label: "기타·직접배송",
    track: null,
  },
};

export const COURIER_IDS = Object.keys(COURIERS) as CourierId[];

export function courierLabel(id: string | null | undefined): string {
  if (!id) return "";
  return COURIERS[id as CourierId]?.label ?? id;
}

// 택배사+송장번호로 조회 URL 생성. 조회 불가(직접배송 등)면 null.
export function trackingUrl(
  courier: string | null | undefined,
  trackingNo: string | null | undefined
): string | null {
  if (!courier || !trackingNo) return null;
  const def = COURIERS[courier as CourierId];
  if (!def?.track) return null;
  return def.track(encodeURIComponent(trackingNo.trim()));
}

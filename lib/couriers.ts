// 배송 추적: 택배사 + 송장번호 조회 링크 생성.
// 무통장입금·수동 운영에 맞춰, 관리자가 송장번호를 직접 입력하면
// 고객 화면에서 택배사 조회 페이지로 연결한다(외부 API 미사용).
//
// 택배사는 로젠택배 하나로 고정한다. 신규 발송은 항상 'logen'.
// 단, 과거 주문에 이미 저장된 택배사 값은 화면 표기·조회 링크가 끊기지
// 않도록 LEGACY_COURIERS 에 남겨 둔다(선택지로는 노출하지 않음).

export type CourierId = "logen";

type CourierDef = {
  label: string;
  track: ((no: string) => string) | null; // null = 조회 링크 없음(직접 안내)
};

export const COURIERS: Record<CourierId, CourierDef> = {
  logen: {
    label: "로젠택배",
    track: (no) => `https://www.ilogen.com/web/personal/trace/${no}`,
  },
};

export const COURIER_IDS = Object.keys(COURIERS) as CourierId[];

// 고정 택배사 — 신규 발송 시 저장되는 값.
export const DEFAULT_COURIER_ID: CourierId = "logen";

// 과거 데이터 호환용(선택 불가, 표시·조회만).
const LEGACY_COURIERS: Record<string, CourierDef> = {
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
  etc: {
    label: "기타·직접배송",
    track: null,
  },
};

function courierDef(id: string): CourierDef | undefined {
  return COURIERS[id as CourierId] ?? LEGACY_COURIERS[id];
}

export function courierLabel(id: string | null | undefined): string {
  if (!id) return "";
  return courierDef(id)?.label ?? id;
}

// 택배사+송장번호로 조회 URL 생성. 조회 불가(직접배송 등)면 null.
export function trackingUrl(
  courier: string | null | undefined,
  trackingNo: string | null | undefined
): string | null {
  if (!courier || !trackingNo) return null;
  const def = courierDef(courier);
  if (!def?.track) return null;
  return def.track(encodeURIComponent(trackingNo.trim()));
}

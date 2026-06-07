// UTC 타임스탬프(Supabase timestamptz ISO)를 KST(UTC+9) 달력으로 환산.
//   created_at 을 raw 문자열로 slice 하면 UTC 기준이라, KST 자정 직후(=UTC 전날 15시
//   이후) 주문이 전날/전월로 잘못 귀속된다. 정산·일매출 버킷팅은 KST 로 맞춰야 한다.
//   한국은 DST 가 없어 고정 +9h 로 안전하다.

const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

// UTC ISO → KST 달력 부품. 빈/잘못된 입력은 null.
function kstParts(isoUtc: string): { y: number; m: number; d: number } | null {
  if (!isoUtc) return null;
  const t = Date.parse(isoUtc);
  if (Number.isNaN(t)) return null;
  // UTC 인스턴트를 +9h 시프트한 뒤 UTC 부품을 읽으면 KST 달력이 된다.
  const k = new Date(t + KST_OFFSET_MS);
  return { y: k.getUTCFullYear(), m: k.getUTCMonth() + 1, d: k.getUTCDate() };
}

// KST 기준 "YYYY-MM". 잘못된 입력은 "".
export function kstYearMonth(isoUtc: string): string {
  const p = kstParts(isoUtc);
  return p ? `${p.y}-${pad(p.m)}` : "";
}

// KST 기준 "YYYY-MM-DD". 잘못된 입력은 "".
export function kstYmd(isoUtc: string): string {
  const p = kstParts(isoUtc);
  return p ? `${p.y}-${pad(p.m)}-${pad(p.d)}` : "";
}

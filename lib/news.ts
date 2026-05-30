// 소식(공지) 데이터 모델 + 순수 유틸.
// "자동편집"은 서식 정리 수준(공백·줄바꿈 정규화)만 수행한다 — 원문 의미는 보존.

export type NewsRow = {
  id: string;
  title: string;
  body: string;
  cover_url: string | null;
  youtube_id: string | null;
  published: boolean;
  created_at: string;
  updated_at: string;
};

/** 유튜브 URL/ID 입력에서 11자리 video id를 추출. 못 찾으면 null. */
export function youtubeId(input: string): string | null {
  const raw = input.trim();
  if (!raw) return null;

  // 이미 11자리 id 그대로 입력한 경우
  if (/^[\w-]{11}$/.test(raw)) return raw;

  const patterns = [
    /youtu\.be\/([\w-]{11})/,
    /[?&]v=([\w-]{11})/,
    /youtube\.com\/embed\/([\w-]{11})/,
    /youtube\.com\/shorts\/([\w-]{11})/,
  ];
  for (const re of patterns) {
    const m = raw.match(re);
    if (m) return m[1];
  }
  return null;
}

/**
 * 서식만 정리: CRLF 정규화, 줄 끝 공백 제거, 3줄 이상 연속 빈 줄을 한 칸으로,
 * 앞뒤 공백 제거. 문장·표현은 그대로 둔다.
 */
export function formatBody(raw: string): string {
  return raw
    .replace(/\r\n?/g, "\n")
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/g, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function formatTitle(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** 본문을 빈 줄 기준 문단 배열로 분리(렌더링용). */
export function toParagraphs(body: string): string[] {
  return formatBody(body)
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
}

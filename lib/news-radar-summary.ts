// 영문 기사 텍스트 → 한국어 한 문단 요약 프롬프트·파서(순수).
export function buildSummaryPrompt(
  englishText: string,
  meta: { originalTitle?: string; topic?: string }
): string {
  return [
    "아래 영문 기사 내용을 자연스러운 한국어로 번역·요약하세요.",
    "분량: 한 문단(4-7문장, 대략 300-500자). 독자가 영어 원문을 읽지 않아도 핵심을 이해하도록 사실 위주로.",
    "금지: 의견·과장·효능 단정·광고성 표현(식품표시광고법). 본문에 없는 내용 추가 금지.",
    meta.topic ? `주제: ${meta.topic}` : "",
    meta.originalTitle ? `원문 제목: ${meta.originalTitle}` : "",
    "",
    "원문 내용:",
    englishText,
    "",
    'JSON 으로만 답하세요(다른 텍스트 금지): {"title_ko":"간결한 한글 제목","summary_ko":"한 문단 한글 요약"}',
  ].filter(Boolean).join("\n");
}

export function parseSummary(content: string): { title_ko: string; summary_ko: string } | null {
  try {
    const m = content.match(/\{[\s\S]*\}/);
    if (!m) return null;
    const o = JSON.parse(m[0]) as { title_ko?: unknown; summary_ko?: unknown };
    const title_ko = typeof o.title_ko === "string" ? o.title_ko.trim() : "";
    const summary_ko = typeof o.summary_ko === "string" ? o.summary_ko.trim() : "";
    if (!title_ko || !summary_ko) return null;
    return { title_ko, summary_ko };
  } catch {
    return null;
  }
}

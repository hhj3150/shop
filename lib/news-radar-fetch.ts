// 원문 본문을 Jina Reader 로 가져온다(publisher URL 전용, 옵션 보강). 실패 시 null(호출부 폴백).
export async function fetchArticleText(
  url: string,
  cfg?: { apiKey?: string; maxChars?: number; fetchImpl?: typeof fetch; timeoutMs?: number }
): Promise<string | null> {
  const f = cfg?.fetchImpl ?? fetch;
  const maxChars = cfg?.maxChars ?? 6000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), cfg?.timeoutMs ?? 8000);
  try {
    const headers: Record<string, string> = {};
    if (cfg?.apiKey) headers.Authorization = `Bearer ${cfg.apiKey}`;
    const res = await f(`https://r.jina.ai/${url}`, { headers, signal: controller.signal });
    if (!res.ok) return null;
    const text = (await res.text()).trim();
    if (!text) return null;
    return text.slice(0, maxChars);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

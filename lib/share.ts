// 공유 페이로드.
export type SharePayload = { title: string; text: string; url: string };

// 주입형 의존성: navigator.share / clipboard.writeText 를 분리해 순수 테스트 가능하게.
export type ShareDeps = {
  share?: (data: SharePayload) => Promise<void>;
  writeText: (text: string) => Promise<void>;
};

export type ShareResult = "shared" | "copied" | "cancelled";

// Web Share 우선, 미지원/실패 시 클립보드 복사 폴백. 사용자 취소(AbortError)는 조용히 무시.
export async function shareOrCopy(
  deps: ShareDeps,
  payload: SharePayload
): Promise<ShareResult> {
  if (deps.share) {
    try {
      await deps.share(payload);
      return "shared";
    } catch (e) {
      if (e instanceof Error && e.name === "AbortError") return "cancelled";
      // 그 외 실패는 폴백으로 진행
    }
  }
  await deps.writeText(payload.url);
  return "copied";
}

// Next.js 서버 인스트루멘테이션(루트 파일 컨벤션). 서버 시작 시 1회 register() 호출.
// 런타임별로 Sentry 초기화 모듈을 분기 로드하고, onRequestError 로 서버 에러를 Sentry 에 보고한다.
import * as Sentry from "@sentry/nextjs";

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// 서버 컴포넌트/라우트 핸들러/서버 액션에서 발생한 에러를 Sentry 로 캡처.
export const onRequestError = Sentry.captureRequestError;

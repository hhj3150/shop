// Next.js 클라이언트 인스트루멘테이션(루트 파일 컨벤션). 하이드레이션 전에 1회 실행.
// 브라우저 Sentry 초기화. DSN(NEXT_PUBLIC_SENTRY_DSN) 미설정 시 no-op → 무중단.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  enabled: process.env.NODE_ENV === "production",
});

// 라우터 전환을 Sentry 트레이싱에 연결(클라이언트 네비게이션 계측).
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;

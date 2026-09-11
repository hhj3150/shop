// Sentry 엣지(Edge 런타임) 초기화. instrumentation.ts 의 register() 에서 로드된다.
// 미들웨어·Edge 라우트용. DSN 미설정 시 no-op.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  enabled: process.env.NODE_ENV === "production",
});

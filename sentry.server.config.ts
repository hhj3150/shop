// Sentry 서버(Node.js 런타임) 초기화. instrumentation.ts 의 register() 에서 로드된다.
// DSN(NEXT_PUBLIC_SENTRY_DSN) 미설정 시 init 은 사실상 no-op → 에러 수집만 비활성, 앱은 무중단.
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  // 트랜잭션 표본 비율. 운영 비용 절감을 위해 기본 10%.
  tracesSampleRate: 0.1,
  // 운영 환경에서만 전송(개발 중 노이즈 방지). 미설정 시 NODE_ENV 로 폴백.
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV,
  enabled: process.env.NODE_ENV === "production",
});

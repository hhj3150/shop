"use client";

// 전역 에러 경계: 루트 레이아웃 렌더 중 발생한 에러는 일반 error.tsx 로 잡히지 않으므로
// 여기서 Sentry 에 보고한다. 이 컴포넌트는 루트 레이아웃을 대체하므로 자체 <html>/<body> 를 렌더한다.
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="ko">
      <body
        style={{
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          gap: "1rem",
          fontFamily: "system-ui, sans-serif",
          color: "#1a1a1a",
          background: "#fafafa",
          textAlign: "center",
          padding: "1.5rem",
        }}
      >
        <h1 style={{ fontSize: "1.25rem", fontWeight: 600, margin: 0 }}>
          일시적인 오류가 발생했어요
        </h1>
        <p style={{ margin: 0, color: "#666", fontSize: "0.95rem" }}>
          잠시 후 다시 시도해 주세요. 문제가 계속되면 고객센터로 문의해 주세요.
        </p>
        <button
          type="button"
          onClick={() => reset()}
          style={{
            marginTop: "0.5rem",
            padding: "0.6rem 1.4rem",
            borderRadius: "999px",
            border: "none",
            background: "#1a1a1a",
            color: "#fff",
            fontSize: "0.95rem",
            cursor: "pointer",
          }}
        >
          다시 시도
        </button>
      </body>
    </html>
  );
}

import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {
      // 이 룰이 지적하는 곳은 전부 '외부 시스템과의 동기화'다 — localStorage 하이드레이션
      //   복원(cart), 리디렉션 복귀 처리(billing), fetch 시작 시 로딩 플래그, 브라우저
      //   기능 감지(useVoiceInput). SSR 하이드레이션 안전성 때문에 effect 가 맞는 자리라
      //   기계적으로 고치면 오히려 동작이 바뀐다. 경고로 낮춰 새 코드에서만 신호로 쓴다.
      "react-hooks/set-state-in-effect": "warn",
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;

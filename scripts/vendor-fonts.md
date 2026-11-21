# 웹폰트 다시 만들기 (app/fonts.css + public/fonts)

사이트 웹폰트는 빌드 때 구글에 묻지 않도록 저장소 안에 둔다(2026-11-21 운영 빌드가 구글 폰트 응답 실패로 깨진 뒤).
글꼴을 바꾸거나 더할 때만 아래를 한다.

1. 임시로 `app/layout.tsx` 에 `next/font/google` 설정을 넣고(원하는 서체·subsets·weight·display) `npm run build`.
2. `.next/static/css/*.css` 의 `@font-face{…}` 규칙과, 거기 나오는 `/_next/static/media/*.woff2` 파일을 모은다.
3. 파일은 `public/fonts/` 로 복사하고, 규칙의 주소를 `/fonts/…` 로 바꿔 `app/fonts.css` 에 넣는다.
   `:root` 의 `--font-…` 변수(대체 글꼴 이름 포함)도 함께 맞춘다.
4. 이름에 `.p.` 가 들어간 파일은 next/font 가 preload 하던 조각이다 → `app/layout.tsx` 의 PRELOAD_FONTS.
5. `next/font/google` 설정은 다시 지운다.

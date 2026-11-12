// JSON-LD 를 <script> 안에 넣을 문자열로 바꾼다.
//   JSON.stringify 는 '<' 를 그대로 둔다 → 값 안에 "</script>" 가 들어오면 스크립트가 거기서 끝나고
//   뒤가 HTML 로 해석된다(XSS). Next 공식 JSON-LD 가이드가 경고하는 패턴이다
//   (node_modules/next/dist/docs/01-app/02-guides/json-ld.md). 지금 데이터는 내부 SSOT 뿐이지만,
//   후기·소식(DB 문자열)을 구조화데이터에 넣는 순간 바로 구멍이 되므로 미리 막는다.
//   U+2028/U+2029 도 일부 파서에서 줄바꿈으로 취급되므로 함께 이스케이프한다. JSON 의미는 같다.
export function serializeJsonLd(data: unknown): string {
  return JSON.stringify(data)
    .replace(/</g, "\\u003c")
    .replace(/\u2028/g, "\\u2028")
    .replace(/\u2029/g, "\\u2029");
}

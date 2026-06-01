// JSON-LD 한 덩어리를 <script type="application/ld+json">로 렌더한다.
// data는 내부 SSOT에서 파생되는 객체이며 사용자 입력을 포함하지 않는다.
export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data) }}
    />
  );
}

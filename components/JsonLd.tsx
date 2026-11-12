import { serializeJsonLd } from "@/lib/seo/serialize";

// JSON-LD 한 덩어리를 <script type="application/ld+json">로 렌더한다.
//   직렬화는 serializeJsonLd — '<' 를 이스케이프해 값이 </script> 를 품어도 태그를 닫지 못한다.
export function JsonLd({ data }: { data: object }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: serializeJsonLd(data) }}
    />
  );
}

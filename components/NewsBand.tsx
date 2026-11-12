import { fetchLatestNews } from "@/lib/news-server";
import { NewsBandList } from "./NewsBandList";

const MAX_ITEMS = 4;

// /story '목장 소식' 띠 — 서버에서 최근 게시글을 읽어 첫 HTML 에 넣는다.
//   [왜] 예전에는 브라우저가 직접 읽어 그려서 서버 HTML 에 소식이 하나도 없었다(네이버 Yeti·AI 봇은
//        JS 를 거의 실행하지 않는다). 이제 제목·본문·고유 주소(/story/news/<id>) 링크가 HTML 에 있다.
//   화면(아코디언)과 방문 시 최신화는 NewsBandList(클라이언트)가 맡는다.
//   환경변수가 없으면 빈 목록 → 섹션을 그리지 않는다(예전과 같다). 재생성 중 조회 실패는 마지막 정상본 유지.
export async function NewsBand() {
  const rows = await fetchLatestNews(MAX_ITEMS);
  return <NewsBandList initialRows={rows} maxItems={MAX_ITEMS} />;
}

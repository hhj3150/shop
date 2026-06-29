// 첫 배송 '의식(ritual)' 문구 — 첫 박스가 12주를 좌우한다. 첫 회차 발송 안내에만 덧붙여,
//   "왜 이 우유인지"를 브랜드필름 한 편으로 이어준다(첫인상 → 리텐션).
//   순수 함수(테스트 대상). 알림톡 채널로도 보내려면 별도 템플릿 등록이 필요하다(운영 단계).
import { BRAND_FILM_ID } from "./brand-film";

// 유튜브 watch 단축 링크(SMS 본문에 깔끔). buildFilmEmbedUrl 은 임베드용이라 여기선 별도.
export function filmWatchUrl(videoId: string = BRAND_FILM_ID): string {
  return `https://youtu.be/${videoId}`;
}

// 첫 배송 발송 안내(LMS)에 덧붙일 한 단락. 앞에 빈 줄을 둬 기존 본문과 분리한다.
export function firstDeliveryRitualNote(videoId: string = BRAND_FILM_ID): string {
  return (
    `\n\n첫 박스가 곧 도착해요. 왜 이 우유인지, 짧은 영상에 담았습니다.\n` +
    `송영신목장 이야기 → ${filmWatchUrl(videoId)}`
  );
}

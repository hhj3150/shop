// 브랜드 필름(유튜브) 임베드 URL을 만드는 순수 함수.
// 단일 영상 무한 반복은 loop=1 + playlist=<자기 자신>이 함께 있어야 동작한다.
// 개인정보 보호를 위해 youtube-nocookie 도메인을 사용한다.

export const BRAND_FILM_ID = "bI5EmgK0i2A";

export function buildFilmEmbedUrl(videoId: string): string {
  const params = new URLSearchParams({
    autoplay: "1",
    loop: "1",
    playlist: videoId,
    rel: "0",
    modestbranding: "1",
    playsinline: "1",
  });
  return `https://www.youtube-nocookie.com/embed/${videoId}?${params.toString()}`;
}

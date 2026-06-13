// 업계소식레이더 소스 — publisher 직접 RSS 피드(실링크 + 영문 텍스트).
//   ⚠ RSS(<item>/<link>) 전용. Atom(<entry>) 피드는 현재 parseRss 가 처리 못 하므로 추가 금지.
//   source = 매체명(피드가 <source> 태그 미제공 → 여기서 부여, 출처 표기에 사용).
export type RadarFeed = {
  url: string;
  label: string;
  source: string;
  priority: number;
  category: "human" | "pet";
};

export const RADAR_FEEDS: RadarFeed[] = [
  { url: "https://phys.org/rss-feed/biology-news/agriculture/", label: "농업·낙농", source: "Phys.org", priority: 2, category: "human" },
  { url: "https://www.sciencedaily.com/rss/plants_animals/agriculture_and_food.xml", label: "농식품", source: "ScienceDaily", priority: 3, category: "human" },
  { url: "https://www.sciencedaily.com/rss/health_medicine/nutrition.xml", label: "영양·건강", source: "ScienceDaily", priority: 5, category: "human" },
];

export function activeFeeds(petEnabled: boolean): RadarFeed[] {
  return petEnabled ? RADAR_FEEDS : RADAR_FEEDS.filter((f) => f.category !== "pet");
}

# 업계소식레이더 원문 번역·충실 요약 — 설계 (v2: publisher 직접 피드)

작성일: 2026-06-13

## 1. 배경·목표

업계소식레이더의 한글 요약이 **기사 제목만 보고** 생성된다. 영어를 잘 못 읽는 한국 소비자가 **원문 없이
내용을 이해**하게 하려면 실제 기사 내용을 읽고 충실히 요약해야 한다.

**실증 결과(차단 사유 — 소스 전환의 근거):**
- 현재 소스인 Google News RSS의 `<link>`는 **publisher URL이 아니라 `news.google.com/rss/articles/CBM…`
  리다이렉트**다(`news-radar.test.ts:21` 확인). 서버 HTTP 리다이렉트 추적(`curl -L`)으로는 JS 리다이렉트라
  publisher 에 도달 못 하고, **Jina(r.jina.ai)는 `news.google.com` 익명 접근을 차단**(451 SecurityCompromise).
  → 구글뉴스 링크로는 서버에서 본문을 못 가져온다.
- **publisher 직접 RSS는 실링크 + 영문 요약 텍스트를 제공**한다(실측: Phys.org 농업 피드 →
  `phys.org/news/…` 실링크 + `<description>`에 영문 요약 문단; ScienceDaily 영양·농식품 피드 → 실링크 + 요약).

**목표:** 소스를 **publisher 직접 RSS 피드**로 전환해 실제 기사 텍스트를 확보하고, 한국어 **한 문단
(4-7문장) 요약**으로 옮긴다. 자동 주간 실행과 관리자 수동 추가 **양쪽** 적용. 출처 표기+클릭 시 원문은
이미 분리(#89)되며, 이제 `source_url`이 실 기사 주소라 구글 리다이렉트 없이 바로 연결된다.

## 2. 현재 구조 (확인 완료)

- `lib/news-radar.ts`: `parseRss(xml,max)` → `RssItem{title,link,source,pubDate}`(본문 없음).
  `googleNewsRssUrl(q,days)`(구글뉴스 검색 URL). `RADAR_QUERIES`(레거시).
- `lib/news-radar-strategy.ts`: `RADAR_FIELDS`(테마 라벨·priority·category·queries), `FieldCandidate`
  (RssItem + field/fieldPriority/category), `buildScoringPrompt`, `parseScoredArray`, `mergeScored`
  (`source_url = src.link`), `rankCandidates`, `ScoredCandidate{title_ko,summary_ko,source_name,
  source_url,original_title,field,category,…}`.
- `lib/news-radar-run.ts`: `collectFieldCandidates()`(RADAR_FIELDS 쿼리→구글뉴스), `collectTermCandidates(term)`
  (구글뉴스 검색), `scoreCandidates()`(OpenAI 점수화→TOP-N), `runNewsRadar()`(TOP3→`news_radar_insert` RPC).
  maxDuration 30s(run 라우트).
- 수동: `news-radar-search` 라우트(term→collectTermCandidates→score, topN=8) → `NewsRadarAdminFeed`
  가 후보 표시 → `addDraft` 가 **클라 직접** `news_radar_insert_draft` RPC(점수화 요약 적재).
- **주간 자동 트리거:** `netlify/functions/news-radar.mts`(cron `0 0 * * 1`, 매주 월)가 `runNewsRadar` 직접 호출.
  → enrich 변경이 자동 반영. **단 Next 라우트가 아니라 Netlify 스케줄 함수**라 `maxDuration` 무관 — 함수 자체
  타임아웃 내에서 §4 deadline 이 성립해야 함.
- 표시: `NewsRadarBand`(공개, #89 출처·원문 링크 분리), `NewsRadarAdminFeed`(관리자).
- env: `OPENAI_API_KEY`/`OPENAI_MODEL`(gpt-5.4-mini), `NEWS_RADAR_SECRET`. 펫: `PET_CONTENT_ENABLED`.

## 3. 변경 설계

### 3.1 `lib/news-radar-feeds.ts` (신규) — 피드 레지스트리
```
export type RadarFeed = { url: string; label: string; source: string; priority: number; category: "human" | "pet" };
export const RADAR_FEEDS: RadarFeed[] = [ … ];
export function activeFeeds(petEnabled: boolean): RadarFeed[]; // pet 게이트
```
- 스타터(실측 동작 확인): Phys.org 농업(`https://phys.org/rss-feed/biology-news/agriculture/`, source="Phys.org"),
  ScienceDaily 영양(`https://www.sciencedaily.com/rss/health_medicine/nutrition.xml`)·농식품
  (`.../plants_animals/agriculture_and_food.xml`, source="ScienceDaily"). label 은 한글 표시 topic("과학·농업" 등).
  `source` = 매체명(피드가 `<source>` 태그를 안 주므로 **레지스트리에서 부여** — #89 출처 표기 보존, §3.3 참고).
  추후 낙농 특화 매체는 동작 확인 후 추가(설정만 바꾸면 됨). 펫 피드는 category='pet'(게이트).
- ⚠ **RSS 전용:** 스타터 3종 모두 RSS `<item>`/`<link>` 구조(파서 호환). Atom(`<entry>`/`<link href>`)
  피드는 현재 파서가 처리 못 하므로 레지스트리에 추가 금지(주석 명시).

### 3.2 `lib/news-radar.ts` `parseRss` 확장 — 본문 텍스트 캡처
- `RssItem` 에 `contentText: string` 추가: **`description` 이 실질 1차 소스**(실측: 스타터 3종 모두
  `content:encoded` 없음, `description` 만 180~570자). `content:encoded` 가 있으면 우선 채택(기회적·미래 피드 대비).
  HTML 태그·엔티티 제거(기존 `decodeEntities` + 태그 strip 헬퍼)로 평문화. 없으면 "".
- `link`/`title`/`source`/`pubDate` 기존대로. **하위호환:** 기존 호출부는 새 필드를 무시.

### 3.3 `lib/news-radar-run.ts` 수집 전환
- `collectFeedCandidates()` (신규, `collectFieldCandidates` 대체): `activeFeeds(PET_CONTENT_ENABLED)` 순회 →
  각 피드 fetch → `parseRss` → 최근 N일(기본 30) `pubDate` 필터 → `FieldCandidate`(field=feed.label,
  fieldPriority=feed.priority, category, **source=feed.source**(레지스트리에서 — 피드가 `<source>` 미제공),
  + `contentText`)로 매핑. 피드당 상한·전체 상한 유지(기존 PER_FIELD_MAX/TOTAL_MAX 재사용). 개별 피드 실패 무시(폴백).
  - **recency 가드:** `pubDate` 는 RFC-822(`Fri, 12 Jun 2026 … EDT`) — 런타임별 TZ 파싱 편차. `Date.parse`
    실패(NaN)·빈값이면 **항목을 떨어뜨리지 않고 포함**(폴백 우선 — 피드 통째 비는 것 방지). 파싱되면 N일 필터.
- `collectTermCandidates(term)` 재정의: **`collectFeedCandidates()` 수집 결과를 `term` 으로 필터**
  (title/contentText 부분일치, 대소문자 무시) — 구글뉴스 미사용. 실링크 유지 → 수동 추가도 강화 가능.
  ⚠ 수동 검색이 전체 웹이 아닌 **큐레이션 피드 범위**로 좁아짐(품질↑·커버리지↓ — 합의됨).
- **출처(source_name):** `mergeScored` 는 `r.source_name || src.source` 순. 피드는 `<source>` 가 없으므로
  `src.source` = **feed.source**(레지스트리)가 권위. 모델 추정 `source_name` 보다 **feed.source 우선**하도록
  `mergeScored`(또는 매핑부)에서 보정 → #89 출처 표기 무회귀.
- `FieldCandidate`/`ScoredCandidate` 에 `contentText` 전달: `mergeScored` 가 필드별로 객체를 구성하므로
  **`contentText: src.contentText` 한 줄을 명시 추가**(자동 보존 아님).

### 3.4 `lib/news-radar-fetch.ts` (신규) — Jina 보강(옵션)
```
export async function fetchArticleText(url, cfg?: {apiKey?; maxChars?; fetchImpl?; timeoutMs?}): Promise<string|null>
```
- `https://r.jina.ai/${url}` GET, `JINA_API_KEY` 있으면 Authorization. 타임아웃(기본 8s, AbortController),
  maxChars(기본 6000) 절단. 실패 시 null. **publisher URL 전용**(구글뉴스는 더 이상 소스 아님).
- 용도: RSS `contentText` 가 빈약할 때만 호출(아래 enrich).

### 3.5 `lib/news-radar-summary.ts` (신규·순수)
```
export function buildSummaryPrompt(englishText, meta:{originalTitle?;topic?}): string
export function parseSummary(content): {title_ko;summary_ko} | null
```
- 지시: "아래 영문 기사 내용을 자연스러운 한국어 **한 문단(4-7문장, ~300-500자)**으로 번역·요약. 독자가
  영어 원문을 읽지 않아도 핵심을 이해하도록 사실 위주. 과장·**효능/광고성 표현 금지**(식품표시광고법).
  JSON 으로만 `{\"title_ko\":\"…\",\"summary_ko\":\"…\"}`." 영문 텍스트·원제·토픽 포함.
- `parseSummary`: 코드펜스/잡텍스트 허용 JSON 추출, 빈/누락 → null.

### 3.6 강화 요약 단계 — `enrichSummary` (run.ts, 양쪽 공용)
```
export async function enrichSummary(item, cfg:{apiKey;model;jinaKey?;fetchImpl?}): Promise<{title_ko;summary_ko}>
```
- englishText = `item.contentText` 가 충분(>= MIN, **기본 120자** — 스타터 description 대부분 ≥200이라
  Jina 거의 미호출, 임계를 120으로 둬 ~180자도 재fetch 안 함)하면 그대로; 아니면 `fetchArticleText(item.source_url)`
  결과; 그래도 없으면 **입력 요약 폴백**(레이더 불멈춤).
- englishText 있으면 `buildSummaryPrompt`→OpenAI(타임아웃 포함)→`parseSummary`. 성공 시 교체, 실패 시 폴백.
  예외 전부 삼켜 폴백.
- `runNewsRadar`: `scored.ranked` TOP3를 **`Promise.all` 병렬 enrich**(아래 예산), `summary_ko`/`title_ko`만
  교체 후 기존 `news_radar_insert` 적재.

### 3.7 관리자 수동 추가 — 서버 라우트로 통일
- 신규 `app/api/admin/news-radar-add/route.ts`(`runtime=nodejs`): run 라우트와 **동일 관리자 인증** →
  body 로 후보(`contentText` 포함) 수신 → **중복 선검사 후**(낭비 방지) `enrichSummary` → 서버에서
  `news_radar_insert_draft` RPC 호출 → null(중복)/uuid 구분해 반환(기존 UX 유지).
  - 보안 주: `news_radar_insert_draft` 는 이미 `is_admin()` DB 게이트(권한은 그대로). 서버화의 목적은
    **서버 전용 키(OPENAI/JINA) 접근 + 일관 요약**이지 권한 강화가 아님(방어심층).
- `NewsRadarAdminFeed.addDraft`: 클라 직접 RPC → 이 라우트 POST 로 교체. 로딩/중복/실패 메시지 동일.

### 3.8 표시 — 변경 없음/경미
- `NewsRadarBand`: #89 완료. 길어진 한 문단 요약은 기존 `<p class="leading-relaxed">` 로 자연 렌더.

## 4. 시간 예산
- 경로 2개: ① Next 라우트(`news-radar-run`·신규 `news-radar-add`) — `maxDuration` 적용. ② Netlify 스케줄
  함수(`netlify/functions/news-radar.mts`) — `maxDuration` 무관, 함수 타임아웃 적용. **두 경로 공통 내부 안전장치**:
  TOP3 enrich 를 `Promise.all` 병렬 + **전체 deadline `Promise.race`(기본 18s)** → 초과분은 폴백(점수화 요약).
- enrich 는 RSS contentText 우선이라 대개 Jina 미호출(빠름). Jina 호출 시 8s 타임아웃, OpenAI 요약콜도 타임아웃.
- run 라우트 `maxDuration` 은 30s 유지(또는 여유 위해 상향). 스케줄 함수는 18s deadline 이 함수 캡 내에 들도록
  보장(구현 시 현재 함수 동작 시간 측정·확인).

## 5. 컴포넌트 경계
- `news-radar-feeds.ts`: 피드 목록(데이터). `news-radar.ts`: RSS 파싱(+contentText, 순수).
- `news-radar-fetch.ts`: Jina 보강(I/O, 주입형). `news-radar-summary.ts`: 프롬프트·파싱(순수).
- `news-radar-run.ts`: 수집·점수화·enrich·적재 오케스트레이션. add 라우트: 수동 서버화.
- 의존 단방향: 라우트/run → (feeds, news-radar, strategy, fetch, summary).

## 6. 엣지·안전
- **폴백 우선:** 피드 실패·contentText 빈약+Jina 실패·요약 파싱 실패 → 기존 점수화 요약 유지(무중단).
- **법규:** 요약 프롬프트 효능·광고 표현 금지(식품표시광고법). 밴드 면책 문구 유지.
- **보안:** `JINA_API_KEY`/`OPENAI_API_KEY` 서버 전용 env, 하드코딩 금지. 수동은 서버 라우트 관리자 인증.
- **중복:** add 라우트는 enrich 전에 중복 선검사(불필요한 fetch/요약 회피).
- **비용:** 주1회 자동(최대 3 enrich, 대개 Jina 미호출) + 수동 1건. 소량.

## 7. 정리(cleanup) / 비범위
**정리 — 소스 전환으로 미사용이 되는 것(surgical: 명시적으로 제거, 조용히 방치 금지):**
- `lib/news-radar.ts`: `googleNewsRssUrl`, `RADAR_QUERIES`, `buildRadarPrompt` — 수집에 더 안 쓰임 → 제거.
- `lib/news-radar-strategy.ts`: `RADAR_FIELDS.queries`(영문 쿼리 배열)는 미사용 → 제거. **단 `RADAR_FIELDS`
  자체(테마 라벨 목록)는 `buildScoringPrompt` 의 테마 관련성 컨텍스트로 유지**(수집은 RADAR_FEEDS, 점수화
  관련성은 RADAR_FIELDS 테마). `collectFieldCandidates` 는 `collectFeedCandidates` 로 대체(제거).
  → 제거 전 `grep` 로 잔여 참조 0 확인.

**비범위:**
- 5기준 점수화 로직·펫 게이트·표시(#89) 불변. DB 스키마·기존 RPC 시그니처 불변 → **SQL 마이그레이션 없음**.
- 낙농 특화 피드 추가 큐레이션은 후속(레지스트리에 URL 추가만).
- Google News 링크 디코딩(batchexecute)·전체 웹 검색 복원은 비범위(소스 전환으로 불필요).

## 8. 테스트
- `lib/news-radar.test.ts`: `parseRss` 가 `description` → `contentText` 평문 추출(실 피드 형태), `content:encoded`
  존재 시 우선(합성 fixture — 실 스타터엔 없음), 둘 다 없으면 ""; HTML 태그·CDATA strip; 기존 필드 회귀.
- `lib/news-radar-feeds.test.ts`: `activeFeeds` 펫 게이트(human만/포함).
- `lib/news-radar-fetch.test.ts`: r.jina.ai URL·Authorization(key 시)·maxChars 절단·비200/예외/빈→null(주입 fetch).
- `lib/news-radar-summary.test.ts`: 프롬프트가 영문 텍스트·"한 문단/4-7문장"·"효능·광고 금지"·JSON 포함;
  `parseSummary` 정상/코드펜스/빈→null.
- `lib/news-radar-run.test.ts`: `collectTermCandidates` term 필터(부분일치·대소문자); `enrichSummary` —
  contentText 충분→Jina 미호출 교체, 빈약→Jina, 전부 실패→폴백(주입 fetchImpl 결정적).
- 라우트/컴포넌트: 타입체크+빌드+수동검증(인증은 기존 패턴 재사용).

## 9. 리스크·완화
- **피드 가용성/형식 편차:** 폴백 무중단 + 피드별 실패 격리. 스타터는 실측 동작 확인분.
- **요약 환각:** 실제 기사 텍스트 기반 + 사실 위주 지시 + 출처 명시(제목만 보던 기존보다 충실).
- **수동 커버리지 축소:** 합의된 트레이드오프(품질 우선). 필요 시 피드 추가로 확장.
- **30s 초과:** contentText 우선(빠름)+타임아웃+deadline+폴백.

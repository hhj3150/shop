# 소식 레이더 — 검색·점수화·선별 게시 설계

> 작성일 2026-06-06 · 상태: 설계 승인됨(방식: 병렬 8분야 → 점수화 → TOP3)
> 기존 승인제(관리자 게시한 글만 노출) 위에 "검색·선별" 기능을 얹는다.

## 목표
1. 매주(및 수동) **8개 분야 병렬 검색** → **선정 7기준 점수화** → **TOP3**를 '대기'로 적재.
2. 관리자 패널에 **검색창** — 자유 검색어 입력(또는 빈칸=전략 자동) → 후보 점수화 반환 → 관리자가 **선택해 '대기 추가'** → 기존 게시/삭제 흐름.
3. 자동 게시 없음(관리자 승인 유지).

## 8개 병렬 검색 분야
① A2 Milk ② Jersey Milk ③ Hay Milk ④ Yogurt & Fermentation
⑤ Gut Health & Microbiome ⑥ Animal Welfare & Sustainability
⑦ Premium Food Trends ⑧ Pet Health & Human Grade Pet Food

각 분야는 영문 검색쿼리 세트로 매핑(우선순위 전략 1~9를 8분야에 분배). 최근 30일(when:30d).

## 점수화 (100점 만점 루브릭)
각 후보를 OpenAI가 아래 5개 기준 **각 20점**으로 채점, **합산 100점**으로 정렬해 TOP3:
- 최신성 (20)
- 검색량/관심도 (20)
- 송영신목장 연관성 (20)
- 판매 전환 가능성 (20)
- 스토리텔링 가능성 (20)

동점 시 분야 우선순위(①>②>…>⑧, 전략 1~9 순위)로 가름.
점수와 함께 기준별 점수·선정 사유를 JSON으로 받아 관리자에게 노출(투명성).
※ 과학적 근거·프리미엄 가치 등은 '연관성/스토리텔링' 채점과 출처 우선 규칙에 반영.

## 제외·출처 규칙
- 제외: 광고성 기사·보도자료(PR)·협찬 콘텐츠.
- 우선 출처: 논문·공공기관·대학 연구·전문 언론.
- ※ MVP 소스 = Google News RSS(뉴스·전문언론). 논문 자체 검색(Crossref·PubMed 무료 API)은 후속 확장.

## 구현
- `lib/news-radar.ts`(또는 신설 `lib/news-radar-strategy.ts`): 8분야 쿼리맵 + 점수화 프롬프트(7기준·제외·출처). 순수부는 TDD.
- `lib/news-radar-run.ts`: 후보 수집을 8분야로 확장, OpenAI에 **TOP3 + 점수 + 사유** JSON 요청, 3건 insert(중복 source_url 무시). 주간 스케줄/수동실행 공용.
- 신규 `/api/admin/news-radar-search`(is_admin): 검색어(옵션) → 후보 점수화 → **여러 후보 반환(insert 안 함)**.
- `components/NewsRadarAdminFeed.tsx`: 검색창 + [검색], 결과 후보 카드(점수·사유 표시) + [대기 추가](선택 insert). 기존 게시/숨김/삭제 유지.
- 신규 RPC `news_radar_insert_draft`(is_admin, published=false) — 관리자 선택 후보 적재용(기존 secret-gate insert와 별개, 관리자 게이트).

## 펫 콘텐츠 게이트 (피처 플래그) — 2026-06-06 추가
사람용 프리미엄 유제품몰이라 펫 콘텐츠가 고객 화면에 섞이면 초점이 분산된다. 펫 상품 라인이 아직 없으므로 게이트로 막는다.
- 신설 `lib/news-radar-flags.ts`의 `PET_CONTENT_ENABLED`(기본 `false`).
- **false(기본)**:
  - 주간 자동 수집·점수화는 **사람 유제품 7개 분야만**(⑧ Pet Health & Human Grade Pet Food 제외).
  - 공개 밴드(`NewsRadarBand`)에 **펫 카테고리 절대 미노출**.
  - 단, **관리자 검색창에서는 펫 주제 수동 검색 허용**(온디맨드). 펫 후보는 `category='pet'` 로 태깅.
- **true(펫 라인 출시 시)**: ⑧ 분야 자동 수집 포함 + 공개 밴드 노출.
- ⑧ 분야 전략 코드(`RADAR_FIELDS`)는 **그대로 유지**하고 게이트만 적용 — `activeRadarFields(flag)`(off=7분야, on=8분야).
- DB: `news_radar.category text not null default 'human'`. secret/draft insert RPC 가 `category` 적재(기본 'human'). 공개 밴드는 flag off 일 때 `category='pet'` 제외.
- 분야 메타에 `category: 'human' | 'pet'` 추가, 점수 결과(`ScoredCandidate`)에도 `category` 전파. 관리자 자유검색 후보는 OpenAI 가 'pet'/'human' 분류.

## 큐레이션 콘텐츠 면책·효능 표현 안전(식품표시광고법) — 2026-06-06 추가
외부 연구·보도를 인용하므로 질병 예방·치료 효능을 단정하지 않도록 안전장치를 둔다.
- 공개 밴드에 **면책 한 줄** 노출: `※ 외부 연구·언론 보도를 인용한 정보이며, 특정 질병의 예방·치료 효능을 단정하지 않습니다.`
- 출처(언론사명 + 원문 링크)는 계속 표기.
- AI 선정 프롬프트에 규칙 추가: **제품과 결부된 질병 예방·치료 효능을 단정하는 콘텐츠는 선정 금지**(`exclude=true`).

## 검증
- 8분야 쿼리맵·점수 정렬·중복제거 등 순수 로직 vitest TDD.
- 펫 게이트(`activeRadarFields`)·`category` 병합·프롬프트 규칙 단위 테스트.
- 프롬프트 JSON 파싱·후보 N개 처리 단위 테스트.
- tsc + vitest green. 마이그레이션(있으면) 수동 적용. 커밋 전 사용자 승인.

## 비고
- 기존 주간 자동(1건)→TOP3로 변경되나 '대기' 적재라 공개 영향 없음(관리자 승인 후 노출).
- OpenAI 토큰↑(8분야×후보) — 모델·후보수 상한으로 비용 관리.
- PUBLIC repo 시크릿 금지. 관리자=public.is_admin(). 환경변수 OPENAI_API_KEY·NEWS_RADAR_SECRET 기존 재사용.

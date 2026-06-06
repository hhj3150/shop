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

## 점수화(선정 7기준)
각 후보를 OpenAI가 0~5로 채점, 가중합으로 정렬해 TOP3:
1. 송영신목장 A2 Jersey Hay Milk와 직접 연결
2. 플레인 요거트 판매와 연결
3. 소비자가 쉽게 이해
4. 과학적 근거 존재
5. 브랜드 프리미엄 가치 향상
6. 검색량·관심도 높음
7. 구매 전환 가능성
+ 분야 우선순위 가중(①>②>…>⑧, 전략의 1~9 순위 반영).

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

## 검증
- 8분야 쿼리맵·점수 정렬·중복제거 등 순수 로직 vitest TDD.
- 프롬프트 JSON 파싱·후보 N개 처리 단위 테스트.
- tsc + vitest green. 마이그레이션(있으면) 수동 적용. 커밋 전 사용자 승인.

## 비고
- 기존 주간 자동(1건)→TOP3로 변경되나 '대기' 적재라 공개 영향 없음(관리자 승인 후 노출).
- OpenAI 토큰↑(8분야×후보) — 모델·후보수 상한으로 비용 관리.
- PUBLIC repo 시크릿 금지. 관리자=public.is_admin(). 환경변수 OPENAI_API_KEY·NEWS_RADAR_SECRET 기존 재사용.

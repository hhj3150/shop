# 업계 소식 레이더 — 관리자 승인제(모더레이션) 설계

> 작성일 2026-06-06 · 상태: 구현 완료(마이그레이션 수동 적용 대기)

## 목표

업계 소식 레이더가 수집한 글을 **자동으로 메인에 노출하지 않는다.** 관리자가 검토해
**게시(승인)한 글만 고객에게 노출**되고, 불필요한 글은 **삭제**할 수 있다.

## 기존 동작(변경 전)

- 수집(주간 자동 `netlify/functions/news-radar.mts` + 관리자 '지금 한 번 수집') → `news_radar` insert
- 공개 밴드(`NewsRadarBand`)가 `news_radar` 테이블 전체(최신 3개)를 **자동 노출**
- 관리자 피드(`NewsRadarAdminFeed`)는 읽기전용 이력 + 수집 버튼뿐
- RLS: `select using (true)` — 모든 행 공개

## 변경 설계 (접근 A — boolean 플래그)

`status` enum 대신 `published` boolean 단일 플래그(YAGNI). 요구는 게시/숨김 2상태 + 삭제뿐.

### 1. DB (`supabase/migration-news-radar-moderation.sql`)
- `news_radar.published boolean not null default false` 추가
  → **기존 수집글은 모두 '대기(비공개)'로 전환**(관리자가 다시 승인해야 노출)
- RLS 교체:
  - 공개: `news_radar_select_published` → `using (published)`
  - 관리자: `news_radar_select_admin` → `using (public.is_admin())`
  - (Postgres 다중 permissive 정책 = OR → 고객은 게시본만, 관리자는 전부)
- RPC(둘 다 `security definer` + 내부 `if not public.is_admin() then raise`):
  - `news_radar_set_published(p_id uuid, p_published boolean)` — 게시/숨김 토글
  - `news_radar_delete(p_id uuid)` — 삭제
  - `grant execute ... to authenticated`

### 2. 공개 밴드 (`components/NewsRadarBand.tsx`)
- 쿼리에 `.eq("published", true)` 명시(RLS와 이중 방어). 게시본 0건이면 기존처럼 섹션 미표시.

### 3. 관리자 피드 (`components/NewsRadarAdminFeed.tsx`)
- `published` 컬럼 조회 + 항목별 상태 뱃지(🟢게시중 / ⚪대기)
- 항목별 [메인에 게시]/[숨기기] 토글 + [삭제](확인창) 버튼
- RPC 호출 후 상태 즉시 갱신(불변 업데이트). `busyId`로 처리 중 중복 클릭 방지.

### 4. 스케줄러
- 변경 없음 — 계속 수집되어 '대기' 상태로 쌓인다.

## 비고

- **마이그레이션 수동 적용**: Supabase SQL Editor에서 실행해야 한다(Netlify는 SQL 실행 안 함).
  코드 배포 전 적용 권장(미적용 시 공개 밴드는 graceful하게 빈 섹션, 관리자 토글/삭제는 실패).
- `lib/regions.ts` 같은 코드↔SQL 이중출처 동기화 이슈 없음(이 기능은 DB 단일 출처).
- 검증: tsc PASS · vitest 150/150 PASS. 컴포넌트 테스트 인프라 없음 → 라이브 눈 확인 필요.

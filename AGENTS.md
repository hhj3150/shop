<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# DB 함수는 저장소가 아니라 운영 DB 가 기준이다

`supabase/*.sql` 은 **적용 이력**이지 현재 정의가 아니다. 한 함수가 여러 마이그레이션에서
`create or replace` 되므로, `grep` 으로 먼저 걸린 정의가 지금 돌아가는 정의라는 보장이 없다
(현재 함수 37종이 여러 파일에 중복 정의돼 있다).

DB 함수의 동작을 판단하거나 "버그가 있다"고 결론짓기 전에 **반드시 운영 DB 에서 직접 읽는다.**

```sql
select pg_get_functiondef('public.cancel_skip(bigint)'::regprocedure);
```

이 규칙을 어겨 실제 손해가 날 뻔했다. 2026-09-24 외부 점검이 옛 파일을 읽고 여러 함수를
"UTC 버그"로 지목했는데, 운영 DB 는 이미 대부분 KST 였다. 지적을 그대로 받았다면 멀쩡한
함수를 옛 버전으로 되돌렸을 것이다. 자세한 내용과 함정 목록은 `supabase/README.md` 를 본다.

**테이블 컬럼도 똑같다.** 함수 정의는 운영 DB 에서 읽어 놓고 거기 나오는 테이블의 컬럼명은
짐작으로 쓰는 일이 실제로 있었다. 2026-10-19 회차 확정 버튼이 통째로 먹통이었는데
(`column "kind" of relation "order_events" does not exist`), 사장님이 99명 중 한 명도 확정하지
못한 채 며칠을 보냈다. 컬럼은 쓰기 전에 본다.

```sql
select column_name, data_type, is_nullable
  from information_schema.columns
 where table_schema='public' and table_name='order_events' order by ordinal_position;
```

그리고 **INSERT·UPDATE 를 새로 쓴 함수는 올리기 전에 운영 DB 에서 한 번 굴려 본다.**
롤백되는 블록이면 흔적이 남지 않는다 — 이 한 번이면 위 사고는 없었다.

```sql
do $$ declare v jsonb; begin
  perform set_config('request.jwt.claims', '{"sub":"<uuid>","role":"authenticated"}', true);
  v := public.내함수(...);
  raise exception 'TEST_OK %', v;   -- 예외로 전부 롤백된다
end $$;
```

# 이미지·영상 편집은 Higgsfield 로 한다

사진·그림·동영상을 편집할 일이 생기면 **언제나 Higgsfield MCP 를 먼저 쓴다.**
직접 sharp 로 마스크를 깎거나 색을 맞추는 건 마지막 수단이다.

| 할 일 | 도구 |
|---|---|
| 배경 제거·누끼 | `remove_background` (image/video 공용) |
| 해상도 올리기 | `upscale_image` (2k/4k) |
| 화면 밖으로 확장 | `outpaint_image` |
| 비율 바꾸기 | `reframe` |
| 새 이미지·영상 | `generate_image` / `generate_video` |

로컬 파일을 넣는 순서: `media_upload`(presigned URL 받기) → `curl -X PUT` 로 바이트 업로드
→ `media_confirm` → 그 `media_id` 로 편집 도구 호출 → `jobs_wait` → 결과 URL 내려받기.

**단, 글씨가 있는 사진(라벨·안내판·간판)은 AI 업스케일을 쓰지 않는다.** 2026-11-13 백화점 진열 사진을
`upscale_image` 로 키웠더니 'A2저지 헤이밀크' 라벨과 안내판 영문이 뜻 없는 글자·좌우 반전 글씨로 바뀌었다
(제품 라벨이 깨져 보이면 가짜처럼 보인다). 그런 사진은 원본을 Lanczos 로 2배까지만 키우거나 고해상도 원본을 받는다.

2026-09-25 제품 사진 누끼를 손으로 깎다가, 병 밑동이 흰 테이블 위에서 255 로 날아가
윤곽이 데이터에 아예 없다는 걸 뒤늦게 알았다. Higgsfield 배경제거는 그 구간을 학습된
사전지식으로 메운다 — 규칙 기반 세그멘테이션으로는 복구할 수 없는 부분이다.

# 제품 사진의 라벨 글자는 올리기 전에 한 글자씩 읽는다

제품 병 사진(렌더·AI 가공본 포함)은 **라벨 글자가 실제와 같은지 확대해서 읽은 뒤에만** 올린다.
정답은 넷뿐이다 — 로고 `송영신목장 / Made by Soil`(원본: `public/brand/logo-label.png`),
띠 `송영신목장 A2 JERSEY HAY MILK|PLAIN YOGURT`, 하단 상자 `경기도 퀸스저지 와 함께 합니다.`,
열량은 `lib/products.ts` 값.

2026-11-16 회장님이 직접 발견했다. 9월부터 쓰던 병 사진과 홈 단체 사진이 AI 가 만든 그림이라
라벨이 `송영선목장`, `경기도 레스저자/쿼소저자/최소지지`, `경기도 파주시에서 사용된 원유로…`,
`A2 저저`, `Made by Soul` 로 찍혀 있었다. 작은 화면에서는 안 읽혀 넘어갔다가, #240 에서 병을
크게 진열하자 그대로 드러났다. 지어낸 원산지 문구(파주시)는 표시광고 문제이기도 하다.

고칠 때는 AI 로 글자를 다시 그리지 않는다(또 틀린다). 벡터 로고를 얹고 글자는 글꼴로 조판한다.
같은 날 회장님이 실제 병을 찍은 사진 넷을 보내 주셔서, **제품별 사진**(상세 사진·진열 누끼·공유 카드용
PNG)을 전부 실물 사진으로 바꿨다(원본: `assets/product-photos/`). 앞으로 병 사진은 이 실물 컷에서 만든다.

- 누끼는 Higgsfield `remove_background` 의 알파만 쓰고 색은 원본 픽셀 그대로 둔다(라벨이 한 픽셀도
  안 바뀐다 — 불투명 영역 차이 0 을 확인했다). 처음 다섯 번은 failed 였고 몇 분 뒤 다시 하니 됐다.
- 병에 찍힌 소비기한 도장(2026.10.01 / 10.10)은 지웠다 — 지난 날짜가 상품 사진에 보이면 안 된다.
- 색은 전체에 같은 보정만 건다(밝기 살짝, 조명의 누런 녹색기 완화). 부분 보정·AI 재생성·업스케일 금지.
- 홈 단체 사진(`hero-row-white.webp`)과 대표 공유 이미지는 회장님 지시로 그대로 뒀다(글자만 교정한 렌더).
- 2026-11-18 옆·뒷면 실물 사진 8장을 받아 상세 갤러리(정면·옆면·뒷면·표시사항·영양정보)를 만들었다
  (원본: `assets/product-photos/sides/`). 병 컷은 위와 같은 방식(알파만 + 전체 동일 보정), 표시사항·영양정보
  컷은 원본을 자르고 90° 돌리기만 했다. 같은 날 색을 정면 컷에 맞췄다 — 정면 병의 평균색 ÷ 옆·뒷면 병의
  평균색을 채널별 배율로 전체에 곱한다(덧셈 보정은 검은 뚜껑을 갈색으로 띄운다). AI 업스케일·재생성은 쓰지 않았다.
  갤러리의 모든 컷은 정면과 같은 1000×1000 크림 바탕이다 — 라벨 확대 컷도 알파로 배경을 걷고 가운데 840px 상자에
  맞춰 놓으며, 자른 직선 경계는 60px 페이드로 바탕에 녹인다. 라벨 확대 컷에는 `cut` 을 걸지 않는다 — `.product-cut` 마스크가 글자 끝을 지운다.

`public/detail/*.jpg` 는 쓰이지 않는 옛 상세 이미지이며 같은 종류의 오류가 남아 있으니 되살리지 않는다.

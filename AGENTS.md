<!-- BEGIN:nextjs-agent-rules -->
# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` before writing any code. Heed deprecation notices.
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

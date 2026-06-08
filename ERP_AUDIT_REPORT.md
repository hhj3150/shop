# ERP_AUDIT_REPORT — 송영신목장 구독커머스 ERP

> 목적: 라이브 운영 ERP를 **개선(optimization)** 하기 전, 현 시스템을 전수 감사한다.
> 원칙: **Audit first. Preserve everything. Do not break the live business.**
> 방법: 읽기 전용 5축 병렬 감사(관리자 UI·고객/라우트·DB·비즈로직·자동화) + 검증.
> 작성일: 2026-06-08. 기준 브랜치: `main`.

---

## 0. 한 줄 결론

**이 시스템은 "전형적 온라인 스토어"가 아니라 이미 상당히 완성된 구독커머스 ERP다.** 브리프의 9개 Phase 중 다수가 **이미 존재(EXISTS)** 하거나 **부분 존재(PARTIAL)**한다. 진짜 가치는 *재건축*이 아니라 **(a) 빈틈 채우기, (b) 흩어진 기능 통합, (c) 데이터 모델의 확장성 보강**이다.

---

## 1. 시스템 개요 (아키텍처)

- **스택**: Next.js(App Router) + TypeScript + Supabase(PostgreSQL, RLS, SECURITY DEFINER RPC) + Netlify(배포 + 스케줄 함수). PWA(manifest) — 웹/앱 단일 코드베이스.
- **보안 모델**: 모든 돈·재고·구독 쓰기는 클라 직접 INSERT 금지, **SECURITY DEFINER RPC로만**. RLS = 본인 행 + `is_admin()` 전체. 결제 확정 등은 Vault 시크릿으로 게이트.
- **결제**: PayAction(무통장 자동매칭 웹훅) + PortOne v2(카드/정기 빌링키). 둘 다 서버 재검증 + 멱등.
- **메시징**: Solapi(알림톡 우선 → LMS 폴백). 트랜잭션 SMS 10종 + 관리자 대량발송(광고법 준수).
- **스케줄러**: **Netlify Scheduled Functions 3개 라이브** — 결제독촉, 연장리마인더, 뉴스레이더.

### 1.1 확장성(스케일) 평가
- 좌석 정원 `SUB_DAY_CAP=100`/요일, `SUB_TOTAL_CAP=500` 은 **하드코딩 상수**(lib/products.ts). 5,000~50,000 구독 시 이 상수·요일 모델 재검토 필요.
- 제품 카테고리는 **DB 컬럼이 아니라 TS 유니언**(`"milk"|"yogurt"`) — 신규 카테고리 추가는 코드 변경.
- 그 외(주문·구독·결제·배송·정산)는 RPC 기반이라 데이터량 증가에 구조적 문제 없음.

---

## 2. 전체 기능 인벤토리 (이미 존재하는 것)

### 2.1 관리자 (`/admin`, 6탭 단일 페이지 + 독립 2페이지)
- **종합 관리**: 개요 스탯, **데이터 정합 이상감지**(입금근거 없는 입금확인·품목0 주문, 딥링크), **회원 CRM 표**(LTV·확정주문·AOV·주문수·활성구독·최근성·세그먼트, CSV), **회원 상세 모달**(주문이력+요약배지+프로필편집), 요일별 모집현황, 요일별 필요수량, 주간 생산·배송 계획, 기간별 배송명단(CSV), 대기자, 해지·환불(CSV), **대량 SMS**(광고법 준수), 주문관리(상태·송장·현금영수증·**PayAction 재등록**·드릴다운·**구독 시작일 연기**·배송지수정), **AdminStats**, **FunnelDashboard**, **ReferralAdminPanel**, **AdminAssistant(AI)**.
- **생산·재고**: ProductionPanel(원유 입고·생산계획/실적·온라인+B2B 수요·우유수지·로스), B2bDemandSection.
- **상품·재고**: ProductAdminPanel(가격·원가·재고·활성·마진), InventoryPanel(재고원장·**안전재고 부족경보**·**유통기한 임박/만료 경보**·입출고 이력).
- **배송**: DispatchPanel(큐·필터·정렬·검색·버킷수량·일괄발송·**출고확정(재고차감)**·미분류 가드, CSV).
- **환불·교환**: ReturnsPanel(접수→승인→완료→반려 워크플로, `order_returns`).
- **정산·세금**: SettlementPanel(과세/면세·공급가/부가세·마진·제품별, KST 월 버킷, CSV).
- **독립 페이지**: `/admin/news`(목장소식 CRUD), `/admin/news-radar`(업계소식 레이더).
- **CSV 5종**: 회원분석·기간배송명단·해지환불·발송명단·정산. **PDF**: 브라우저 인쇄(@media print)만.

### 2.2 고객 / 라우트
- 홈(라이브 카탈로그·잔여좌석·소식), 상품상세(SSG·SEO), 구독 체크아웃(1/2/3개월 선납), 단품구매(회원/**게스트**), 주문완료, **마이페이지**(구독 일시정지/재개/해지/연장·주문이력·프로필·추천·받는분), 빌링카드, 인증(로그인/가입/비번재설정).
- **API 라우트**: `/api/notify`(서버권위 SMS 10종), `/api/payaction/{register,webhook}`, `/api/payments/webhook`(PortOne), `/api/billing/register`, `/api/broadcast`(관리자 대량), `/api/assistant{,/order,/stt,/tts}`, `/api/admin/{assistant,news-radar-run,news-radar-search}`.

### 2.3 데이터 모델 (Supabase)
- **핵심 엔티티**: profiles, orders(+order_items), subscription_slots, product_catalog, billing_keys/recurring_subscriptions/billing_charges, payaction_webhook_events, order_reminders, referrals/referral_rewards, order_returns, news/news_radar, stock_movements/shipment_log, production_logs/milk_intakes, clients/b2b_demand, funnel_events, recipients, assistant_rate_limit.
- **구독 상태**: orders.status(입금대기/입금확인/배송준비/배송중/배송완료/취소) + subscription_slots.status(신청/활성/대기/해지) + 파생(일시정지=paused 컬럼, 회차소진=computeSchedule 계산, 연장=renews_slot_id+extended_weeks). **"블록" 모델**(orders.block_weeks)이 이미 코어에 존재.
- **트리거**: 관리자 권한 보호, 추천 보상 자동 적립(친구 첫 구독 입금확인 시 쌍방 5,000원).

### 2.4 비즈니스 로직 라이브러리 (대부분 단위테스트 보유)
subscription-schedule → dispatch-schedule → delivery-roster → production-demand (스케줄·로스터·수요 SSOT 체인, 해지/회차소진/정지/시작전 제외 일관), revenue(순매출), cash-receipt-tax(부가세), returns, referral, products(가격·정원·할인 정책), regions(특수지역 배송비), ship-date, **kst**(UTC→KST), inventory(안전재고·유통기한), dispatch-csv/settlement-csv/dispatch-buckets, production, renewal-retention/payment-recovery(리마인더 로직), admin-assistant/queries(AI용 순수 집계).

### 2.5 자동화 / 연동 (이미 라이브 — **중복 구현 금지**)
- **결제확정**: PayAction 웹훅(자체 SMS) + PortOne 웹훅(payment_confirmed SMS, 멱등).
- **스케줄 함수(Netlify, 라이브)**: ① `payment-recovery`(매일, 미입금 D1/D2 독촉 + D3 자동만료) ② `renewal-retention`(매일, 만료 D7/D3 연장 넛지) ③ `news-radar`(주1회 업계소식 수집).
- **트랜잭션 SMS 10종**: welcome/order_received/gift/payment_confirmed/shipped/delivered/subscription_cancelled/renewal_guide/renewal_confirmed.
- **대량 SMS**(광고법: 야간차단·(광고)·수신거부), **추천 보상 트리거**, **펀널 추적**, **AI 비서**.
- **외부 연동**: Supabase / Solapi(알림톡·LMS) / PayAction / PortOne / OpenAI / Daum우편번호 / YouTube / Google News RSS.

---

## 3. 9-Phase 갭 매트릭스

| Phase | 상태 | 근거 / 빈틈 |
|---|---|---|
| **P1 Customer 360** | 🟡 PARTIAL | 데이터 전부 존재(profiles·orders·slots·rewards·returns·billing). MemberOrdersModal=주문이력+LTV/AOV/세그먼트 배지+프로필편집. **빈틈**: 모달에 구독 슬롯 상세(회차/요일/정지/시작일) 없음, 배송/송장 이력 미노출, **고객 메모/CS노트 필드가 어디에도 없음**(profiles에 컬럼 없음) — P1·CRM 최대 enabler 갭. |
| **P2 VIP/CRM** | 🟡 PARTIAL→MISSING | 세그먼트가 **금액이 아니라 최근성** 기준(구독중/활성/주의/휴면/신규). 브리프의 **금액 등급(VIP ₩1M+/Gold ₩500K+/Regular/Dormant 60d+)** 없음, 등급 필드(DB) 없음, 등급 필터·정렬(최근주문/구독기간) 없음(현재 LTV내림차순+이름/폰/주소 검색만). 휴면 기준 상이(90d vs 60d). LTV 원천 데이터는 있음(앱단 계산). |
| **P3 위험감지** | 🟡 PARTIAL | 결제 데이터 강함(billing_charges 상태/시도/실패코드, order_reminders), 주문·배송 상태, 이상감지, 재고/유통기한 경보. **빈틈**: 결제실패를 위험으로 표면화 안 함, **배송실패 상태 없음**(배송완료만), 구독 만료임박 경보 없음, 불만(complaint) 집계 없음, **통합 알림센터·고객행 경고배지 없음**. |
| **P4 생산 커맨드센터** | 🟢 STRONG / 🟡 일부 | 일/주 생산시트(ProductionPanel·WeeklyPlanTable·정기·단품 split)·우유수지 존재. **빈틈**: 월간 예측 없음, **안전재고가 필요생산량에 미반영**, **생산시트 전용 CSV/PDF 없음**. |
| **P5 배송 커맨드센터** | 🟢 STRONG / 🟡 일부 | 날짜별 로스터·발송명단 CSV·특수지역·shipment_log 존재. **빈틈**: **지역(권역) 그룹핑 없음**, 오늘/내일/지연/대기/실패 버킷 없음, **배송실패 모델 없음**. |
| **P6 경영 대시보드** | 🟡 PARTIAL | AdminStats: 순매출·회원수·활성구독·AOV·입금전환율·구독유지율·해지·재구매율 + 차트(점유율=가동률·제품믹스·요일/주차 매출) + FunnelDashboard. **빈틈**: **MRR 없음**, 신규고객 지표 없음, 해지율(%) 없음(해지 수만), **배송성공률**(데이터 부재로 불가), **결제성공률**(집계 없음), 대시보드 LTV KPI 없음. |
| **P7 글로벌 검색** | 🔴 MISSING | 탭별 개별검색만(주문·회원·배송·환불). **전 엔티티 통합 인스턴트 검색·딥링크 없음**, 구독 ID 검색 없음. |
| **P8 자동화** | 🟢 STRONG | 트랜잭션 SMS·웹훅·대량발송·**스케줄 함수 3개 라이브**·추천 트리거 모두 존재. **빈틈(신규)**: 배송 전 "내일 도착" 사전 리마인더, **VIP 인지 자동화**, **이탈(해지/만료) 고객 윈백**(현 리마인더는 만료임박 활성 슬롯만 대상). |
| **P9 제품 확장** | 🟡 PARTIAL | 2계층(하드코딩 lib/products 편집 + DB product_catalog 상거래). 기존 종류의 **신규 SKU는 행 추가로 가능**. **빈틈**: **카테고리/라인이 DB 컬럼이 아님**(TS 유니언), 구독 경제(주1회·정원·할인)가 우유형으로 하드코딩 → **새 카테고리/다른 형태 구독은 재설계 필요**. |

---

## 4. 교차 리스크(개선 전 인지 필요)

1. **SQL 드리프트(수기 적용 관행)**: 동일 RPC가 여러 마이그레이션에 `create or replace`로 중복 정의(예: `stock_adjust`·`cancel_subscription`·`create_subscription_order`). 마지막 적용본이 prod에 반영 → 파일만으로 적용상태 확정 불가. **prod 스키마 검증 1회 권장**.
2. **로스터/수요 이중 구현**: `lib/delivery-roster`+`production-demand`(슬롯 스케줄 기반) vs `lib/admin-assistant/queries`(문자열키 기반) — 규칙 변경 시 갈라질 위험.
3. **고객 메모 필드 부재**: P1·P2(CRM)의 최대 enabler 갭.
4. **결제실패·배송실패 상태 부재**: P3 위험감지 + P6 성공률 KPI를 **데이터 차원에서** 막음.
5. **제품 카테고리 DB 모델 부재**: P9 확장의 구조적 병목.
6. **진행 중 브랜치**(`feat/renewal-modify-composition`): 연장 시 구성·요일·회차 변경("블록" 모델) — 별도 진행 중, main과 파일 충돌 없음(확인 완료). 머지 전 정합 검증 필요.

---

## 5. 권고 구현 순서 (보존 우선·저위험 우선)

> 전부 **승인 후 Phase별 1 PR + 미리보기 + 검증**. DB 변경은 SQL 파일만 작성(사장님 수기 적용).

**A. 즉시·저위험·고가치 (앱단 추가, 동작 변경 없음)**
- **P1 보강**: `profiles.admin_memo`(고객 CS 메모) 컬럼 + 회원 모달에 메모/구독 슬롯 상세 표시 → Customer 360 완성.
- **P2**: 기존 LTV로 **금액 등급(VIP/Gold/Regular/Dormant)** 자동 분류 + 등급 필터·정렬. (기존 최근성 세그먼트와 공존)
- **P3**: 흩어진 기존 신호를 모은 **통합 알림센터**("오늘 챙길 것") — 데이터 추가 없이 집계만.
- **P7**: 기존 데이터 위 **글로벌 검색**(고객/폰/주문#/주소/제품/구독ID → 딥링크).

**B. 대시보드 지표 (기존 데이터로 계산)**
- **P6**: MRR·해지율·신규고객·결제성공률(billing_charges 기반) KPI 추가. *배송성공률은 C 이후.*

**C. 운영 강화 (일부 DB·신중)**
- **P4/P5**: 배송 로스터 **권역 그룹핑**, 생산시트 CSV, (선택) 월간 예측·안전재고 반영.
- **P3/P5/P6 데이터 보강**: **배송실패 상태** 도입(스키마) → 배송성공률·실패 버킷 가능.

**D. 구조 확장 (큰 변경·별도 설계)**
- **P9**: 제품 **카테고리/라인 DB 모델** 도입(후속 제품군: 애프터밀크·힐링퇴비·기프트셋·체험·카페·시즌).
- **P8 보강**: 배송 전 사전 리마인더, VIP 인지, 이탈 윈백 — 단 **기존 SMS/스케줄러/리마인더 인프라 재사용**(중복 금지).

---

## 6. 절대 중복 구현 금지 목록 (이미 존재)
Solapi 발송 레이어(알림톡+LMS 폴백)·`/api/notify` 서버권위 패턴·트랜잭션 SMS 10종·PayAction/PortOne 웹훅·대량발송 광고법 가드·결제독촉/연장 스케줄 함수·추천 보상 트리거·펀널 추적·재고/유통기한 경보·정산 부가세 로직·로스터/수요 SSOT 체인.

---

*감사 끝. 구현은 본 보고서 §5 순서대로, 사장님 승인 후 Phase별로 진행한다.*

// 실내에서 안심 — 초보 식집사의 실제 구매 장벽(냄새·벌레 걱정)에 정면으로 답한다.
//   랜딩 섹션(AftermilkBand)과 제품 상세 페이지에서 공용.
//   근거는 제품·홈페이지 표기 사실 범위: 피트모스 베딩 발효(냄새 없는 고품질 퇴비),
//   발효·숙성을 마친 파우더, 지오스민(건강한 흙냄새). 벌레 '안 생김' 단정은 쓰지 않고
//   원인(미숙성 유기물)과 제품의 상태·관리 팁으로 답한다.

const ITEMS: { q: string; a: React.ReactNode }[] = [
  {
    q: "냄새 나지 않나요?",
    a: (
      <>
        분뇨 냄새의 원인은 덜 발효된 유기물입니다. 애프터밀크는 피트모스 베딩 시스템으로
        발효를 마친 파우더라, 인위적인 악취 대신{" "}
        <strong className="font-medium text-ink">건강한 흙냄새(지오스민)</strong>가 납니다.
      </>
    ),
  },
  {
    q: "벌레가 꼬이지 않을까요?",
    a: (
      <>
        실내 화분에 벌레가 꼬이는 주된 원인도 미숙성 유기물과 과습입니다. 애프터밀크는{" "}
        <strong className="font-medium text-ink">발효·숙성을 마친 안정된 파우더</strong>로
        실내 화분 사용을 전제로 만들었습니다. 흙에 소량(9 : 1)만 섞고 표면이 마르게
        관리하시면 됩니다.
      </>
    ),
  },
  {
    q: "오래 두고 써도 되나요?",
    a: (
      <>
        네. 이미 안정화된 유기물이라 직사광선을 피해 서늘한 곳에 두시면{" "}
        <strong className="font-medium text-ink">10년 이상</strong> 사용할 수 있습니다.
        6개월에 한 번씩 꺼내 쓰시면 됩니다.
      </>
    ),
  },
];

export function AftermilkAssurance() {
  return (
    <div className="rounded-2xl border border-line bg-cream p-6">
      <p className="flex items-center gap-2 text-[13px] uppercase tracking-[0.18em] text-gold-deep">
        <span
          aria-hidden
          style={{ backgroundColor: "var(--color-hey-rose)" }}
          className="h-1.5 w-1.5 rounded-full"
        />
        실내에서 안심 · Indoor Safe
      </p>
      <dl className="mt-3 space-y-4">
        {ITEMS.map(({ q, a }) => (
          <div key={q}>
            <dt className="text-[14px] font-medium text-ink">{q}</dt>
            <dd className="mt-1 text-[14px] leading-relaxed text-ink-soft">{a}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-4 text-[11.5px] leading-relaxed text-mute">
        ※ 화분 환경(통풍·물주기)에 따라 차이가 있을 수 있습니다. 궁금한 점은 고객센터로
        문의해 주세요.
      </p>
    </div>
  );
}

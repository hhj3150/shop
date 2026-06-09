"use client";

// 관리자 '오늘 할 일' 대시보드 — 입금·발송·환불·이상 등 처리 대기 작업량을
//   종합 관리 탭 최상단에서 한눈에 보여준다. 각 카드는 해당 작업 화면으로 점프한다.
//   집계는 하지 않는다(표시 전용) — 수치는 page.tsx 의 기존 파생값을 주입받는다.

export type TodoCard = {
  key: string;
  label: string;
  count: number;
  hint?: string;
  // count>0 일 때 주의(앰버) 강조 여부. 평상 작업(입금확인 대기 등)은 false.
  urgent?: boolean;
  onClick: () => void;
};

export function AdminTodayBoard({ cards }: { cards: TodoCard[] }) {
  const anyWork = cards.some((c) => c.count > 0);

  return (
    <section className="mt-8 no-print">
      <div className="flex items-baseline justify-between">
        <h2 className="font-serif-kr text-lg text-ink">오늘 할 일</h2>
        {!anyWork && (
          <span className="text-[13px] text-mute">처리할 대기 작업이 없습니다 👍</span>
        )}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {cards.map((c) => {
          const active = c.count > 0;
          const tone =
            active && c.urgent
              ? "border-amber-300 bg-amber-50/60 hover:border-amber-400"
              : active
                ? "border-line bg-paper hover:border-gold"
                : "border-line/60 bg-cream/40";
          return (
            <button
              key={c.key}
              onClick={c.onClick}
              className={`rounded-2xl border p-4 text-left transition-colors ${tone}`}
            >
              <p className="text-[12px] text-mute">{c.label}</p>
              <p
                className={`mt-1 text-2xl font-medium tabular-nums ${active ? "text-ink" : "text-mute"}`}
              >
                {c.count}
              </p>
              {c.hint && <p className="mt-0.5 text-[11px] text-mute">{c.hint}</p>}
            </button>
          );
        })}
      </div>
    </section>
  );
}

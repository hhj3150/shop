// 정기구독 신청의 세 걸음 — 지금 어디쯤인지 알려 준다.
//   가입 화면에 들어온 손님은 '가입하면 끝인가, 결제까지 얼마나 남았나'를 모른다.
//   남은 걸음이 보이면 긴 양식도 끝이 있는 일이 된다.
const STEPS = ["회원가입", "제품 선택", "신청·입금"] as const;

export function FlowSteps({ current, className = "" }: { current: 1 | 2 | 3; className?: string }) {
  return (
    <ol aria-label="정기구독 신청 단계" className={`flex items-center gap-2 ${className}`}>
      {STEPS.map((label, i) => {
        const n = i + 1;
        const state = n < current ? "done" : n === current ? "now" : "todo";
        return (
          <li
            key={label}
            aria-current={state === "now" ? "step" : undefined}
            className="flex min-w-0 flex-1 items-center gap-2"
          >
            <span
              className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full t-caption font-semibold tabular-nums ${
                state === "now"
                  ? "bg-ink text-cream"
                  : state === "done"
                    ? "bg-gold/25 text-gold-deep"
                    : "border border-line text-mute"
              }`}
            >
              {state === "done" ? "✓" : n}
            </span>
            <span className={`t-caption truncate ${state === "now" ? "font-medium text-ink" : "text-mute"}`}>
              {state === "done" && <span className="sr-only">완료: </span>}
              {label}
            </span>
            {n < STEPS.length && <span aria-hidden className="h-px min-w-2 flex-1 bg-line" />}
          </li>
        );
      })}
    </ol>
  );
}

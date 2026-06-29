"use client";

// AI 컨시어지 입구 — '브라우징'이 아니라 '대화'로 내게 맞는 구독을 찾게 하는 초대.
//   고르기 어려운 고객을 카탈로그에서 이탈시키지 않고, 목장 집사(CustomerAssistant)와의
//   대화로 핸드오프한다. 버튼은 'shop:assistant-open' 이벤트를 발행해 어시스턴트를 열고
//   질문을 미리 채운다(전역 위젯이 layout.tsx 에 상주).
function openAssistant(prompt: string) {
  window.dispatchEvent(new CustomEvent("shop:assistant-open", { detail: { prompt } }));
}

// 대화 시작 칩 — 흔한 망설임을 곧장 질문으로 바꿔 대화의 문턱을 낮춘다.
const CHIPS: { label: string; prompt: string }[] = [
  {
    label: "우리 가족에 맞는 양",
    prompt:
      "가족이 몇 명이고 평소 우유를 이 정도 마셔요. 일주일에 몇 병, 어떤 구성의 정기구독이 맞을지 추천해 주세요.",
  },
  {
    label: "아이가 먹어도 될까요",
    prompt:
      "아이가 우유를 마시면 가끔 속이 불편해해요. A2 저지 우유가 왜 소화에 편한지, 우리 아이에게 맞을지 알려주세요.",
  },
  {
    label: "우유 vs 요거트",
    prompt: "A2 저지 헤이밀크와 플레인 요거트 중 저에게는 무엇이 더 맞을까요? 차이를 알려주세요.",
  },
  {
    label: "선물로 보내고 싶어요",
    prompt: "부모님께 선물로 보내고 싶어요. 어떤 구성으로 보내면 좋을지, 어떻게 주문하는지 알려주세요.",
  },
];

export function ConciergeInvite() {
  return (
    <section className="bg-cream/40">
      <div className="mx-auto max-w-3xl px-5 py-16 text-center sm:px-8 sm:py-20">
        <p className="eyebrow text-gold-deep">Ask the Farm · 목장 집사</p>
        <h2 className="mt-3 text-balance font-serif-kr text-[clamp(1.5rem,4vw,2.1rem)] font-medium leading-[1.34] tracking-[-0.01em] text-ink">
          무엇이 맞을지 고르기 어려우신가요?
          <br />
          물어보시면, 맞는 한 병을 찾아드립니다.
        </h2>
        <p className="mx-auto mt-5 max-w-md text-[14.5px] leading-relaxed text-mute">
          진열대를 헤매지 마세요. 가족 수·드시는 양·아이의 소화까지, 대화 한 번이면 목장 집사가
          나에게 꼭 맞는 정기구독을 골라드립니다.
        </p>

        <div className="mt-8 flex flex-wrap justify-center gap-2.5">
          {CHIPS.map((c) => (
            <button
              key={c.label}
              type="button"
              onClick={() => openAssistant(c.prompt)}
              className="rounded-full border border-gold/40 bg-white px-4 py-2.5 text-[13.5px] font-medium text-ink-soft transition-[transform,colors] hover:border-gold hover:bg-gold/10 hover:text-gold-deep active:scale-[0.98]"
            >
              {c.label}
            </button>
          ))}
        </div>

        <button
          type="button"
          onClick={() =>
            openAssistant(
              "안녕하세요. 저에게 맞는 정기구독을 추천받고 싶어요. 무엇부터 알려드리면 될까요?"
            )
          }
          className="mt-8 inline-flex items-center gap-2 rounded-full bg-ink px-8 py-3.5 text-sm font-medium tracking-wide text-cream transition-transform duration-300 ease-[var(--ease-soft)] hover:scale-[1.02] active:scale-[0.98]"
        >
          대화로 내 구독 찾기
          <span aria-hidden="true">→</span>
        </button>
      </div>
    </section>
  );
}

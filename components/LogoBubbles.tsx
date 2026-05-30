import Image from "next/image";

// 동그란 HEY HAY MILK 로고가 비누방울처럼 둥둥 떠다니는 장식 레이어.
// 위치·크기·속도·투명도를 달리해 자연스럽게 흩어 놓는다. 순수 CSS 애니메이션.
type Bubble = {
  size: number;
  top?: string;
  left?: string;
  right?: string;
  bottom?: string;
  opacity: number;
  duration: number; // 초
  delay: number; // 초
  className?: string;
};

const BUBBLES: Bubble[] = [
  { size: 96, top: "12%", left: "4%", opacity: 0.55, duration: 9, delay: 0 },
  { size: 56, top: "24%", right: "8%", opacity: 0.45, duration: 11, delay: 1.5, className: "hidden sm:block" },
  { size: 72, bottom: "14%", left: "12%", opacity: 0.5, duration: 10, delay: 0.8 },
  { size: 44, top: "54%", right: "16%", opacity: 0.4, duration: 12, delay: 2.2 },
  { size: 120, bottom: "6%", right: "4%", opacity: 0.5, duration: 13, delay: 0.4, className: "hidden sm:block" },
  { size: 38, top: "8%", left: "46%", opacity: 0.38, duration: 10.5, delay: 3 },
];

export function LogoBubbles() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 overflow-hidden">
      {BUBBLES.map((b, i) => (
        <div
          key={i}
          className={`animate-bubble absolute ${b.className ?? ""}`}
          style={{
            top: b.top,
            left: b.left,
            right: b.right,
            bottom: b.bottom,
            opacity: b.opacity,
            animationDuration: `${b.duration}s`,
            animationDelay: `${b.delay}s`,
          }}
        >
          <Image
            src="/brand/heymilk-logo.png"
            alt=""
            width={b.size}
            height={b.size}
            className="h-auto w-full"
          />
        </div>
      ))}
    </div>
  );
}
